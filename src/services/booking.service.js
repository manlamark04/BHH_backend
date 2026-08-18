const pool = require('../config/db');
const db   = require('../db/procedures');
const requestLifecycle = require('./request-lifecycle.service');

/** GET /api/bookings — Staff/Admin: all bookings with full customer, room, and payment details */
async function getAllBookings(req, res) {
  try {
    await requestLifecycle.syncPaidRequestsToConfirmed();
    const { status, search } = req.query;

    let query = `
      SELECT 
        b.id,
        CONCAT('BK-', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) AS booking_ref,
        b.customer_id,
        u.full_name AS customer_name,
        u.unique_id AS customer_code,
        u.email AS customer_email,
        u.phone AS customer_phone,
        b.room_id,
        r.room_number,
        r.room_type,
        r.capacity,
        r.rate_per_night AS room_price,
        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
        GREATEST(1, DATEDIFF(b.check_out, b.check_in)) AS nights,
        r.capacity AS num_guests,
        (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) AS total_price,
        COALESCE(paid_tbl.total_paid, 0) AS amount_paid,
        GREATEST(0, (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) - COALESCE(paid_tbl.total_paid, 0)) AS remaining_balance,
        CASE
          WHEN COALESCE(paid_tbl.total_paid, 0) >= (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) AND (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) > 0 THEN 'PAID'
          WHEN COALESCE(paid_tbl.total_paid, 0) > 0 THEN 'PARTIALLY PAID'
          ELSE 'PENDING'
        END AS payment_status,
        b.status AS status_raw,
        UPPER(b.status) AS status,
        b.notes,
        b.rejection_reason,
        b.rejected_at,
        b.approved_at,
        b.payment_deadline,
        b.auto_cancelled,
        b.created_at,
        approver.full_name AS approved_by_name,
        rejector.full_name AS rejected_by_name,
        creator.full_name AS created_by_name,
        latest_pay.method AS latest_payment_method,
        latest_pay.id AS latest_payment_id,
        latest_pay.paid_at AS latest_payment_date,
        latest_pay.notes AS latest_payment_notes
      FROM bookings b
      JOIN users u ON u.id = b.customer_id
      JOIN rooms r ON r.id = b.room_id
      LEFT JOIN users creator ON creator.id = b.created_by
      LEFT JOIN users approver ON approver.id = b.approved_by
      LEFT JOIN users rejector ON rejector.id = b.rejected_by
      LEFT JOIN (
        SELECT bill.booking_id, SUM(p.amount) AS total_paid
        FROM bills bill
        JOIN payments p ON p.bill_id = bill.id
        WHERE p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%'
        GROUP BY bill.booking_id
      ) paid_tbl ON paid_tbl.booking_id = b.id
      LEFT JOIN (
        SELECT p1.bill_id, p1.id, p1.method, p1.paid_at, p1.notes, b1.booking_id
        FROM payments p1
        JOIN bills b1 ON b1.id = p1.bill_id
        WHERE p1.id = (
          SELECT MAX(p2.id) 
          FROM payments p2 
          WHERE p2.bill_id = p1.bill_id AND (p2.notes IS NULL OR p2.notes NOT LIKE '%[REFUNDED%')
        )
      ) latest_pay ON latest_pay.booking_id = b.id
      WHERE 1=1
    `;

    const params = [];

    if (status && status !== 'all' && status !== 'All') {
      const normalizedStatus = status.toLowerCase().replace('-', '_').replace(' ', '_');
      query += ` AND (LOWER(b.status) = ? OR LOWER(b.status) = ?)`;
      params.push(normalizedStatus, status.toLowerCase());
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ` AND (
        u.full_name LIKE ? OR 
        u.unique_id LIKE ? OR 
        u.email LIKE ? OR 
        u.phone LIKE ? OR 
        r.room_number LIKE ? OR 
        b.id LIKE ?
      )`;
      params.push(s, s, s, s, s, s);
    }

    query += ` ORDER BY b.created_at DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('getAllBookings error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bookings/approval-queue — Staff/Admin: items in pending_approval */
async function getApprovalQueue(req, res) {
  try {
    req.query.status = 'pending_approval';
    return await getAllBookings(req, res);
  } catch (err) {
    console.error('getApprovalQueue error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bookings/awaiting-payment — Staff/Admin: items in pending_payment */
async function getAwaitingPayment(req, res) {
  try {
    req.query.status = 'pending_payment';
    return await getAllBookings(req, res);
  } catch (err) {
    console.error('getAwaitingPayment error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bookings/my — Customer: own bookings with full lifecycle details */
async function getMyBookings(req, res) {
  try {
    await requestLifecycle.syncPaidRequestsToConfirmed();
    const customerId = req.user.id;
    const [rows] = await pool.query(`
      SELECT 
        b.id,
        CONCAT('BK-', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) AS booking_ref,
        b.customer_id,
        b.room_id,
        r.room_number,
        r.room_type,
        r.capacity,
        r.rate_per_night AS room_price,
        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
        GREATEST(1, DATEDIFF(b.check_out, b.check_in)) AS nights,
        (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) AS total_price,
        COALESCE(paid_tbl.total_paid, 0) AS amount_paid,
        GREATEST(0, (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) - COALESCE(paid_tbl.total_paid, 0)) AS remaining_balance,
        CASE
          WHEN COALESCE(paid_tbl.total_paid, 0) >= (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) AND (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night) > 0 THEN 'PAID'
          WHEN COALESCE(paid_tbl.total_paid, 0) > 0 THEN 'PARTIALLY PAID'
          ELSE 'PENDING'
        END AS payment_status,
        b.status AS status_raw,
        UPPER(b.status) AS status,
        b.notes,
        b.rejection_reason,
        b.rejected_at,
        b.approved_at,
        b.payment_deadline,
        b.auto_cancelled,
        b.created_at,
        ref_tbl.status AS refund_status,
        ref_tbl.amount AS refund_amount
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      LEFT JOIN (
        SELECT bill.booking_id, SUM(p.amount) AS total_paid
        FROM bills bill
        JOIN payments p ON p.bill_id = bill.id
        WHERE p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%'
        GROUP BY bill.booking_id
      ) paid_tbl ON paid_tbl.booking_id = b.id
      LEFT JOIN (
        SELECT entity_id, status, amount
        FROM refunds
        WHERE entity_type = 'booking'
      ) ref_tbl ON ref_tbl.entity_id = b.id
      WHERE b.customer_id = ?
      ORDER BY b.created_at DESC
    `, [customerId]);

    res.json(rows);
  } catch (err) {
    console.error('getMyBookings error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/bookings — Create booking with availability & pricing validation */
async function createBooking(req, res) {
  try {
    const { room_id, check_in, check_out, notes, customer_id, initial_payment, payment_method } = req.body;
    const targetCustomerId = (req.user.role === 'staff' || req.user.role === 'admin') && customer_id
      ? parseInt(customer_id)
      : req.user.id;
    const createdBy = req.user.role !== 'customer' ? req.user.id : null;

    // Check room availability
    const [overlap] = await pool.query(`
      SELECT id FROM bookings 
      WHERE room_id = ? 
        AND status NOT IN ('cancelled', 'checked_out', 'rejected')
        AND (check_in < ? AND check_out > ?)
    `, [room_id, check_out, check_in]);

    if (overlap.length > 0) {
      return res.status(409).json({ message: `Room is already reserved for the selected dates (${check_in} to ${check_out}).` });
    }

    // Get room details for rate
    const [roomRows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [room_id]);
    if (roomRows.length === 0) {
      return res.status(404).json({ message: 'Room not found.' });
    }
    const room = roomRows[0];
    const nights = Math.max(1, Math.ceil((new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24)));
    const totalPrice = Number(room.rate_per_night) * nights;

    // Set payment deadline (e.g. NOW + 24 hours)
    const paymentDeadline = requestLifecycle.getPaymentDeadline();
    let initialStatus = 'pending_payment';

    // Insert booking
    const [result] = await pool.query(`
      INSERT INTO bookings (customer_id, room_id, check_in, check_out, status, notes, payment_deadline, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [targetCustomerId, room_id, check_in, check_out, initialStatus, notes || null, paymentDeadline, createdBy]);

    const newBookingId = result.insertId;
    const currentYear = new Date().getFullYear();
    const bookingRef = `BK-${currentYear}-${String(newBookingId).padStart(4, '0')}`;

    // Always create initial bill
    const billNumber = `BILL-${currentYear}-${String(newBookingId).padStart(4, '0')}`;
    const initialPayAmount = initial_payment ? Number(initial_payment) : 0;

    const [billRes] = await pool.query(`
      INSERT INTO bills (bill_number, customer_id, booking_id, total_amount, paid_amount, status, issued_by, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      billNumber,
      targetCustomerId,
      newBookingId,
      totalPrice,
      initialPayAmount,
      initialPayAmount >= totalPrice ? 'paid' : (initialPayAmount > 0 ? 'partially_paid' : 'unpaid'),
      req.user.id || targetCustomerId,
    ]);

    const billId = billRes.insertId;

    // Insert bill line item
    await pool.query(`
      INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `, [billId, `${room.room_type} Room (${room.room_number}) - ${nights} Night(s)`, nights, Number(room.rate_per_night)]);

    // If initial payment provided, record it
    if (initialPayAmount > 0) {
      const validMethod = ['cash', 'card', 'ewallet', 'gcash', 'maya', 'bank_transfer'].includes(String(payment_method || '').toLowerCase())
        ? String(payment_method).toLowerCase()
        : 'cash';

      await pool.query(`
        INSERT INTO payments (bill_id, amount, method, received_by, paid_at, notes)
        VALUES (?, ?, ?, ?, NOW(), 'Initial reservation payment')
      `, [billId, initialPayAmount, validMethod, req.user.id]);

      // Check payment gate & auto-transition to pending_approval or confirmed (if staff)
      const payTransition = await requestLifecycle.handlePaymentReceived('booking', newBookingId, {
        userId: req.user.id,
        userName: req.user.full_name || req.user.username,
      });

      if (payTransition.transitioned) {
        initialStatus = payTransition.newStatus;
      }
    } else {
      // Audit log creation in pending_payment
      await requestLifecycle.logAudit(pool, {
        entityType: 'booking',
        entityId: newBookingId,
        fromStatus: null,
        toStatus: 'pending_payment',
        performedBy: req.user.id,
        performedByName: req.user.full_name || req.user.username,
        triggerType: req.user.role === 'customer' ? 'manual' : 'manual',
        reason: 'Booking requested by customer. Awaiting payment.',
        metadata: { totalPrice, paymentDeadline },
      });
    }

    res.status(201).json({
      id: newBookingId,
      booking_ref: bookingRef,
      total_price: totalPrice,
      status: initialStatus.toUpperCase(),
      payment_deadline: paymentDeadline,
      message: 'Booking created successfully.',
    });
  } catch (err) {
    console.error('createBooking error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** PATCH /api/bookings/:id/approve — Staff/Admin: Approve booking (Server-side Payment Gate) */
async function approveBooking(req, res) {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const result = await requestLifecycle.approveRequest('booking', bookingId, req.user);
    res.json(result);
  } catch (err) {
    console.error('approveBooking error:', err);
    res.status(err.statusCode || 500).json({ message: err.message });
  }
}

/** PATCH /api/bookings/:id/reject — Staff/Admin: Reject booking (Requires reason, triggers refund record) */
async function rejectBooking(req, res) {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const { reason, notes } = req.body;
    const result = await requestLifecycle.rejectRequest('booking', bookingId, req.user, reason, notes);
    res.json(result);
  } catch (err) {
    console.error('rejectBooking error:', err);
    res.status(err.statusCode || 500).json({ message: err.message });
  }
}

/** PATCH /api/bookings/:id/cancel — Customer/Staff: Cancel booking */
async function cancelBooking(req, res) {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const result = await requestLifecycle.cancelRequest('booking', bookingId, req.user, reason || 'Cancelled by user');
    res.json(result);
  } catch (err) {
    console.error('cancelBooking error:', err);
    res.status(err.statusCode || 500).json({ message: err.message });
  }
}

/** GET /api/bookings/:id/audit — Staff/Admin: Get state machine audit trail */
async function getBookingAuditTrail(req, res) {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const auditLogs = await requestLifecycle.getAuditTrail('booking', bookingId);
    res.json(auditLogs);
  } catch (err) {
    console.error('getBookingAuditTrail error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** PATCH /api/bookings/:id/status — Staff/Admin */
async function updateBookingStatus(req, res) {
  try {
    const { status, remarks } = req.body;
    const bookingId = parseInt(req.params.id);

    const [bRows] = await pool.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (bRows.length === 0) return res.status(404).json({ message: 'Booking not found.' });
    const booking = bRows[0];

    let normStatus = status.toLowerCase().replace('-', '_').replace(' ', '_');
    if (normStatus === 'completed') normStatus = 'checked_out';

    // If attempting to confirm, use approveRequest to enforce payment gate
    if (normStatus === 'confirmed') {
      return await approveBooking(req, res);
    }
    if (normStatus === 'rejected') {
      req.body.reason = remarks || 'Staff rejected';
      return await rejectBooking(req, res);
    }
    if (normStatus === 'cancelled') {
      return await cancelBooking(req, res);
    }

    // Update booking status
    await pool.query('UPDATE bookings SET status = ?, updated_at = NOW() WHERE id = ?', [normStatus, bookingId]);

    // Synchronize room status
    if (normStatus === 'checked_in') {
      await pool.query("UPDATE rooms SET status = 'occupied' WHERE id = ?", [booking.room_id]);
    } else if (normStatus === 'checked_out') {
      await pool.query("UPDATE rooms SET status = 'available' WHERE id = ?", [booking.room_id]);
    } else if (normStatus === 'cancelled') {
      await pool.query("UPDATE rooms SET status = 'available' WHERE id = ?", [booking.room_id]);
    }

    // Audit log
    await requestLifecycle.logAudit(pool, {
      entityType: 'booking',
      entityId: bookingId,
      fromStatus: booking.status,
      toStatus: normStatus,
      performedBy: req.user.id,
      performedByName: req.user.full_name || req.user.username,
      triggerType: 'manual',
      reason: remarks || `Booking status changed to ${normStatus}`,
    });

    res.json({ message: `Booking status updated to ${status}.`, status: normStatus });
  } catch (err) {
    console.error('updateBookingStatus error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** PUT /api/bookings/:id — Staff/Admin edit booking details */
async function editBooking(req, res) {
  try {
    const bookingId = parseInt(req.params.id);
    const { room_id, check_in, check_out, notes } = req.body;

    const [bRows] = await pool.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (bRows.length === 0) return res.status(404).json({ message: 'Booking not found.' });

    // Check overlap excluding this booking
    const [overlap] = await pool.query(`
      SELECT id FROM bookings 
      WHERE room_id = ? 
        AND id != ?
        AND status NOT IN ('cancelled', 'checked_out', 'rejected')
        AND (check_in < ? AND check_out > ?)
    `, [room_id, bookingId, check_out, check_in]);

    if (overlap.length > 0) {
      return res.status(409).json({ message: 'Selected room is not available for these dates.' });
    }

    // Recalculate price
    const [roomRows] = await pool.query('SELECT rate_per_night FROM rooms WHERE id = ?', [room_id]);
    const room = roomRows[0];
    const nights = Math.max(1, Math.ceil((new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24)));
    const totalPrice = Number(room.rate_per_night) * nights;

    await pool.query(`
      UPDATE bookings 
      SET room_id = ?, check_in = ?, check_out = ?, notes = ?, updated_at = NOW()
      WHERE id = ?
    `, [room_id, check_in, check_out, notes || null, bookingId]);

    // Also update bill total amount if exists
    await pool.query('UPDATE bills SET total_amount = ? WHERE booking_id = ?', [totalPrice, bookingId]);

    res.json({ message: 'Booking updated successfully.', total_price: totalPrice });
  } catch (err) {
    console.error('editBooking error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/bookings/:id/payment — Record payment towards booking and handle auto-advancement */
async function recordBookingPayment(req, res) {
  try {
    const bookingId = parseInt(req.params.id);
    const { amount, payment_method, notes, ref_number } = req.body;

    const [bRows] = await pool.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (bRows.length === 0) return res.status(404).json({ message: 'Booking not found.' });
    const booking = bRows[0];

    const [roomRows] = await pool.query('SELECT rate_per_night FROM rooms WHERE id = ?', [booking.room_id]);
    const nights = Math.max(1, Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24)));
    const totalPrice = Number(roomRows[0]?.rate_per_night || 0) * nights;

    // Find or create bill
    let [billRows] = await pool.query('SELECT * FROM bills WHERE booking_id = ?', [bookingId]);
    let billId;

    if (billRows.length === 0) {
      const currentYear = new Date().getFullYear();
      const billNumber = `BILL-${currentYear}-${String(bookingId).padStart(4, '0')}`;
      const [newBill] = await pool.query(`
        INSERT INTO bills (bill_number, customer_id, booking_id, total_amount, paid_amount, status, issued_by, issued_at)
        VALUES (?, ?, ?, ?, 0, 'unpaid', ?, NOW())
      `, [billNumber, booking.customer_id, bookingId, totalPrice, req.user.id]);
      billId = newBill.insertId;
    } else {
      billId = billRows[0].id;
    }

    const validMethod = ['cash', 'card', 'ewallet', 'gcash', 'maya', 'bank_transfer'].includes(String(payment_method || '').toLowerCase())
      ? String(payment_method).toLowerCase()
      : 'cash';

    const fullNotes = [ref_number ? `Ref: ${ref_number}` : null, notes || null].filter(Boolean).join(' · ');

    // Insert payment
    const [pInsert] = await pool.query(`
      INSERT INTO payments (bill_id, amount, method, received_by, paid_at, notes)
      VALUES (?, ?, ?, ?, NOW(), ?)
    `, [billId, Number(amount), validMethod, req.user.id, fullNotes || null]);

    // Recalculate bill total paid
    const [paidRows] = await pool.query("SELECT SUM(amount) AS total_paid FROM payments WHERE bill_id = ? AND (notes IS NULL OR notes NOT LIKE '%[REFUNDED%')", [billId]);
    const totalPaid = Number(paidRows[0]?.total_paid || 0);

    const billStatus = totalPaid >= totalPrice ? 'paid' : (totalPaid > 0 ? 'partially_paid' : 'unpaid');
    await pool.query('UPDATE bills SET paid_amount = ?, status = ? WHERE id = ?', [totalPaid, billStatus, billId]);

    // Trigger state machine advancement from pending_payment -> pending_approval
    const transitionResult = await requestLifecycle.handlePaymentReceived('booking', bookingId, {
      userId: req.user.id,
      userName: req.user.full_name || req.user.username,
    });

    res.json({
      message: 'Payment recorded successfully.',
      payment_id: pInsert.insertId,
      total_paid: totalPaid,
      bill_status: billStatus,
      booking_status: transitionResult.transitioned ? transitionResult.newStatus : booking.status,
    });
  } catch (err) {
    console.error('recordBookingPayment error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bookings/rentals — Staff/Admin: all activity rentals */
async function getAllRentals(req, res) {
  try {
    const { status, search } = req.query;
    let sql = `
      SELECT 
        ar.id,
        CONCAT('AR-', YEAR(ar.created_at), '-', LPAD(ar.id, 4, '0')) AS rental_ref,
        ar.customer_id,
        u.full_name AS customer_name,
        u.unique_id AS customer_code,
        u.email AS customer_email,
        u.phone AS customer_phone,
        ar.activity_id,
        a.name AS activity_name,
        a.price_per_unit,
        a.unit,
        ar.start_time,
        ar.end_time,
        ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) AS duration_hours,
        (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * a.price_per_unit) AS total_price,
        COALESCE(paid_tbl.total_paid, 0) AS amount_paid,
        GREATEST(0, (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * a.price_per_unit) - COALESCE(paid_tbl.total_paid, 0)) AS remaining_balance,
        CASE
          WHEN COALESCE(paid_tbl.total_paid, 0) >= (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * a.price_per_unit) AND a.price_per_unit > 0 THEN 'PAID'
          WHEN COALESCE(paid_tbl.total_paid, 0) > 0 THEN 'PARTIALLY PAID'
          ELSE 'PENDING'
        END AS payment_status,
        ar.status AS status_raw,
        UPPER(ar.status) AS status,
        ar.notes,
        ar.rejection_reason,
        ar.rejected_at,
        ar.approved_at,
        ar.payment_deadline,
        ar.auto_cancelled,
        ar.created_at,
        approver.full_name AS approved_by_name,
        rejector.full_name AS rejected_by_name,
        creator.full_name AS created_by_name,
        latest_pay.method AS latest_payment_method,
        latest_pay.id AS latest_payment_id,
        latest_pay.paid_at AS latest_payment_date
      FROM activity_rentals ar
      JOIN users u ON u.id = ar.customer_id
      JOIN activities a ON a.id = ar.activity_id
      LEFT JOIN users creator ON creator.id = ar.created_by
      LEFT JOIN users approver ON approver.id = ar.approved_by
      LEFT JOIN users rejector ON rejector.id = ar.rejected_by
      LEFT JOIN (
        SELECT bill.activity_rental_id, SUM(p.amount) AS total_paid
        FROM bills bill
        JOIN payments p ON p.bill_id = bill.id
        WHERE p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%'
        GROUP BY bill.activity_rental_id
      ) paid_tbl ON paid_tbl.activity_rental_id = ar.id
      LEFT JOIN (
        SELECT p1.bill_id, p1.id, p1.method, p1.paid_at, b1.activity_rental_id
        FROM payments p1
        JOIN bills b1 ON b1.id = p1.bill_id
        WHERE p1.id = (
          SELECT MAX(p2.id) 
          FROM payments p2 
          WHERE p2.bill_id = p1.bill_id AND (p2.notes IS NULL OR p2.notes NOT LIKE '%[REFUNDED%')
        )
      ) latest_pay ON latest_pay.activity_rental_id = ar.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all' && status !== 'All') {
      const normStatus = status.toLowerCase().replace('-', '_');
      sql += ` AND (LOWER(ar.status) = ? OR LOWER(ar.status) = ?)`;
      params.push(normStatus, status.toLowerCase());
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      sql += ` AND (u.full_name LIKE ? OR u.unique_id LIKE ? OR a.name LIKE ? OR ar.id LIKE ?)`;
      params.push(q, q, q, q);
    }

    sql += ` ORDER BY ar.created_at DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bookings/rentals/schedule — Public/Authenticated: Get reserved time slots across all guests */
async function getRentalsSchedule(req, res) {
  try {
    const { activity_id, date } = req.query;
    let sql = `
      SELECT 
        ar.id,
        ar.activity_id,
        a.name AS activity_name,
        ar.start_time,
        ar.end_time,
        ar.status,
        ar.created_at
      FROM activity_rentals ar
      JOIN activities a ON a.id = ar.activity_id
      WHERE ar.status NOT IN ('cancelled', 'rejected', 'completed')
    `;
    const params = [];
    if (activity_id) {
      sql += ` AND ar.activity_id = ?`;
      params.push(activity_id);
    }
    if (date) {
      sql += ` AND (DATE(ar.start_time) = ? OR DATE(ar.end_time) = ?)`;
      params.push(date, date);
    }
    sql += ` ORDER BY ar.start_time ASC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bookings/rentals/my — Customer */
async function getMyRentals(req, res) {
  try {
    const customerId = req.user.id;
    const [rows] = await pool.query(`
      SELECT 
        ar.id,
        CONCAT('AR-', YEAR(ar.created_at), '-', LPAD(ar.id, 4, '0')) AS rental_ref,
        ar.activity_id,
        a.name AS activity_name,
        a.price_per_unit,
        a.unit,
        ar.start_time,
        ar.end_time,
        ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) AS duration_hours,
        (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * a.price_per_unit) AS total_price,
        COALESCE(paid_tbl.total_paid, 0) AS amount_paid,
        GREATEST(0, (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * a.price_per_unit) - COALESCE(paid_tbl.total_paid, 0)) AS remaining_balance,
        ar.status AS status_raw,
        UPPER(ar.status) AS status,
        ar.notes,
        ar.rejection_reason,
        ar.rejected_at,
        ar.approved_at,
        ar.payment_deadline,
        ar.auto_cancelled,
        ar.created_at,
        ref_tbl.status AS refund_status,
        ref_tbl.amount AS refund_amount
      FROM activity_rentals ar
      JOIN activities a ON a.id = ar.activity_id
      LEFT JOIN (
        SELECT bill.activity_rental_id, SUM(p.amount) AS total_paid
        FROM bills bill
        JOIN payments p ON p.bill_id = bill.id
        WHERE p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%'
        GROUP BY bill.activity_rental_id
      ) paid_tbl ON paid_tbl.activity_rental_id = ar.id
      LEFT JOIN (
        SELECT entity_id, status, amount
        FROM refunds
        WHERE entity_type = 'activity_rental'
      ) ref_tbl ON ref_tbl.entity_id = ar.id
      WHERE ar.customer_id = ?
      ORDER BY ar.created_at DESC
    `, [customerId]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/bookings/rentals — Customer or Staff create activity rental */
async function createRental(req, res) {
  try {
    const { activity_id, start_time, end_time, notes, customer_id, initial_payment, payment_method } = req.body;
    const targetCustomerId = (req.user.role === 'staff' || req.user.role === 'admin') && customer_id
      ? customer_id
      : req.user.id;
    const createdBy = req.user.role !== 'customer' ? req.user.id : null;

    // Check inventory availability
    const [actRows] = await pool.query('SELECT * FROM activities WHERE id = ?', [activity_id]);
    if (actRows.length === 0) return res.status(404).json({ message: 'Activity not found.' });
    const activity = actRows[0];

    // Convert to MySQL DATETIME string: YYYY-MM-DD HH:MM:SS
    const toSqlDateTime = (val) => {
      if (!val) return null;
      const d = new Date(val);
      if (isNaN(d.getTime())) {
        return String(val).replace('T', ' ').replace('Z', '').split('.')[0];
      }
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${y}-${m}-${day} ${h}:${min}:${s}`;
    };

    const sqlStartTime = toSqlDateTime(start_time);
    const sqlEndTime = toSqlDateTime(end_time);

    const [activeRentals] = await pool.query(`
      SELECT COUNT(*) AS active_count
      FROM activity_rentals
      WHERE activity_id = ?
        AND status NOT IN ('cancelled', 'completed', 'rejected')
        AND (start_time < ? AND end_time > ?)
    `, [activity_id, sqlEndTime, sqlStartTime]);

    if (activeRentals[0]?.active_count >= (activity.inventory_count || 1)) {
      return res.status(409).json({ message: 'The Pickleball Court is already booked and unavailable for this time slot.' });
    }

    const durationHours = Math.max(0.5, (new Date(end_time) - new Date(start_time)) / (1000 * 60 * 60));
    const totalPrice = Number(activity.price_per_unit) * durationHours;
    const paymentDeadline = requestLifecycle.getPaymentDeadline();
    let initialStatus = 'pending_payment';

    const [result] = await pool.query(`
      INSERT INTO activity_rentals (customer_id, activity_id, start_time, end_time, status, notes, payment_deadline, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [targetCustomerId, activity_id, sqlStartTime, sqlEndTime, initialStatus, notes || null, paymentDeadline, createdBy]);

    const newRentalId = result.insertId;
    const currentYear = new Date().getFullYear();
    const billNumber = `BILL-ACT-${currentYear}-${String(newRentalId).padStart(4, '0')}`;

    // Create bill
    const [billRes] = await pool.query(`
      INSERT INTO bills (bill_number, customer_id, activity_rental_id, total_amount, paid_amount, status, issued_by, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      billNumber,
      targetCustomerId,
      newRentalId,
      totalPrice,
      initial_payment ? Number(initial_payment) : 0,
      initial_payment >= totalPrice ? 'paid' : (initial_payment > 0 ? 'partially_paid' : 'unpaid'),
      req.user.id || targetCustomerId,
    ]);

    const billId = billRes.insertId;

    await pool.query(`
      INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `, [billId, `${activity.name} (${durationHours} hours)`, durationHours, Number(activity.price_per_unit)]);

    if (initial_payment && Number(initial_payment) > 0) {
      await pool.query(`
        INSERT INTO payments (bill_id, amount, method, received_by, paid_at, notes)
        VALUES (?, ?, ?, ?, NOW(), 'Initial activity payment')
      `, [billId, Number(initial_payment), payment_method || 'cash', req.user.id]);

      const payTransition = await requestLifecycle.handlePaymentReceived('activity_rental', newRentalId, {
        userId: req.user.id,
        userName: req.user.full_name || req.user.username,
      });
      if (payTransition.transitioned) initialStatus = payTransition.newStatus;
    } else {
      await requestLifecycle.logAudit(pool, {
        entityType: 'activity_rental',
        entityId: newRentalId,
        fromStatus: null,
        toStatus: 'pending_payment',
        performedBy: req.user.id,
        performedByName: req.user.full_name || req.user.username,
        triggerType: 'manual',
        reason: 'Court / activity reservation requested. Awaiting payment.',
        metadata: { totalPrice, paymentDeadline },
      });
    }

    res.status(201).json({
      id: newRentalId,
      activity_name: activity.name,
      total_price: totalPrice,
      status: initialStatus.toUpperCase(),
      payment_deadline: paymentDeadline,
      message: 'Court / activity reservation created.',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** PATCH /api/bookings/rentals/:id/approve */
async function approveRental(req, res) {
  try {
    const rentalId = parseInt(req.params.id, 10);
    const result = await requestLifecycle.approveRequest('activity_rental', rentalId, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
}

/** PATCH /api/bookings/rentals/:id/reject */
async function rejectRental(req, res) {
  try {
    const rentalId = parseInt(req.params.id, 10);
    const { reason, notes } = req.body;
    const result = await requestLifecycle.rejectRequest('activity_rental', rentalId, req.user, reason, notes);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
}

/** PATCH /api/bookings/rentals/:id/status */
async function updateRentalStatus(req, res) {
  try {
    const { status, remarks } = req.body;
    const rentalId = parseInt(req.params.id);
    const validStatuses = ['pending_payment', 'pending_approval', 'confirmed', 'active', 'completed', 'cancelled', 'rejected'];
    const normStatus = status.toLowerCase().replace('-', '_');

    if (normStatus === 'confirmed') return await approveRental(req, res);
    if (normStatus === 'rejected') {
      req.body.reason = remarks || 'Staff rejected';
      return await rejectRental(req, res);
    }

    await pool.query('UPDATE activity_rentals SET status = ?, updated_at = NOW() WHERE id = ?', [normStatus, rentalId]);
    res.json({ message: `Rental status updated to ${status}.`, status: normStatus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getAllBookings,
  getApprovalQueue,
  getAwaitingPayment,
  getMyBookings,
  createBooking,
  approveBooking,
  rejectBooking,
  cancelBooking,
  getBookingAuditTrail,
  updateBookingStatus,
  editBooking,
  recordBookingPayment,
  getAllRentals,
  getRentalsSchedule,
  getMyRentals,
  createRental,
  approveRental,
  rejectRental,
  updateRentalStatus,
};
