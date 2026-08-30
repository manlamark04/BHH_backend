const pool = require('../config/db');
const db   = require('../db/procedures');
const requestLifecycle = require('./request-lifecycle.service');

// ── Short-Time Booking Configuration ──────────────────────────
// Hourly rate = (rate_per_night / 24) × SHORT_TIME_MULTIPLIER
// Adjustable here or promote to a settings table later.
const SHORT_TIME_MULTIPLIER = 2.0;
const SHORT_TIME_MAX_HOURS  = 3;

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
        b.booking_type,
        b.check_in_time,
        b.duration_hours,
        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
        CASE
          WHEN b.booking_type = 'short_time' THEN b.duration_hours
          ELSE GREATEST(1, DATEDIFF(b.check_out, b.check_in))
        END AS nights,
        r.capacity AS num_guests,
        CASE
          WHEN b.booking_type = 'short_time' THEN ROUND((r.rate_per_night / 24) * ${SHORT_TIME_MULTIPLIER} * b.duration_hours, 2)
          ELSE (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night)
        END AS total_price,
        COALESCE(paid_tbl.total_paid, 0) AS amount_paid,
        GREATEST(0,
          CASE
            WHEN b.booking_type = 'short_time' THEN ROUND((r.rate_per_night / 24) * ${SHORT_TIME_MULTIPLIER} * b.duration_hours, 2)
            ELSE (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night)
          END - COALESCE(paid_tbl.total_paid, 0)
        ) AS remaining_balance,
        CASE
          WHEN COALESCE(paid_tbl.total_paid, 0) >= (
            CASE
              WHEN b.booking_type = 'short_time' THEN ROUND((r.rate_per_night / 24) * ${SHORT_TIME_MULTIPLIER} * b.duration_hours, 2)
              ELSE (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night)
            END
          ) AND (
            CASE
              WHEN b.booking_type = 'short_time' THEN ROUND((r.rate_per_night / 24) * ${SHORT_TIME_MULTIPLIER} * b.duration_hours, 2)
              ELSE (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night)
            END
          ) > 0 THEN 'PAID'
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
        b.booking_type,
        b.check_in_time,
        b.duration_hours,
        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
        CASE
          WHEN b.booking_type = 'short_time' THEN b.duration_hours
          ELSE GREATEST(1, DATEDIFF(b.check_out, b.check_in))
        END AS nights,
        CASE
          WHEN b.booking_type = 'short_time' THEN ROUND((r.rate_per_night / 24) * ${SHORT_TIME_MULTIPLIER} * b.duration_hours, 2)
          ELSE (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night)
        END AS total_price,
        COALESCE(paid_tbl.total_paid, 0) AS amount_paid,
        GREATEST(0,
          CASE
            WHEN b.booking_type = 'short_time' THEN ROUND((r.rate_per_night / 24) * ${SHORT_TIME_MULTIPLIER} * b.duration_hours, 2)
            ELSE (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night)
          END - COALESCE(paid_tbl.total_paid, 0)
        ) AS remaining_balance,
        CASE
          WHEN COALESCE(paid_tbl.total_paid, 0) >= (
            CASE
              WHEN b.booking_type = 'short_time' THEN ROUND((r.rate_per_night / 24) * ${SHORT_TIME_MULTIPLIER} * b.duration_hours, 2)
              ELSE (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night)
            END
          ) AND (
            CASE
              WHEN b.booking_type = 'short_time' THEN ROUND((r.rate_per_night / 24) * ${SHORT_TIME_MULTIPLIER} * b.duration_hours, 2)
              ELSE (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * r.rate_per_night)
            END
          ) > 0 THEN 'PAID'
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
    const { room_id, check_in, check_out, notes, customer_id, initial_payment, payment_method,
            booking_type, check_in_time, duration_hours } = req.body;
    const targetCustomerId = (req.user.role === 'staff' || req.user.role === 'admin') && customer_id
      ? parseInt(customer_id)
      : req.user.id;
    const createdBy = req.user.role !== 'customer' ? req.user.id : null;

    const isShortTime = booking_type === 'short_time';

    // ── Short-time validation ──
    if (isShortTime) {
      if (!check_in_time) {
        return res.status(400).json({ message: 'Check-in time is required for short-time bookings.' });
      }
      const dur = parseInt(duration_hours, 10);
      if (!dur || dur < 1 || dur > SHORT_TIME_MAX_HOURS) {
        return res.status(400).json({ message: `Duration must be between 1 and ${SHORT_TIME_MAX_HOURS} hours.` });
      }
    }

    // ── Compute effective check_in / check_out datetimes ──
    let effectiveCheckIn = check_in;
    let effectiveCheckOut = check_out;

    if (isShortTime) {
      // Build full datetime strings for overlap checking
      effectiveCheckIn = `${check_in} ${check_in_time}:00`;
      const ciDate = new Date(`${check_in}T${check_in_time}:00`);
      ciDate.setHours(ciDate.getHours() + parseInt(duration_hours, 10));
      const y = ciDate.getFullYear();
      const m = String(ciDate.getMonth() + 1).padStart(2, '0');
      const d = String(ciDate.getDate()).padStart(2, '0');
      const h = String(ciDate.getHours()).padStart(2, '0');
      const min = String(ciDate.getMinutes()).padStart(2, '0');
      effectiveCheckOut = `${y}-${m}-${d} ${h}:${min}:00`;
    }

    // ── Enforce 1-Stay-at-a-Time Rule (Option B: Multiple rooms allowed for same stay) ──
    // A guest who already has an in-progress reservation (pending_payment, pending_approval, confirmed, approved, active, checked_in)
    // can reserve multiple rooms for the same stay dates (family/group trip),
    // but cannot hold separate future or disconnected stays until their current stay is checked out, cancelled, or rejected.
    const [existingStays] = await pool.query(`
      SELECT b.id, b.room_id, b.check_in, b.check_out, b.status, r.room_number, r.room_type, u.full_name AS customer_name
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      JOIN users u ON u.id = b.customer_id
      WHERE b.customer_id = ?
        AND b.status NOT IN ('cancelled', 'checked_out', 'rejected')
      ORDER BY b.id DESC
    `, [targetCustomerId]);

    if (existingStays.length > 0) {
      const hasDateOverlap = existingStays.some((stay) => {
        const stayIn = new Date(stay.check_in).getTime();
        const stayOut = new Date(stay.check_out).getTime();
        const reqIn = new Date(effectiveCheckIn).getTime();
        const reqOut = new Date(effectiveCheckOut).getTime();
        return reqIn < stayOut && reqOut > stayIn;
      });

      if (!hasDateOverlap) {
        const activeStay = existingStays[0];
        const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const stayPeriod = `${formatDate(activeStay.check_in)} – ${formatDate(activeStay.check_out)}`;
        const statusLabel = String(activeStay.status).replace('_', ' ').toUpperCase();

        const message = req.user.role === 'customer'
          ? `You already have a room reservation in progress (Room ${activeStay.room_number} · ${activeStay.room_type}, ${stayPeriod} · ${statusLabel}). You can add extra rooms for this same stay period, but cannot book a separate stay until your current stay is checked out.`
          : `Guest ${activeStay.customer_name || 'Guest'} already has an active room reservation (Room ${activeStay.room_number} · ${activeStay.room_type}, ${stayPeriod} · ${statusLabel}). Only additional rooms for the same stay dates are permitted.`;

        return res.status(409).json({
          conflict: true,
          has_active_stay: true,
          existing_reservation: activeStay,
          message
        });
      }
    }

    // Check room availability (works for both booking types via datetime overlap)
    const [overlap] = await pool.query(`
      SELECT id FROM bookings 
      WHERE room_id = ? 
        AND status NOT IN ('cancelled', 'checked_out', 'rejected')
        AND (check_in < ? AND check_out > ?)
    `, [room_id, effectiveCheckOut, effectiveCheckIn]);

    if (overlap.length > 0) {
      const conflictMsg = isShortTime
        ? 'Room is already booked during the selected time window.'
        : `Room is already reserved for the selected dates (${check_in} to ${check_out}).`;
      return res.status(409).json({ message: conflictMsg });
    }

    // Get room details for rate
    const [roomRows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [room_id]);
    if (roomRows.length === 0) {
      return res.status(404).json({ message: 'Room not found.' });
    }
    const room = roomRows[0];

    // ── Price calculation ──
    let nights, totalPrice, lineDesc;
    if (isShortTime) {
      const dur = parseInt(duration_hours, 10);
      const hourlyRate = (Number(room.rate_per_night) / 24) * SHORT_TIME_MULTIPLIER;
      nights = dur;
      totalPrice = Math.round(hourlyRate * dur * 100) / 100;
      lineDesc = `Short Time - ${room.room_type} Room (${room.room_number}) - ${dur} Hour(s)`;
    } else {
      nights = Math.max(1, Math.ceil((new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24)));
      totalPrice = Number(room.rate_per_night) * nights;
      lineDesc = `${room.room_type} Room (${room.room_number}) - ${nights} Night(s)`;
    }

    // Set payment deadline (e.g. NOW + 24 hours)
    const paymentDeadline = requestLifecycle.getPaymentDeadline();
    let initialStatus = 'pending_payment';

    // Insert booking
    const [result] = await pool.query(`
      INSERT INTO bookings (customer_id, room_id, booking_type, check_in, check_out, check_in_time, duration_hours, status, notes, payment_deadline, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      targetCustomerId, room_id,
      isShortTime ? 'short_time' : 'per_night',
      effectiveCheckIn, effectiveCheckOut,
      isShortTime ? check_in_time : null,
      isShortTime ? parseInt(duration_hours, 10) : null,
      initialStatus, notes || null, paymentDeadline, createdBy,
    ]);

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
    const unitPrice = isShortTime
      ? Math.round(((Number(room.rate_per_night) / 24) * SHORT_TIME_MULTIPLIER) * 100) / 100
      : Number(room.rate_per_night);
    await pool.query(`
      INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `, [billId, lineDesc, nights, unitPrice]);

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
      // Mark room as reserved
      await pool.query("UPDATE rooms SET status = 'reserved', updated_at = NOW() WHERE id = ?", [room_id]);

      // Audit log creation in pending_payment
      await requestLifecycle.logAudit(pool, {
        entityType: 'booking',
        entityId: newBookingId,
        fromStatus: null,
        toStatus: 'pending_payment',
        performedBy: req.user.id,
        performedByName: req.user.full_name || req.user.username,
        triggerType: req.user.role === 'customer' ? 'manual' : 'manual',
        reason: isShortTime
          ? `Short-time booking requested (${duration_hours}h). Awaiting payment.`
          : 'Booking requested by customer. Awaiting payment.',
        metadata: { totalPrice, paymentDeadline, booking_type: isShortTime ? 'short_time' : 'per_night' },
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
      await pool.query("UPDATE rooms SET status = 'occupied', updated_at = NOW() WHERE id = ?", [booking.room_id]);
    } else if (normStatus === 'checked_out' || normStatus === 'completed') {
      await pool.query("UPDATE rooms SET status = 'cleaning', updated_at = NOW() WHERE id = ?", [booking.room_id]);
    } else if (normStatus === 'cancelled') {
      await pool.query("UPDATE rooms SET status = 'available', updated_at = NOW() WHERE id = ?", [booking.room_id]);
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
    const { room_id, check_in, check_out, notes, booking_type, check_in_time, duration_hours } = req.body;

    const [bRows] = await pool.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (bRows.length === 0) return res.status(404).json({ message: 'Booking not found.' });

    const isShortTime = (booking_type || bRows[0].booking_type) === 'short_time';

    // Compute effective datetimes for overlap checking
    let effectiveCheckIn = check_in;
    let effectiveCheckOut = check_out;

    if (isShortTime && check_in_time && duration_hours) {
      effectiveCheckIn = `${check_in} ${check_in_time}:00`;
      const ciDate = new Date(`${check_in}T${check_in_time}:00`);
      ciDate.setHours(ciDate.getHours() + parseInt(duration_hours, 10));
      const y = ciDate.getFullYear();
      const m = String(ciDate.getMonth() + 1).padStart(2, '0');
      const d = String(ciDate.getDate()).padStart(2, '0');
      const h = String(ciDate.getHours()).padStart(2, '0');
      const min = String(ciDate.getMinutes()).padStart(2, '0');
      effectiveCheckOut = `${y}-${m}-${d} ${h}:${min}:00`;
    }

    // Check overlap excluding this booking
    const [overlap] = await pool.query(`
      SELECT id FROM bookings 
      WHERE room_id = ? 
        AND id != ?
        AND status NOT IN ('cancelled', 'checked_out', 'rejected')
        AND (check_in < ? AND check_out > ?)
    `, [room_id, bookingId, effectiveCheckOut, effectiveCheckIn]);

    if (overlap.length > 0) {
      return res.status(409).json({ message: 'Selected room is not available for these dates/times.' });
    }

    // Recalculate price
    const [roomRows] = await pool.query('SELECT rate_per_night FROM rooms WHERE id = ?', [room_id]);
    const room = roomRows[0];
    let totalPrice;

    if (isShortTime && duration_hours) {
      const dur = parseInt(duration_hours, 10);
      const hourlyRate = (Number(room.rate_per_night) / 24) * SHORT_TIME_MULTIPLIER;
      totalPrice = Math.round(hourlyRate * dur * 100) / 100;
    } else {
      const nights = Math.max(1, Math.ceil((new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24)));
      totalPrice = Number(room.rate_per_night) * nights;
    }

    await pool.query(`
      UPDATE bookings 
      SET room_id = ?, booking_type = ?, check_in = ?, check_out = ?, check_in_time = ?, duration_hours = ?, notes = ?, updated_at = NOW()
      WHERE id = ?
    `, [
      room_id,
      isShortTime ? 'short_time' : 'per_night',
      effectiveCheckIn, effectiveCheckOut,
      isShortTime ? check_in_time : null,
      isShortTime ? parseInt(duration_hours, 10) : null,
      notes || null, bookingId,
    ]);

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
    let totalPrice;
    if (booking.booking_type === 'short_time' && booking.duration_hours) {
      const hourlyRate = (Number(roomRows[0]?.rate_per_night || 0) / 24) * SHORT_TIME_MULTIPLIER;
      totalPrice = Math.round(hourlyRate * booking.duration_hours * 100) / 100;
    } else {
      const nights = Math.max(1, Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24)));
      totalPrice = Number(roomRows[0]?.rate_per_night || 0) * nights;
    }

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

/** GET /api/bookings/rentals — Staff/Admin: list all activity rentals */
async function getAllRentals(req, res) {
  try {
    const { status, search, court_id } = req.query;
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
        COALESCE(c.hourly_rate, a.price_per_unit) AS price_per_unit,
        a.unit,
        ar.court_id,
        c.name AS court_name,
        c.court_code,
        ar.start_time,
        ar.end_time,
        ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) AS duration_hours,
        (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * COALESCE(c.hourly_rate, a.price_per_unit)) AS total_price,
        COALESCE(paid_tbl.total_paid, 0) AS amount_paid,
        GREATEST(0, (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * COALESCE(c.hourly_rate, a.price_per_unit)) - COALESCE(paid_tbl.total_paid, 0)) AS remaining_balance,
        CASE 
          WHEN COALESCE(paid_tbl.total_paid, 0) >= (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * COALESCE(c.hourly_rate, a.price_per_unit)) AND (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * COALESCE(c.hourly_rate, a.price_per_unit)) > 0 THEN 'PAID'
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
        COALESCE(ar.extension_count, 0) AS extension_count,
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
      LEFT JOIN courts c ON c.id = ar.court_id
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

    if (court_id && court_id !== 'all' && court_id !== 'All') {
      sql += ` AND ar.court_id = ?`;
      params.push(court_id);
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      sql += ` AND (u.full_name LIKE ? OR u.unique_id LIKE ? OR a.name LIKE ? OR c.name LIKE ? OR ar.id LIKE ?)`;
      params.push(q, q, q, q, q);
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
    const { activity_id, court_id, date } = req.query;
    let sql = `
      SELECT 
        ar.id,
        ar.activity_id,
        a.name AS activity_name,
        ar.court_id,
        c.name AS court_name,
        c.court_code,
        ar.start_time,
        ar.end_time,
        ar.status,
        ar.created_at
      FROM activity_rentals ar
      JOIN activities a ON a.id = ar.activity_id
      LEFT JOIN courts c ON c.id = ar.court_id
      WHERE ar.status NOT IN ('cancelled', 'rejected', 'completed')
    `;
    const params = [];
    if (activity_id) {
      sql += ` AND ar.activity_id = ?`;
      params.push(activity_id);
    }
    if (court_id && court_id !== 'all' && court_id !== 'All') {
      sql += ` AND ar.court_id = ?`;
      params.push(court_id);
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
        COALESCE(c.hourly_rate, a.price_per_unit) AS price_per_unit,
        a.unit,
        ar.court_id,
        c.name AS court_name,
        c.court_code,
        ar.start_time,
        ar.end_time,
        ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) AS duration_hours,
        (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * COALESCE(c.hourly_rate, a.price_per_unit)) AS total_price,
        COALESCE(paid_tbl.total_paid, 0) AS amount_paid,
        GREATEST(0, (ROUND(TIMESTAMPDIFF(MINUTE, ar.start_time, ar.end_time) / 60, 2) * COALESCE(c.hourly_rate, a.price_per_unit)) - COALESCE(paid_tbl.total_paid, 0)) AS remaining_balance,
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
      LEFT JOIN courts c ON c.id = ar.court_id
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
    const {
      activity_id,
      court_id,
      start_time,
      end_time,
      notes,
      customer_id,
      initial_payment,
      payment_method,
    } = req.body;
    const targetCustomerId = (req.user.role === 'staff' || req.user.role === 'admin') && customer_id
      ? customer_id
      : req.user.id;
    const createdBy = req.user.role !== 'customer' ? req.user.id : null;

    // Check activity
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

    const isPickleball =
      activity_id === 2 ||
      String(activity.name || '').toLowerCase().includes('pickleball') ||
      String(activity.name || '').toLowerCase().includes('court');

    let assignedCourt = null;
    let unitRate = Number(activity.price_per_unit);

    if (isPickleball) {
      // Fetch all active courts
      const [allCourts] = await pool.query(
        "SELECT * FROM courts WHERE status != 'INACTIVE' ORDER BY court_code ASC, id ASC"
      );

      if (allCourts.length > 0) {
        if (court_id && court_id !== 'any' && court_id !== 'auto' && court_id !== 0) {
          // Specific court requested
          const targetCourt = allCourts.find((c) => Number(c.id) === Number(court_id));
          if (!targetCourt) {
            return res.status(404).json({ message: 'The specified Pickleball Court does not exist or is inactive.' });
          }
          if (targetCourt.status === 'MAINTENANCE') {
            return res.status(400).json({
              message: `${targetCourt.name} is currently undergoing scheduled maintenance and cannot be reserved.`
            });
          }

          // Check conflict strictly for this court
          const [courtConflicts] = await pool.query(`
            SELECT ar.id, ar.start_time, ar.end_time, u.full_name AS customer_name, c.name AS court_name
            FROM activity_rentals ar
            LEFT JOIN users u ON u.id = ar.customer_id
            LEFT JOIN courts c ON c.id = ar.court_id
            WHERE ar.court_id = ?
              AND ar.status NOT IN ('cancelled', 'completed', 'rejected')
              AND (ar.start_time < ? AND ar.end_time > ?)
            ORDER BY ar.start_time ASC
          `, [targetCourt.id, sqlEndTime, sqlStartTime]);

          if (courtConflicts.length > 0) {
            const conflict = courtConflicts[0];
            const conflictStart = new Date(conflict.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const conflictEnd = new Date(conflict.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            return res.status(409).json({
              conflict: true,
              conflicting_booking: conflict,
              message: `${targetCourt.name} is already booked from ${conflictStart} to ${conflictEnd}. Please select another start time or choose Court B / Any available court.`
            });
          }

          assignedCourt = targetCourt;
          unitRate = Number(targetCourt.hourly_rate || activity.price_per_unit);
        } else {
          // "Any Available Court" / Auto-assign: Evaluate courts in order (Court A first, then Court B, etc.)
          const availableCourts = allCourts.filter((c) => c.status !== 'MAINTENANCE');
          if (availableCourts.length === 0) {
            return res.status(400).json({ message: 'All pickleball courts are currently closed for maintenance.' });
          }

          let candidateCourt = null;
          let earliestConflict = null;

          for (const court of availableCourts) {
            const [courtConflicts] = await pool.query(`
              SELECT ar.id, ar.start_time, ar.end_time, u.full_name AS customer_name, c.name AS court_name
              FROM activity_rentals ar
              LEFT JOIN users u ON u.id = ar.customer_id
              LEFT JOIN courts c ON c.id = ar.court_id
              WHERE ar.court_id = ?
                AND ar.status NOT IN ('cancelled', 'completed', 'rejected')
                AND (ar.start_time < ? AND ar.end_time > ?)
              ORDER BY ar.start_time ASC
            `, [court.id, sqlEndTime, sqlStartTime]);

            if (courtConflicts.length === 0) {
              candidateCourt = court;
              break;
            } else if (!earliestConflict) {
              earliestConflict = courtConflicts[0];
            }
          }

          if (!candidateCourt) {
            const conflictStart = earliestConflict
              ? new Date(earliestConflict.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
              : '';
            const conflictEnd = earliestConflict
              ? new Date(earliestConflict.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
              : '';
            return res.status(409).json({
              conflict: true,
              conflicting_booking: earliestConflict,
              message: `All regulation courts (Court A & Court B) are fully booked for this time window (${conflictStart} to ${conflictEnd}). Please select another time or duration.`
            });
          }

          assignedCourt = candidateCourt;
          unitRate = Number(candidateCourt.hourly_rate || activity.price_per_unit);
        }
      }
    } else {
      // Non-pickleball activity inventory check
      const [activeRentals] = await pool.query(`
        SELECT ar.id, ar.start_time, ar.end_time, u.full_name AS customer_name
        FROM activity_rentals ar
        LEFT JOIN users u ON u.id = ar.customer_id
        WHERE ar.activity_id = ?
          AND ar.status NOT IN ('cancelled', 'completed', 'rejected')
          AND (ar.start_time < ? AND ar.end_time > ?)
        ORDER BY ar.start_time ASC
      `, [activity_id, sqlEndTime, sqlStartTime]);

      if (activeRentals.length >= (activity.inventory_count || 1)) {
        const conflict = activeRentals[0];
        const conflictStart = new Date(conflict.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const conflictEnd = new Date(conflict.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return res.status(409).json({
          conflict: true,
          conflicting_booking: conflict,
          message: `The activity is already fully booked from ${conflictStart} to ${conflictEnd}. Please select another start time or duration.`
        });
      }
    }

    const durationHours = Math.max(0.5, (new Date(end_time) - new Date(start_time)) / (1000 * 60 * 60));
    const totalPrice = unitRate * durationHours;
    const paymentDeadline = requestLifecycle.getPaymentDeadline();
    let initialStatus = 'pending_payment';

    const [result] = await pool.query(`
      INSERT INTO activity_rentals (customer_id, activity_id, court_id, start_time, end_time, status, notes, payment_deadline, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      targetCustomerId,
      activity_id,
      assignedCourt ? assignedCourt.id : null,
      sqlStartTime,
      sqlEndTime,
      initialStatus,
      notes || null,
      paymentDeadline,
      createdBy
    ]);

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
    const lineItemDesc = assignedCourt
      ? `${activity.name} — ${assignedCourt.name} (${durationHours} hours)`
      : `${activity.name} (${durationHours} hours)`;

    await pool.query(`
      INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `, [billId, lineItemDesc, durationHours, unitRate]);

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
        reason: assignedCourt
          ? `Pickleball court reservation requested for ${assignedCourt.name}. Awaiting payment.`
          : 'Court / activity reservation requested. Awaiting payment.',
        metadata: { totalPrice, paymentDeadline, court_id: assignedCourt ? assignedCourt.id : null, court_name: assignedCourt ? assignedCourt.name : null },
      });
    }

    res.status(201).json({
      id: newRentalId,
      activity_name: activity.name,
      court_id: assignedCourt ? assignedCourt.id : null,
      court_name: assignedCourt ? assignedCourt.name : null,
      court_code: assignedCourt ? assignedCourt.court_code : null,
      total_price: totalPrice,
      status: initialStatus.toUpperCase(),
      payment_deadline: paymentDeadline,
      message: assignedCourt
        ? `Court reservation created for ${assignedCourt.name}!`
        : 'Court / activity reservation created.',
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

/**
 * POST /api/bookings/rentals/:id/extend — Staff/Admin only: Extend active court playing time
 */
async function extendRental(req, res) {
  try {
    const rentalId = parseInt(req.params.id, 10);
    const {
      additional_hours,
      payment_method = 'cash',
      amount_paid,
      override_conflict = false,
      override_reason,
      notes,
    } = req.body;

    const numHours = parseFloat(additional_hours);
    if (isNaN(numHours) || numHours <= 0) {
      return res.status(400).json({ message: 'Additional hours must be greater than 0.' });
    }

    // 1. Fetch active rental with court details
    const [rRows] = await pool.query(`
      SELECT 
        ar.*,
        a.name AS activity_name,
        COALESCE(c.hourly_rate, a.price_per_unit) AS effective_rate,
        a.price_per_unit AS activity_price_per_unit,
        a.inventory_count,
        c.name AS court_name,
        c.court_code,
        u.full_name AS customer_name,
        u.email AS customer_email,
        u.phone AS customer_phone
      FROM activity_rentals ar
      JOIN activities a ON a.id = ar.activity_id
      LEFT JOIN courts c ON c.id = ar.court_id
      JOIN users u ON u.id = ar.customer_id
      WHERE ar.id = ?
    `, [rentalId]);

    if (rRows.length === 0) {
      return res.status(404).json({ message: 'Court reservation not found.' });
    }

    const rental = rRows[0];
    const currentStatus = String(rental.status || '').toLowerCase();

    // Must be in active status
    if (currentStatus !== 'active') {
      return res.status(400).json({
        message: `Only currently Active court sessions can be extended. This reservation is currently ${rental.status.toUpperCase()}.`
      });
    }

    const currentEndTime = new Date(rental.end_time);
    if (isNaN(currentEndTime.getTime())) {
      return res.status(400).json({ message: 'Invalid current end time on reservation.' });
    }

    // Compute new end time
    const newEndTimeMs = currentEndTime.getTime() + numHours * 3600 * 1000;
    const newEndTime = new Date(newEndTimeMs);

    const toSqlDateTime = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${y}-${m}-${day} ${h}:${min}:${s}`;
    };

    const sqlCurrentEndTime = toSqlDateTime(currentEndTime);
    const sqlNewEndTime = toSqlDateTime(newEndTime);

    // 2. Conflict Check against other reservations for the EXACT SAME court
    const [conflicts] = await pool.query(`
      SELECT 
        ar2.id,
        ar2.start_time,
        ar2.end_time,
        ar2.status,
        c2.name AS court_name,
        u2.full_name AS customer_name,
        u2.phone AS customer_phone
      FROM activity_rentals ar2
      JOIN users u2 ON u2.id = ar2.customer_id
      LEFT JOIN courts c2 ON c2.id = ar2.court_id
      WHERE (ar2.court_id = ? OR (ar2.court_id IS NULL AND ar2.activity_id = ?))
        AND ar2.id != ?
        AND ar2.status NOT IN ('cancelled', 'rejected', 'completed')
        AND (ar2.start_time < ? AND ar2.end_time > ?)
      ORDER BY ar2.start_time ASC
    `, [rental.court_id || 0, rental.activity_id, rentalId, sqlNewEndTime, sqlCurrentEndTime]);

    if (conflicts.length > 0) {
      const firstConflict = conflicts[0];
      const formatConflictTime = (dt) => {
        try {
          return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        } catch (_) { return String(dt); }
      };

      const courtName = rental.court_name || 'Court';
      if (!override_conflict) {
        return res.status(409).json({
          conflict: true,
          conflicting_booking: firstConflict,
          message: `Cannot extend — ${courtName} is booked by ${firstConflict.customer_name} starting at ${formatConflictTime(firstConflict.start_time)}.`,
        });
      }

      // Override confirmed by staff
      if (!override_reason || !override_reason.trim()) {
        return res.status(400).json({
          message: 'An explicit override reason is required when bypassing a schedule conflict.'
        });
      }
    }

    // 3. Calculate additional fee & validate payment
    const ratePerHour = Number(rental.effective_rate || rental.price_per_unit || 150);
    const additionalCost = numHours * ratePerHour;
    const numPaid = parseFloat(amount_paid);

    if (isNaN(numPaid) || numPaid < additionalCost - 0.01) {
      return res.status(400).json({
        message: `Extension requires full payment of ₱${additionalCost.toLocaleString()} (₱${ratePerHour}/hr × ${numHours} hr${numHours > 1 ? 's' : ''}). Received: ₱${(numPaid || 0).toLocaleString()}.`
      });
    }

    // 4. Update activity_rentals record
    try {
      await pool.query('ALTER TABLE activity_rentals ADD COLUMN IF NOT EXISTS extension_count INT NOT NULL DEFAULT 0');
    } catch (_) {}

    await pool.query(`
      UPDATE activity_rentals
      SET end_time = ?,
          extension_count = COALESCE(extension_count, 0) + 1,
          updated_at = NOW()
      WHERE id = ?
    `, [sqlNewEndTime, rentalId]);

    // 5. Update bills & payments
    let targetBillId = null;
    const [bRows] = await pool.query('SELECT id, total_amount, paid_amount FROM bills WHERE activity_rental_id = ? ORDER BY id DESC LIMIT 1', [rentalId]);

    if (bRows.length > 0) {
      targetBillId = bRows[0].id;
      const newTotal = Number(bRows[0].total_amount || 0) + additionalCost;
      const newPaid = Number(bRows[0].paid_amount || 0) + additionalCost;

      await pool.query(`
        UPDATE bills
        SET total_amount = ?, paid_amount = ?, status = 'paid', updated_at = NOW()
        WHERE id = ?
      `, [newTotal, newPaid, targetBillId]);
    } else {
      const billNumber = `BILL-ACT-${new Date().getFullYear()}-${String(rentalId).padStart(4, '0')}`;
      const [newBill] = await pool.query(`
        INSERT INTO bills (bill_number, customer_id, activity_rental_id, total_amount, paid_amount, status, issued_by, issued_at)
        VALUES (?, ?, ?, ?, ?, 'paid', ?, NOW())
      `, [billNumber, rental.customer_id, rentalId, additionalCost, additionalCost, req.user.id]);
      targetBillId = newBill.insertId;
    }

    // Add line item
    const courtNameSuffix = rental.court_name ? ` · ${rental.court_name}` : '';
    const lineDesc = `Court Extension (+${numHours} hr${numHours > 1 ? 's' : ''}${courtNameSuffix}) · New End: ${newEndTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    await pool.query(`
      INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `, [targetBillId, lineDesc, numHours, ratePerHour]);

    // Record payment transaction
    const validMethods = ['cash', 'card', 'ewallet', 'bank_transfer', 'gcash', 'maya', 'corporate', 'other'];
    const normMethod = validMethods.includes(String(payment_method).toLowerCase()) ? String(payment_method).toLowerCase() : 'cash';
    const payNotes = [
      `Extension payment (+${numHours} hr${numHours > 1 ? 's' : ''})`,
      override_conflict ? `[CONFLICT OVERRIDE: ${override_reason.trim()}]` : '',
      notes || '',
    ].filter(Boolean).join(' · ');

    await pool.query(`
      INSERT INTO payments (bill_id, amount, method, received_by, paid_at, notes)
      VALUES (?, ?, ?, ?, NOW(), ?)
    `, [targetBillId, numPaid, normMethod, req.user.id, payNotes]);

    // Audit log
    await requestLifecycle.logAudit(pool, {
      entityType: 'activity_rental',
      entityId: rentalId,
      fromStatus: 'active',
      toStatus: 'active',
      performedBy: req.user.id,
      performedByName: req.user.full_name || req.user.username,
      triggerType: 'extension',
      reason: `Extended playing time by ${numHours} hour(s) for ${rental.court_name || 'Pickleball Court'}. New end time: ${newEndTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}.${override_conflict ? ` Conflict overridden: ${override_reason}` : ''}`,
      metadata: {
        previous_end_time: rental.end_time,
        new_end_time: sqlNewEndTime,
        additional_hours: numHours,
        amount_paid: numPaid,
        court_id: rental.court_id,
        court_name: rental.court_name,
        payment_method: normMethod,
        override_conflict,
        override_reason: override_reason || null,
      },
    });

    res.json({
      success: true,
      message: `Court session successfully extended by ${numHours} hour(s) until ${newEndTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}!`,
      new_end_time: sqlNewEndTime,
      additional_cost: additionalCost,
      extension_count: (rental.extension_count || 0) + 1,
      court_name: rental.court_name,
    });
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
  extendRental,
};
