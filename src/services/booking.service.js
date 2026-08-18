const pool = require('../config/db');
const db   = require('../db/procedures');

/** GET /api/bookings — Staff/Admin: all bookings with full customer, room, and payment details */
async function getAllBookings(req, res) {
  try {
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
        UPPER(b.status) AS status,
        b.notes,
        b.created_at,
        creator.full_name AS created_by_name
      FROM bookings b
      JOIN users u ON u.id = b.customer_id
      JOIN rooms r ON r.id = b.room_id
      LEFT JOIN users creator ON creator.id = b.created_by
      LEFT JOIN (
        SELECT bill.booking_id, SUM(p.amount) AS total_paid
        FROM bills bill
        JOIN payments p ON p.bill_id = bill.id
        GROUP BY bill.booking_id
      ) paid_tbl ON paid_tbl.booking_id = b.id
      WHERE 1=1
    `;

    const params = [];

    if (status && status !== 'all') {
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

/** GET /api/bookings/my — Customer: own bookings */
async function getMyBookings(req, res) {
  try {
    const bookings = await db.bookings.getForCustomer(req.user.id);
    res.json(bookings);
  } catch (err) {
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
        AND status NOT IN ('cancelled', 'checked_out')
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

    // Insert booking
    const [result] = await pool.query(`
      INSERT INTO bookings (customer_id, room_id, check_in, check_out, status, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, 'confirmed', ?, ?, NOW())
    `, [targetCustomerId, room_id, check_in, check_out, notes || null, createdBy]);

    const newBookingId = result.insertId;
    const currentYear = new Date().getFullYear();
    const bookingRef = `BK-${currentYear}-${String(newBookingId).padStart(4, '0')}`;

    // If initial payment provided, generate bill and record payment
    if (initial_payment && Number(initial_payment) > 0) {
      const billNumber = `BILL-${currentYear}-${String(newBookingId).padStart(4, '0')}`;
      const [billRes] = await pool.query(`
        INSERT INTO bills (bill_number, customer_id, booking_id, total_amount, paid_amount, status, issued_by, issued_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        billNumber,
        targetCustomerId,
        newBookingId,
        totalPrice,
        Number(initial_payment),
        Number(initial_payment) >= totalPrice ? 'paid' : 'partially_paid',
        req.user.id,
      ]);

      const billId = billRes.insertId;
      const validMethod = ['cash', 'card', 'ewallet'].includes(String(payment_method || '').toLowerCase())
        ? String(payment_method).toLowerCase()
        : 'cash';

      await pool.query(`
        INSERT INTO payments (bill_id, amount, method, received_by, paid_at, notes)
        VALUES (?, ?, ?, ?, NOW(), 'Initial reservation payment')
      `, [billId, Number(initial_payment), validMethod, req.user.id]);
    }

    // Audit log
    await pool.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
      VALUES (?, 'CREATE_BOOKING', 'bookings', ?, '127.0.0.1', NOW())
    `, [req.user.id, newBookingId]);

    res.status(201).json({
      id: newBookingId,
      booking_ref: bookingRef,
      total_price: totalPrice,
      message: 'Booking created successfully.',
    });
  } catch (err) {
    console.error('createBooking error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** PATCH /api/bookings/:id/status — Staff/Admin */
async function updateBookingStatus(req, res) {
  try {
    const { status } = req.body;
    const bookingId = parseInt(req.params.id);

    const [bRows] = await pool.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (bRows.length === 0) return res.status(404).json({ message: 'Booking not found.' });
    const booking = bRows[0];

    let normStatus = status.toLowerCase().replace('-', '_').replace(' ', '_');
    if (normStatus === 'completed') normStatus = 'checked_out';

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
    try {
      await pool.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
        VALUES (?, 'UPDATE_BOOKING_STATUS', 'bookings', ?, '127.0.0.1', NOW())
      `, [req.user.id, bookingId]);
    } catch (_) {}

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
        AND status NOT IN ('cancelled', 'checked_out')
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

    res.json({ message: 'Booking updated successfully.', total_price: totalPrice });
  } catch (err) {
    console.error('editBooking error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/bookings/:id/payment — Record payment towards booking */
async function recordBookingPayment(req, res) {
  try {
    const bookingId = parseInt(req.params.id);
    const { amount, payment_method, notes } = req.body;

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

    const validMethod = ['cash', 'card', 'ewallet'].includes(String(payment_method || '').toLowerCase())
      ? String(payment_method).toLowerCase()
      : 'cash';

    // Insert payment
    await pool.query(`
      INSERT INTO payments (bill_id, amount, method, received_by, paid_at, notes)
      VALUES (?, ?, ?, ?, NOW(), ?)
    `, [billId, Number(amount), validMethod, req.user.id, notes || null]);

    // Recalculate bill total paid
    const [paidRows] = await pool.query('SELECT SUM(amount) AS total_paid FROM payments WHERE bill_id = ?', [billId]);
    const totalPaid = Number(paidRows[0]?.total_paid || 0);

    const billStatus = totalPaid >= totalPrice ? 'paid' : (totalPaid > 0 ? 'partially_paid' : 'unpaid');
    await pool.query('UPDATE bills SET paid_amount = ?, status = ? WHERE id = ?', [totalPaid, billStatus, billId]);

    res.json({ message: 'Payment recorded successfully.', total_paid: totalPaid, bill_status: billStatus });
  } catch (err) {
    console.error('recordBookingPayment error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/rentals — Staff/Admin: all activity rentals */
async function getAllRentals(req, res) {
  try {
    const { status } = req.query;
    const rentals = await db.rentals.getAll(status || null);
    res.json(rentals);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/rentals/my — Customer */
async function getMyRentals(req, res) {
  try {
    const rentals = await db.rentals.getForCustomer(req.user.id);
    res.json(rentals);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/rentals */
async function createRental(req, res) {
  try {
    const { activity_id, start_time, end_time, notes, customer_id } = req.body;
    const targetCustomerId = (req.user.role === 'staff' || req.user.role === 'admin') && customer_id
      ? customer_id
      : req.user.id;
    const createdBy = req.user.role !== 'customer' ? req.user.id : null;

    const rental = await db.rentals.create(targetCustomerId, activity_id, start_time, end_time, notes || null, createdBy);
    res.status(201).json(rental);
  } catch (err) {
    if (err.message?.includes('not available')) {
      return res.status(409).json({ message: err.message });
    }
    res.status(500).json({ message: err.message });
  }
}

/** PATCH /api/rentals/:id/status */
async function updateRentalStatus(req, res) {
  try {
    const { status } = req.body;
    const validStatuses = ['confirmed', 'in_use', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    const rental = await db.rentals.updateStatus(parseInt(req.params.id), status);
    if (!rental) return res.status(404).json({ message: 'Rental not found.' });
    res.json(rental);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getAllBookings,
  getMyBookings,
  createBooking,
  updateBookingStatus,
  editBooking,
  recordBookingPayment,
  getAllRentals,
  getMyRentals,
  createRental,
  updateRentalStatus,
};
