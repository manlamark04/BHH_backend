const pool = require('../config/db');
const requestLifecycle = require('./request-lifecycle.service');

/**
 * Calculate No-Show Fee based on configurable policy:
 * - 'first_night' (Default / Option B): Forfeits 1st night rate (or full stay for 1-night / short-time).
 * - 'flat' (Option A): Fixed peso amount.
 * - 'percentage' (Option C): Fixed % of total booking value.
 */
function calculateNoShowFee(booking, room) {
  const policy = (process.env.NO_SHOW_FEE_POLICY || 'percentage').toLowerCase();

  if (policy === 'flat') {
    return parseFloat(process.env.NO_SHOW_FEE_FLAT_AMOUNT || '200');
  }

  if (policy === 'percentage') {
    const pct = parseFloat(process.env.NO_SHOW_FEE_PERCENTAGE || '20');
    return Math.round((Number(booking.total_price || 0) * (pct / 100)) * 100) / 100;
  }

  // Default: Option B — First Night's Rate
  if (booking.booking_type === 'short_time') {
    return Number(booking.total_price || 0);
  }

  const roomRate = Number(room?.rate_per_night || 0);
  const totalPrice = Number(booking.total_price || 0);

  // If rate per night is known, charge 1 night rate (or total price if less than 1 night)
  if (roomRate > 0) {
    if (totalPrice > 0 && totalPrice < roomRate) {
      return totalPrice;
    }
    return roomRate;
  }

  return totalPrice;
}

/**
 * Process a booking as No-Show
 * @param {number} bookingId 
 * @param {object} options { staffUser, triggerType, customFee, reason }
 */
