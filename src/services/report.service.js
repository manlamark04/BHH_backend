const db   = require('../db/procedures');
const pool = require('../config/db');

/** GET /api/reports/monthly?year=&month= */
async function getMonthlyReport(req, res) {
  try {
    const year  = parseInt(req.query.year  || new Date().getFullYear());
    const month = parseInt(req.query.month || new Date().getMonth() + 1);
    if (month < 1 || month > 12) return res.status(400).json({ message: 'Month must be between 1 and 12.' });
    const report = await db.reports.monthly(year, month);
    res.json({ year, month, ...report });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/reports/yearly?year= */
async function getYearlyReport(req, res) {
  try {
    const year = parseInt(req.query.year || new Date().getFullYear());
    const report = await db.reports.yearly(year);
    res.json({ year, months: report });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/reports/dashboard/staff */
async function getStaffDashboard(req, res) {
  try {
    const stats = await db.dashboards.staff();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/reports/dashboard/admin */
async function getAdminDashboard(req, res) {
  try {
    // 1. KPI Aggregates
    const [revRows] = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total_revenue FROM payments');
    const [monthRevRows] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) AS this_month_rev FROM payments WHERE YEAR(paid_at) = YEAR(NOW()) AND MONTH(paid_at) = MONTH(NOW())'
    );
    const [roomRows] = await pool.query(`
      SELECT 
        COUNT(*) AS total_rooms,
        SUM(CASE WHEN LOWER(status) = 'available' THEN 1 ELSE 0 END) AS available_rooms,
        SUM(CASE WHEN LOWER(status) = 'occupied' THEN 1 ELSE 0 END) AS occupied_rooms,
        SUM(CASE WHEN LOWER(status) = 'cleaning' THEN 1 ELSE 0 END) AS cleaning_rooms,
        SUM(CASE WHEN LOWER(status) = 'maintenance' THEN 1 ELSE 0 END) AS maintenance_rooms
      FROM rooms
    `);
    const [bookingStats] = await pool.query(`
      SELECT 
        COUNT(*) AS total_bookings,
        SUM(CASE WHEN LOWER(status) IN ('confirmed', 'checked_in') THEN 1 ELSE 0 END) AS active_bookings,
        SUM(CASE WHEN LOWER(status) = 'checked_in' THEN 1 ELSE 0 END) AS guests_in_house
      FROM bookings
    `);

    // 2. Last 7 Days Revenue
    const [rev7Days] = await pool.query(`
      SELECT 
        DATE_FORMAT(d.dt, '%Y-%m-%d') AS date_str,
        DATE_FORMAT(d.dt, '%a') AS day_name,
        COALESCE(SUM(p.amount), 0) AS revenue
      FROM (
        SELECT CURDATE() - INTERVAL 6 DAY AS dt UNION ALL
        SELECT CURDATE() - INTERVAL 5 DAY UNION ALL
        SELECT CURDATE() - INTERVAL 4 DAY UNION ALL
        SELECT CURDATE() - INTERVAL 3 DAY UNION ALL
        SELECT CURDATE() - INTERVAL 2 DAY UNION ALL
        SELECT CURDATE() - INTERVAL 1 DAY UNION ALL
        SELECT CURDATE()
      ) d
      LEFT JOIN payments p ON DATE(p.paid_at) = d.dt
      GROUP BY d.dt
      ORDER BY d.dt ASC
    `);

    // 3. Arrivals Today
    const [arrivalsToday] = await pool.query(`
      SELECT 
        b.id,
        CONCAT('BK-', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) AS booking_ref,
        b.check_in, b.check_out, b.status,
        DATEDIFF(b.check_out, b.check_in) AS nights,
        (DATEDIFF(b.check_out, b.check_in) * r.rate_per_night) AS total_price,
        u.id AS customer_id, u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
        r.id AS room_id, r.room_number, r.room_type
      FROM bookings b
      JOIN users u ON b.customer_id = u.id
      JOIN rooms r ON b.room_id = r.id
      WHERE DATE(b.check_in) = CURDATE() AND b.status IN ('confirmed', 'requested')
      ORDER BY b.id DESC
    `);

    // 4. Departures Today
    const [departuresToday] = await pool.query(`
      SELECT 
        b.id,
        CONCAT('BK-', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) AS booking_ref,
        b.check_in, b.check_out, b.status,
        DATEDIFF(b.check_out, b.check_in) AS nights,
        (DATEDIFF(b.check_out, b.check_in) * r.rate_per_night) AS total_price,
        u.id AS customer_id, u.full_name AS customer_name, u.phone AS customer_phone,
        r.id AS room_id, r.room_number, r.room_type
      FROM bookings b
      JOIN users u ON b.customer_id = u.id
      JOIN rooms r ON b.room_id = r.id
      WHERE DATE(b.check_out) = CURDATE() AND b.status = 'checked_in'
      ORDER BY b.id DESC
    `);

    // 5. Upcoming Arrivals
    const [upcomingArrivals] = await pool.query(`
      SELECT 
        b.id,
        CONCAT('BK-', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) AS booking_ref,
        b.check_in, b.check_out, b.status,
        DATEDIFF(b.check_out, b.check_in) AS nights,
        (DATEDIFF(b.check_out, b.check_in) * r.rate_per_night) AS total_price,
        u.full_name AS customer_name,
        r.room_number, r.room_type
      FROM bookings b
      JOIN users u ON b.customer_id = u.id
      JOIN rooms r ON b.room_id = r.id
      WHERE DATE(b.check_in) >= CURDATE() AND b.status IN ('confirmed', 'requested')
      ORDER BY b.check_in ASC
      LIMIT 8
    `);

    // 6. Recent Bookings
    const [recentBookings] = await pool.query(`
      SELECT 
        b.id,
        CONCAT('BK-', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) AS booking_ref,
        b.check_in, b.check_out, b.status, b.created_at,
        (DATEDIFF(b.check_out, b.check_in) * r.rate_per_night) AS total_price,
        u.full_name AS customer_name,
        r.room_number, r.room_type
      FROM bookings b
      JOIN users u ON b.customer_id = u.id
      JOIN rooms r ON b.room_id = r.id
      ORDER BY b.created_at DESC
      LIMIT 8
    `);

    // 7. System Notifications
    const notifications = [];
    const [pendingUsers] = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE status = 'pending'");
    if (pendingUsers[0]?.cnt > 0) {
      notifications.push({
        id: 'notif-pending-users',
        type: 'warning',
        title: 'Customer Approval Required',
        message: `${pendingUsers[0].cnt} walk-in customer account(s) awaiting admin review.`,
        time: 'Action required',
      });
    }

    try {
      const [overdueMotors] = await pool.query("SELECT COUNT(*) AS cnt FROM motor_rentals WHERE status = 'OVERDUE'");
      if (overdueMotors[0]?.cnt > 0) {
        notifications.push({
          id: 'notif-overdue-motor',
          type: 'error',
          title: 'Overdue Motorcycle Return',
          message: `${overdueMotors[0].cnt} motorcycle rental(s) are overdue for return.`,
          time: 'Immediate attention',
        });
      }
    } catch (_) {}

    if (arrivalsToday.length > 0) {
      notifications.push({
        id: 'notif-arrivals-today',
        type: 'info',
        title: 'Expected Arrivals Today',
        message: `${arrivalsToday.length} guest(s) arriving today at Batuan Hammock.`,
        time: 'Today',
      });
    }

    const totalRooms = Number(roomRows[0]?.total_rooms || 1);
    const occupiedRooms = Number(roomRows[0]?.occupied_rooms || 0);
    const occupancyRate = Math.round((occupiedRooms / (totalRooms || 1)) * 100);

    res.json({
      kpis: {
        total_revenue: parseFloat(revRows[0]?.total_revenue || 0),
        this_month_rev: parseFloat(monthRevRows[0]?.this_month_rev || 0),
        occupancy_rate: occupancyRate,
        total_rooms: totalRooms,
        available_rooms: Number(roomRows[0]?.available_rooms || 0),
        occupied_rooms: occupiedRooms,
        cleaning_rooms: Number(roomRows[0]?.cleaning_rooms || 0),
        maintenance_rooms: Number(roomRows[0]?.maintenance_rooms || 0),
        active_bookings: Number(bookingStats[0]?.active_bookings || 0),
        guests_in_house: Number(bookingStats[0]?.guests_in_house || 0),
      },
      revenue_7days: rev7Days,
      arrivals_today: arrivalsToday,
      departures_today: departuresToday,
      upcoming_arrivals: upcomingArrivals,
      recent_bookings: recentBookings,
      notifications,
    });
  } catch (err) {
    console.error('getAdminDashboard error:', err);
    res.status(500).json({ message: err.message });
  }
}

module.exports = { getMonthlyReport, getYearlyReport, getStaffDashboard, getAdminDashboard };
