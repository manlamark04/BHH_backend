const pool = require('../config/db');

const MIN_DEPOSIT_PERCENT = parseFloat(process.env.MIN_DEPOSIT_PERCENT || '100');
const PENDING_PAYMENT_TIMEOUT_HOURS = parseInt(process.env.PENDING_PAYMENT_TIMEOUT_HOURS || '24', 10);

/**
 * Log state transition in request_audit_logs
 */
async function logAudit(connOrPool, { entityType, entityId, fromStatus, toStatus, performedBy, performedByName, triggerType = 'manual', reason = null, metadata = null }) {
  try {
    const executor = connOrPool || pool;
    await executor.query(
      `INSERT INTO request_audit_logs 
        (entity_type, entity_id, from_status, to_status, performed_by, performed_by_name, trigger_type, reason, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        entityType,
        entityId,
        fromStatus || null,
        toStatus,
        performedBy || null,
        performedByName || null,
        triggerType,
        reason || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (err) {
    console.error('Failed to write request_audit_log:', err.message);
  }
}

/**
 * Get payment status and details for an entity (booking, motor_rental, activity_rental)
 */
async function checkPaymentGate(entityType, entityId) {
  let totalPrice = 0;
  let customerId = null;
  let currentStatus = null;
  let billId = null;

  if (entityType === 'booking') {
    const [bRows] = await pool.query(`
      SELECT b.*, r.rate_per_night,
        GREATEST(1, DATEDIFF(b.check_out, b.check_in)) AS nights,
        (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) AS computed_total
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      WHERE b.id = ?
    `, [entityId]);
    if (bRows.length === 0) throw new Error('Booking not found');
    const b = bRows[0];
    totalPrice = Number(b.computed_total || 0);
    customerId = b.customer_id;
    currentStatus = b.status;

    // Get linked bill
    const [billRows] = await pool.query('SELECT id, total_amount, paid_amount FROM bills WHERE booking_id = ?', [entityId]);
    if (billRows.length > 0) billId = billRows[0].id;
  } else if (entityType === 'motor_rental') {
    const [mRows] = await pool.query('SELECT * FROM motor_rentals WHERE id = ?', [entityId]);
    if (mRows.length === 0) throw new Error('Motor rental not found');
    const m = mRows[0];
    totalPrice = Number(m.total_amount || 0);
    customerId = m.customer_id;
    currentStatus = m.status;

    // Search bill by notes or custom field
    const [billRows] = await pool.query("SELECT id, total_amount, paid_amount FROM bills WHERE customer_id = ? AND (bill_number LIKE ? OR id IN (SELECT bill_id FROM payments WHERE notes LIKE ?))", [
      customerId,
      `%${m.rental_id}%`,
      `%${m.rental_id}%`,
    ]);
    if (billRows.length > 0) billId = billRows[0].id;
  } else if (entityType === 'activity_rental') {
    const [aRows] = await pool.query(`
      SELECT ar.*, a.price_per_unit,
        ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) AS hours,
        (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * a.price_per_unit) AS computed_total
      FROM activity_rentals ar
      JOIN activities a ON a.id = ar.activity_id
      WHERE ar.id = ?
    `, [entityId]);
    if (aRows.length === 0) throw new Error('Activity rental not found');
    const a = aRows[0];
    totalPrice = Math.max(Number(a.price_per_unit || 0), Number(a.computed_total || 0));
    customerId = a.customer_id;
    currentStatus = a.status;

    const [billRows] = await pool.query('SELECT id, total_amount, paid_amount FROM bills WHERE activity_rental_id = ?', [entityId]);
    if (billRows.length > 0) billId = billRows[0].id;
  }

  // Calculate payments
  let totalPaid = 0;
  let payments = [];
  if (billId) {
    const [pRows] = await pool.query(`
      SELECT p.*, u.full_name AS staff_name
      FROM payments p
      LEFT JOIN users u ON u.id = p.received_by
      WHERE p.bill_id = ? AND (p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%')
      ORDER BY p.paid_at DESC
    `, [billId]);
    payments = pRows;
    totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }

  const depositPercent = MIN_DEPOSIT_PERCENT > 0 ? MIN_DEPOSIT_PERCENT : 100;
  const depositRequired = (totalPrice * depositPercent) / 100;
  const isPaid = (totalPrice <= 0) || (totalPaid >= depositRequired && totalPaid > 0);
  const remainingBalance = Math.max(0, totalPrice - totalPaid);

  const latestPayment = payments[0] || null;

  return {
    isPaid,
    totalPaid,
    totalPrice,
    depositRequired,
    depositPercent,
    remainingBalance,
    billId,
    customerId,
    currentStatus,
    latestPayment: latestPayment ? {
      id: latestPayment.id,
      amount: Number(latestPayment.amount),
      method: latestPayment.method,
      paid_at: latestPayment.paid_at,
      txn_number: `TXN-${new Date(latestPayment.paid_at).getFullYear()}-${String(latestPayment.id).padStart(6, '0')}`,
      staff_name: latestPayment.staff_name || 'Front Desk',
      notes: latestPayment.notes,
    } : null,
  };
}

/**
 * Automatic transition directly to confirmed / ACTIVE upon verified payment receipt
 */
async function handlePaymentReceived(entityType, entityId, paymentInfo = {}) {
  const gate = await checkPaymentGate(entityType, entityId);
  const normStatus = String(gate.currentStatus || '').toLowerCase();

  if (gate.isPaid && (normStatus === 'pending_payment' || normStatus === 'pending_approval' || normStatus === 'pending' || normStatus === 'requested')) {
    const targetStatus = entityType === 'motor_rental' ? 'ACTIVE' : (entityType === 'booking' ? 'checked_in' : 'confirmed');
    const tableName = entityType === 'booking' ? 'bookings' : (entityType === 'motor_rental' ? 'motor_rentals' : 'activity_rentals');

    await pool.query(
      `UPDATE ${tableName} 
       SET status = ?, approved_by = ?, approved_at = NOW(), updated_at = NOW() 
       WHERE id = ?`,
      [targetStatus, paymentInfo.userId || null, entityId]
    );

    // If booking, mark room as occupied
    if (entityType === 'booking') {
      const [bk] = await pool.query('SELECT room_id FROM bookings WHERE id = ?', [entityId]);
      if (bk.length > 0 && bk[0].room_id) {
        await pool.query("UPDATE rooms SET status = 'occupied', updated_at = NOW() WHERE id = ?", [bk[0].room_id]);
      }
    }

    // If motor rental, ensure motorcycle is marked RENTED
    if (entityType === 'motor_rental') {
      const [mr] = await pool.query('SELECT motor_id FROM motor_rentals WHERE id = ?', [entityId]);
      if (mr.length > 0) {
        await pool.query("UPDATE motorcycles SET status = 'RENTED', updated_at = NOW() WHERE id = ?", [mr[0].motor_id]);
      }
    }

    await logAudit(pool, {
      entityType,
      entityId,
      fromStatus: gate.currentStatus,
      toStatus: targetStatus,
      performedBy: paymentInfo.userId || null,
      performedByName: paymentInfo.userName || 'Automatic Payment Approval',
      triggerType: 'payment',
      reason: `Payment verified (₱${gate.totalPaid.toLocaleString()} of ₱${gate.totalPrice.toLocaleString()}). Automatically checked in and confirmed upon payment.`,
      metadata: { totalPaid: gate.totalPaid, depositRequired: gate.depositRequired, payment: gate.latestPayment },
    });

    return { transitioned: true, newStatus: targetStatus };
  }

  return { transitioned: false, currentStatus: gate.currentStatus };
}

/**
 * Staff manual approve request (with hard server-side payment check)
 */
async function approveRequest(entityType, entityId, staffUser) {
  const gate = await checkPaymentGate(entityType, entityId);
  const normStatus = String(gate.currentStatus || '').toLowerCase();

  // Server-side Hard Gate: direct API calls must fail if unpaid
  if (!gate.isPaid) {
    const err = new Error(`Cannot approve unpaid request. Required payment threshold is ₱${gate.depositRequired.toLocaleString()} (${gate.depositPercent}%), but only ₱${gate.totalPaid.toLocaleString()} has been recorded.`);
    err.statusCode = 403;
    throw err;
  }

  // Must be in pending_approval (or pending_payment if just paid)
  if (!['pending_approval', 'pending_payment', 'pending', 'requested'].includes(normStatus)) {
    const err = new Error(`Cannot approve request with current status "${gate.currentStatus}".`);
    err.statusCode = 400;
    throw err;
  }

  const tableName = entityType === 'booking' ? 'bookings' : (entityType === 'motor_rental' ? 'motor_rentals' : 'activity_rentals');
  const targetStatus = entityType === 'motor_rental' ? 'ACTIVE' : 'confirmed';

  await pool.query(
    `UPDATE ${tableName} 
     SET status = ?, approved_by = ?, approved_at = NOW(), updated_at = NOW() 
     WHERE id = ?`,
    [targetStatus, staffUser.id, entityId]
  );

  // If motor rental, ensure motorcycle is marked RENTED
  if (entityType === 'motor_rental') {
    const [mr] = await pool.query('SELECT motor_id FROM motor_rentals WHERE id = ?', [entityId]);
    if (mr.length > 0) {
      await pool.query("UPDATE motorcycles SET status = 'RENTED', updated_at = NOW() WHERE id = ?", [mr[0].motor_id]);
    }
  }

  await logAudit(pool, {
    entityType,
    entityId,
    fromStatus: gate.currentStatus,
    toStatus: targetStatus,
    performedBy: staffUser.id,
    performedByName: staffUser.full_name || staffUser.username,
    triggerType: 'manual',
    reason: 'Staff approved request after verifying payment.',
    metadata: { totalPaid: gate.totalPaid, approvedBy: staffUser.full_name },
  });

  return { success: true, status: targetStatus, message: 'Request approved successfully.' };
}

/**
 * Staff reject request (requires reason, triggers refund record if paid)
 */
async function rejectRequest(entityType, entityId, staffUser, reason, notes = '') {
  if (!reason || !reason.trim()) {
    const err = new Error('Rejection reason is required.');
    err.statusCode = 400;
    throw err;
  }

  const gate = await checkPaymentGate(entityType, entityId);
  const tableName = entityType === 'booking' ? 'bookings' : (entityType === 'motor_rental' ? 'motor_rentals' : 'activity_rentals');
  const targetStatus = entityType === 'motor_rental' ? 'REJECTED' : 'rejected';
  const fullReason = [reason.trim(), notes ? notes.trim() : null].filter(Boolean).join(' - ');

  await pool.query(
    `UPDATE ${tableName} 
     SET status = ?, rejection_reason = ?, rejected_by = ?, rejected_at = NOW(), updated_at = NOW() 
     WHERE id = ?`,
    [targetStatus, fullReason, staffUser.id, entityId]
  );

  // If motor rental was holding a motor, release motorcycle
  if (entityType === 'motor_rental') {
    const [mr] = await pool.query('SELECT motor_id FROM motor_rentals WHERE id = ?', [entityId]);
    if (mr.length > 0) {
      await pool.query("UPDATE motorcycles SET status = 'AVAILABLE', updated_at = NOW() WHERE id = ?", [mr[0].motor_id]);
    }
  }

  // If paid, create a refund record for finance reconciliation
  let refundId = null;
  if (gate.totalPaid > 0) {
    const [refResult] = await pool.query(
      `INSERT INTO refunds (entity_type, entity_id, bill_id, payment_id, customer_id, amount, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NOW())`,
      [
        entityType,
        entityId,
        gate.billId || null,
        gate.latestPayment?.id || null,
        gate.customerId,
        gate.totalPaid,
        `Rejection: ${fullReason}`,
      ]
    );
    refundId = refResult.insertId;
  }

  await logAudit(pool, {
    entityType,
    entityId,
    fromStatus: gate.currentStatus,
    toStatus: targetStatus,
    performedBy: staffUser.id,
    performedByName: staffUser.full_name || staffUser.username,
    triggerType: 'manual',
    reason: fullReason,
    metadata: { refundId, amountToRefund: gate.totalPaid },
  });

  return {
    success: true,
    status: targetStatus,
    message: 'Request rejected.',
    refund_pending: gate.totalPaid > 0,
    refund_amount: gate.totalPaid,
  };
}

/**
 * Cancel request (Customer or Staff before payment, or timeout)
 */
async function cancelRequest(entityType, entityId, user, reason = 'Cancelled by user', autoCancelled = false) {
  const gate = await checkPaymentGate(entityType, entityId);
  const tableName = entityType === 'booking' ? 'bookings' : (entityType === 'motor_rental' ? 'motor_rentals' : 'activity_rentals');
  const targetStatus = entityType === 'motor_rental' ? 'CANCELLED' : 'cancelled';

  await pool.query(
    `UPDATE ${tableName} 
     SET status = ?, auto_cancelled = ?, updated_at = NOW() 
     WHERE id = ?`,
    [targetStatus, autoCancelled ? 1 : 0, entityId]
  );

  // If motor rental, release motorcycle
  if (entityType === 'motor_rental') {
    const [mr] = await pool.query('SELECT motor_id FROM motor_rentals WHERE id = ?', [entityId]);
    if (mr.length > 0) {
      await pool.query("UPDATE motorcycles SET status = 'AVAILABLE', updated_at = NOW() WHERE id = ?", [mr[0].motor_id]);
    }
  }

  await logAudit(pool, {
    entityType,
    entityId,
    fromStatus: gate.currentStatus,
    toStatus: targetStatus,
    performedBy: user?.id || null,
    performedByName: user?.full_name || (autoCancelled ? 'System Auto-Timeout' : 'User'),
    triggerType: autoCancelled ? 'system' : 'manual',
    reason,
    metadata: { autoCancelled },
  });

  return { success: true, status: targetStatus, message: 'Request cancelled.' };
}

/**
 * Background task: Auto-cancel expired unpaid requests sitting in pending_payment
 */
async function autoCancelExpiredRequests() {
  try {
    const now = new Date();

    // 1. Expired Bookings
    const [expiredBookings] = await pool.query(
      `SELECT id, customer_id, created_at, payment_deadline FROM bookings 
       WHERE status IN ('pending_payment', 'requested', 'pending') 
         AND payment_deadline IS NOT NULL 
         AND payment_deadline < NOW()`
    );

    for (const b of expiredBookings) {
      console.log(`[Auto-Cancel] Cancelling expired booking ID ${b.id}`);
      await cancelRequest('booking', b.id, null, 'Payment deadline expired without payment confirmation.', true);
    }

    // 2. Expired Activity Rentals
    const [expiredActivities] = await pool.query(
      `SELECT id, customer_id, created_at, payment_deadline FROM activity_rentals 
       WHERE status IN ('pending_payment', 'requested', 'pending') 
         AND payment_deadline IS NOT NULL 
         AND payment_deadline < NOW()`
    );

    for (const ar of expiredActivities) {
      console.log(`[Auto-Cancel] Cancelling expired activity rental ID ${ar.id}`);
      await cancelRequest('activity_rental', ar.id, null, 'Payment deadline expired without payment confirmation.', true);
    }

    // 3. Expired Motor Rentals
    const [expiredMotors] = await pool.query(
      `SELECT id, customer_id, created_at, payment_deadline FROM motor_rentals 
       WHERE status IN ('PENDING_PAYMENT', 'PENDING') 
         AND payment_deadline IS NOT NULL 
         AND payment_deadline < NOW()`
    );

    for (const mr of expiredMotors) {
      console.log(`[Auto-Cancel] Cancelling expired motor rental ID ${mr.id}`);
      await cancelRequest('motor_rental', mr.id, null, 'Payment deadline expired without payment confirmation.', true);
    }
  } catch (err) {
    console.error('Error in autoCancelExpiredRequests:', err.message);
  }
}

/**
 * Helper to compute default payment deadline (e.g. NOW + 24 hours)
 */
function getPaymentDeadline(hours = PENDING_PAYMENT_TIMEOUT_HOURS) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d;
}

/**
 * Get audit trail for an entity
 */
async function getAuditTrail(entityType, entityId) {
  const [rows] = await pool.query(
    `SELECT ral.*, u.full_name AS actor_full_name, u.role AS actor_role
     FROM request_audit_logs ral
     LEFT JOIN users u ON u.id = ral.performed_by
     WHERE ral.entity_type = ? AND ral.entity_id = ?
     ORDER BY ral.created_at DESC`,
    [entityType, entityId]
  );
  return rows;
}

/**
 * Auto-sync all paid requests currently in pending_payment / pending_approval to confirmed / active
 */
async function syncPaidRequestsToConfirmed() {
  try {
    // 1. Sync Bookings with paid bills
    const [paidBookings] = await pool.query(`
      SELECT b.id, b.status 
      FROM bookings b
      JOIN bills bill ON bill.booking_id = b.id
      JOIN payments p ON p.bill_id = bill.id
      WHERE b.status IN ('pending_payment', 'pending_approval', 'requested', 'pending')
        AND (p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%')
      GROUP BY b.id, b.status
      HAVING SUM(p.amount) > 0
    `);

    for (const b of paidBookings) {
      await handlePaymentReceived('booking', b.id, { userName: 'Auto-Confirmation Sync' });
    }

    // 2. Sync Activity Rentals with paid bills
    const [paidActivities] = await pool.query(`
      SELECT ar.id, ar.status 
      FROM activity_rentals ar
      JOIN bills bill ON bill.activity_rental_id = ar.id
      JOIN payments p ON p.bill_id = bill.id
      WHERE ar.status IN ('pending_payment', 'pending_approval', 'requested', 'pending')
        AND (p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%')
      GROUP BY ar.id, ar.status
      HAVING SUM(p.amount) > 0
    `);

    for (const ar of paidActivities) {
      await handlePaymentReceived('activity_rental', ar.id, { userName: 'Auto-Confirmation Sync' });
    }

    // 3. Sync Motor Rentals with paid bills
    const [paidMotors] = await pool.query(`
      SELECT mr.id, mr.status 
      FROM motor_rentals mr
      JOIN bills bill ON bill.customer_id = mr.customer_id AND bill.bill_number LIKE CONCAT('%', mr.rental_id, '%')
      JOIN payments p ON p.bill_id = bill.id
      WHERE mr.status IN ('PENDING_PAYMENT', 'PENDING_APPROVAL', 'PENDING')
        AND (p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%')
      GROUP BY mr.id, mr.status
      HAVING SUM(p.amount) > 0
    `);

    for (const mr of paidMotors) {
      await handlePaymentReceived('motor_rental', mr.id, { userName: 'Auto-Confirmation Sync' });
    }
  } catch (err) {
    console.error('Error in syncPaidRequestsToConfirmed:', err.message);
  }
}

module.exports = {
  MIN_DEPOSIT_PERCENT,
  PENDING_PAYMENT_TIMEOUT_HOURS,
  checkPaymentGate,
  handlePaymentReceived,
  approveRequest,
  rejectRequest,
  cancelRequest,
  autoCancelExpiredRequests,
  syncPaidRequestsToConfirmed,
  getPaymentDeadline,
  getAuditTrail,
  logAudit,
};
