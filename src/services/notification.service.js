const pool = require('../config/db');

/**
 * GET /api/notifications/summary
 * Retrieves counts and top actionable items for Staff and Admins:
 * 1. Pending user registrations
 * 2. Pending booking / service requests
 * 3. Today's scheduled arrivals (check-in)
 * 4. Today's scheduled departures (check-out)
 * 5. Unpaid / pending payment invoices
 */
async function getNotificationSummary(req, res) {
  try {
    // 1. Pending customer account registrations
    const [pendingUsers] = await pool.query(`
      SELECT id, full_name, username, email, created_at
      FROM users
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // 2. Pending room & service bookings
    const [pendingBookings] = await pool.query(`
      SELECT b.id, b.booking_ref, b.booking_type, b.check_in, b.check_out, b.created_at,
             u.full_name AS customer_name, r.room_number, r.room_type
      FROM bookings b
      JOIN users u ON u.id = b.customer_id
      LEFT JOIN rooms r ON r.id = b.room_id
      WHERE b.status IN ('pending', 'pending_approval', 'requested')
      ORDER BY b.created_at DESC
      LIMIT 10
    `);

    // 3. Today's scheduled arrivals (check-in)
    const [todayArrivals] = await pool.query(`
      SELECT b.id, b.booking_ref, b.check_in, b.check_out, b.status,
             u.full_name AS customer_name, u.phone AS customer_phone, r.room_number, r.room_type
      FROM bookings b
      JOIN users u ON u.id = b.customer_id
      LEFT JOIN rooms r ON r.id = b.room_id
      WHERE DATE(b.check_in) = CURRENT_DATE()
        AND b.status IN ('confirmed', 'approved')
      ORDER BY b.check_in ASC
      LIMIT 10
    `);

    // 4. Today's scheduled departures (check-out)
    const [todayDepartures] = await pool.query(`
      SELECT b.id, b.booking_ref, b.check_in, b.check_out, b.status,
             u.full_name AS customer_name, u.phone AS customer_phone, r.room_number, r.room_type
      FROM bookings b
      JOIN users u ON u.id = b.customer_id
      LEFT JOIN rooms r ON r.id = b.room_id
      WHERE DATE(b.check_out) = CURRENT_DATE()
        AND b.status = 'checked_in'
      ORDER BY b.check_out ASC
      LIMIT 10
    `);

    // 5. Unpaid / pending payment invoices requiring collection
    const [pendingInvoices] = await pool.query(`
      SELECT bill.id, bill.invoice_number, bill.total_amount, bill.paid_amount,
             (bill.total_amount - bill.paid_amount) AS remaining_balance,
             bill.status, bill.issued_at, u.full_name AS customer_name
      FROM bills bill
      JOIN users u ON u.id = bill.customer_id
      WHERE bill.status IN ('unpaid', 'pending', 'partially_paid')
        AND (bill.total_amount - bill.paid_amount) > 0
      ORDER BY bill.issued_at DESC
      LIMIT 10
    `);

    // Calculate total actionable badge count
    const totalCount =
      pendingUsers.length +
      pendingBookings.length +
      todayArrivals.length +
      todayDepartures.length;

    res.json({
      totalCount,
      summary: {
        pendingUsersCount: pendingUsers.length,
        pendingBookingsCount: pendingBookings.length,
        todayArrivalsCount: todayArrivals.length,
        todayDeparturesCount: todayDepartures.length,
        pendingInvoicesCount: pendingInvoices.length,
      },
      items: {
        pendingUsers,
        pendingBookings,
        todayArrivals,
        todayDepartures,
        pendingInvoices,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('getNotificationSummary error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch notification summary' });
  }
}

module.exports = {
  getNotificationSummary,
};