async function processBookingNoShow(bookingId, { staffUser = null, triggerType = 'system_cutoff', customFee = null, reason = null } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [bRows] = await conn.query(`
      SELECT b.*, r.room_number, r.rate_per_night, r.room_type, u.full_name AS customer_name, u.email AS customer_email
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      JOIN users u ON u.id = b.customer_id
      WHERE b.id = ?
      FOR UPDATE
    `, [bookingId]);

    if (bRows.length === 0) {
      const err = new Error('Booking not found.');
      err.statusCode = 404;
      throw err;
    }

    const booking = bRows[0];
    const currentStatus = String(booking.status || '').toLowerCase();

    if (currentStatus === 'checked_in') {
      const err = new Error('Cannot mark booking as No-Show: guest has already checked in.');
      err.statusCode = 400;
      throw err;
    }

    if (currentStatus === 'no_show') {
      await conn.rollback();
      return { success: true, bookingId, message: 'Booking is already marked as No-Show.' };
    }

    if (['cancelled', 'rejected', 'checked_out'].includes(currentStatus)) {
      const err = new Error(`Cannot mark booking with status "${booking.status}" as No-Show.`);
      err.statusCode = 400;
      throw err;
    }

    // 1. Calculate No-Show Fee
    const calculatedFee = customFee !== null ? Math.max(0, Number(customFee)) : calculateNoShowFee(booking, { rate_per_night: booking.rate_per_night });
    const actionReason = reason || (triggerType === 'system_cutoff'
      ? 'Automated midnight cutoff: Guest failed to check in by scheduled check-in date.'
      : 'Staff manual override: Guest failed to arrive for scheduled reservation.');

    // 2. Coordinated Step 1: Update booking status to no_show & record fee
    await conn.query(`
      UPDATE bookings 
      SET status = 'no_show',
          no_show_fee = ?,
          no_show_at = NOW(),
          rejection_reason = ?,
          updated_at = NOW()
      WHERE id = ?
    `, [calculatedFee, actionReason, bookingId]);

    // 3. Coordinated Step 2: Release room immediately and automatically back to 'available'
    await conn.query("UPDATE rooms SET status = 'available', updated_at = NOW() WHERE id = ?", [booking.room_id]);

    // 4. Coordinated Step 3: Update / adjust associated bill and invoice line items
    const [billRows] = await conn.query('SELECT * FROM bills WHERE booking_id = ? ORDER BY id DESC LIMIT 1', [bookingId]);
    let billId = null;
    let remainingBalance = 0;
    let refundPending = 0;

    if (billRows.length > 0) {
      const bill = billRows[0];
      billId = bill.id;

      // Check payments received
      const [paidRows] = await conn.query(
        "SELECT SUM(amount) AS total_paid FROM payments WHERE bill_id = ? AND (notes IS NULL OR notes NOT LIKE '%[REFUNDED%')",
        [bill.id]
      );
      const totalPaid = Number(paidRows[0]?.total_paid || 0);

      if (totalPaid >= calculatedFee) {
        // Guest paid enough to cover no-show fee
        refundPending = totalPaid - calculatedFee;
        remainingBalance = 0;
        await conn.query(
          "UPDATE bills SET cancellation_fee = ?, status = 'paid', updated_at = NOW() WHERE id = ?",
          [calculatedFee, bill.id]
        );
      } else {
        // Guest owes difference or full fee
        remainingBalance = calculatedFee - totalPaid;
        const newStatus = totalPaid > 0 ? 'partially_paid' : 'unpaid';
        await conn.query(
          "UPDATE bills SET cancellation_fee = ?, status = ?, updated_at = NOW() WHERE id = ?",
          [calculatedFee, newStatus, bill.id]
        );
      }

      // Add distinct line item to invoice for auditability
      await conn.query(`
        INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
        VALUES (?, ?, 1, ?)
      `, [bill.id, `No-Show Service Fee — BK-${new Date(booking.created_at).getFullYear()}-${String(booking.id).padStart(4, '0')}`, calculatedFee]);
    }

    // 5. Coordinated Step 4: Audit Log Entry
    const performerId = staffUser ? staffUser.id : null;
    const performerName = staffUser ? (staffUser.full_name || staffUser.username) : 'System Midnight Cutoff';

    await requestLifecycle.logAudit(conn, {
      entityType: 'booking',
      entityId: bookingId,
      fromStatus: booking.status,
      toStatus: 'no_show',
      performedBy: performerId,
      performedByName: performerName,
      triggerType: triggerType === 'system_cutoff' ? 'system' : 'manual',
      reason: actionReason,
      metadata: {
        noShowFee: calculatedFee,
        roomNumber: booking.room_number,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        remainingBalance,
        refundPending,
        roomReleasedTo: 'available',
      },
    });

    // 6. Coordinated Step 5: Guest Notification (Logged & Ready for Dispatch)
    console.log(`📨 [Guest Notification] No-Show alert generated for ${booking.customer_name} <${booking.customer_email}>: Reservation #${bookingId} marked as No-Show. Fee: ₱${calculatedFee.toLocaleString()}. Room ${booking.room_number} returned to Available.`);

    await conn.commit();

    return {
      success: true,
      bookingId,
      status: 'no_show',
      room_number: booking.room_number,
      room_status: 'available',
      no_show_fee: calculatedFee,
      remaining_balance: remainingBalance,
      refund_pending: refundPending,
      message: `Booking #${bookingId} marked as No-Show. Room ${booking.room_number} automatically reverted to Available.`,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Waive or adjust No-Show Fee (Staff/Admin override)
 */
async function waiveNoShowFee(bookingId, staffUser, reason, newFee = 0) {
  if (!reason || !reason.trim()) {
    const err = new Error('A waiver justification reason is required.');
    err.statusCode = 400;
    throw err;
  }

  const [bRows] = await pool.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (bRows.length === 0) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }

  const booking = bRows[0];
  if (booking.status !== 'no_show') {
    const err = new Error(`Cannot waive fee: booking is not in "no_show" status (current: "${booking.status}").`);
    err.statusCode = 400;
    throw err;
  }

  const oldFee = Number(booking.no_show_fee || 0);
  const adjustedFee = Math.max(0, Number(newFee || 0));

  // Update booking waiver columns
  await pool.query(`
    UPDATE bookings 
    SET no_show_fee = ?,
        no_show_waived_by = ?,
        no_show_waiver_reason = ?,
        updated_at = NOW()
    WHERE id = ?
  `, [adjustedFee, staffUser.id, reason.trim(), bookingId]);

  // Adjust bill cancellation_fee
  await pool.query(
    "UPDATE bills SET cancellation_fee = ?, updated_at = NOW() WHERE booking_id = ?",
    [adjustedFee, bookingId]
  );

  // Log audit
  await requestLifecycle.logAudit(pool, {
    entityType: 'booking',
    entityId: bookingId,
    fromStatus: 'no_show',
    toStatus: 'no_show',
    performedBy: staffUser.id,
    performedByName: staffUser.full_name || staffUser.username,
    triggerType: 'manual',
    reason: `Staff waived/adjusted no-show fee from ₱${oldFee.toLocaleString()} to ₱${adjustedFee.toLocaleString()}: ${reason.trim()}`,
    metadata: { oldFee, newFee: adjustedFee, waiverReason: reason.trim() },
  });

  return {
    success: true,
    bookingId,
    old_fee: oldFee,
    new_fee: adjustedFee,
    message: `No-Show fee adjusted to ₱${adjustedFee.toLocaleString()}. Action recorded in audit trail.`,
  };
}

/**
 * Sweep and detect unclaimed confirmed bookings past their scheduled check-in cutoff
 */
async function sweepExpiredCheckIns() {
  try {
    const [expiredBookings] = await pool.query(`
      SELECT b.id, b.room_id, b.check_in, b.check_out, b.booking_type, b.duration_hours, b.check_in_time
      FROM bookings b
      WHERE b.status IN ('confirmed', 'approved')
        AND (
          -- For standard overnight stays: check-in date is strictly in the past (past 11:59:59 PM of check-in date)
          (b.booking_type != 'short_time' AND DATE(b.check_in) < CURDATE())
          OR
          -- For short-time stays: check-in datetime + duration has passed
          (b.booking_type = 'short_time' AND DATE_ADD(b.check_in, INTERVAL COALESCE(b.duration_hours, 3) HOUR) < NOW())
        )
    `);

    let processedCount = 0;
    for (const b of expiredBookings) {
      try {
        await processBookingNoShow(b.id, { triggerType: 'system_cutoff' });
        processedCount++;
      } catch (err) {
        console.error(`Failed to auto-process no-show for booking #${b.id}:`, err.message);
      }
    }

    if (processedCount > 0) {
      console.log(`⏰ No-Show Sweeper: Processed ${processedCount} expired reservation(s) as No-Show.`);
    }

    return processedCount;
  } catch (err) {
    console.error('Error in sweepExpiredCheckIns:', err.message);
    return 0;
  }
}

module.exports = {
  calculateNoShowFee,
  processBookingNoShow,
  waiveNoShowFee,
  sweepExpiredCheckIns,
};
