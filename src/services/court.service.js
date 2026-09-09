const pool = require('../config/db');

/** GET /api/courts — List all pickleball courts with live availability and ongoing session info */
async function getCourts(req, res) {
  try {
    const { status } = req.query;
    let sql = `
      SELECT 
        c.id,
        c.court_code,
        c.name,
        c.hourly_rate,
        c.status,
        c.description,
        c.image_url,
        c.created_at,
        c.updated_at
      FROM courts c
      WHERE 1=1
    `;
    const params = [];
    if (status && status !== 'all' && status !== 'All') {
      sql += ` AND UPPER(c.status) = ?`;
      params.push(status.toUpperCase());
    }
    sql += ` ORDER BY c.id ASC`;

    const [courts] = await pool.query(sql, params);

    // Fetch active and upcoming reservations for each court to populate real-time card details
    const [activeRentals] = await pool.query(`
      SELECT 
        ar.id AS rental_id,
        ar.court_id,
        ar.start_time,
        ar.end_time,
        ar.status,
        ar.notes,
        u.id AS customer_id,
        u.full_name AS customer_name,
        u.phone AS customer_phone
      FROM activity_rentals ar
      JOIN users u ON u.id = ar.customer_id
      WHERE ar.court_id IS NOT NULL
        AND ar.status IN ('active', 'confirmed', 'approved', 'pending_payment', 'pending_approval', 'pending')
      ORDER BY ar.start_time ASC
    `);

    // Fetch summary stats per court
    const [statsRows] = await pool.query(`
      SELECT 
        ar.court_id,
        COUNT(ar.id) AS total_bookings,
        SUM(CASE WHEN ar.status IN ('completed', 'active') THEN 1 ELSE 0 END) AS completed_or_active_bookings,
        SUM(COALESCE(paid_tbl.total_paid, 0)) AS total_revenue
      FROM activity_rentals ar
      LEFT JOIN (
        SELECT bill.activity_rental_id, SUM(p.amount) AS total_paid
        FROM bills bill
        JOIN payments p ON p.bill_id = bill.id
        WHERE p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%'
        GROUP BY bill.activity_rental_id
      ) paid_tbl ON paid_tbl.activity_rental_id = ar.id
      WHERE ar.court_id IS NOT NULL
        AND ar.status NOT IN ('cancelled', 'rejected')
      GROUP BY ar.court_id
    `);

    const statsMap = {};
    for (const row of statsRows) {
      statsMap[row.court_id] = {
        total_bookings: Number(row.total_bookings || 0),
        completed_or_active: Number(row.completed_or_active_bookings || 0),
        total_revenue: Number(row.total_revenue || 0),
      };
    }

    const courtsWithLiveState = courts.map((court) => {
      const courtRentals = activeRentals.filter((r) => r.court_id === court.id);
      const activeMatch = courtRentals.find((r) => String(r.status).toLowerCase() === 'active');
      const upcomingMatch = courtRentals.find((r) => ['confirmed', 'approved'].includes(String(r.status).toLowerCase()));
      const pendingMatch = courtRentals.find((r) => ['pending_payment', 'pending_approval', 'pending'].includes(String(r.status).toLowerCase()));

      let liveStatus = court.status;
      if (court.status === 'AVAILABLE') {
        if (activeMatch) {
          liveStatus = 'IN_MATCH';
        } else if (pendingMatch || upcomingMatch) {
          liveStatus = 'RESERVED';
        }
      }

      return {
        ...court,
        hourly_rate: Number(court.hourly_rate),
        live_status: liveStatus,
        current_active_match: activeMatch || null,
        upcoming_match: upcomingMatch || null,
        pending_match: pendingMatch || null,
        stats: statsMap[court.id] || { total_bookings: 0, completed_or_active: 0, total_revenue: 0 },
      };
    });

    res.json(courtsWithLiveState);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/courts/:id — Get single court */
async function getCourtById(req, res) {
  try {
    const courtId = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT * FROM courts WHERE id = ?', [courtId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Court not found.' });
    }
    const court = rows[0];
    court.hourly_rate = Number(court.hourly_rate);
    res.json(court);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/courts — Admin: Add new court entity */
async function createCourt(req, res) {
  try {
    const { court_code, name, hourly_rate = 150.00, status = 'AVAILABLE', description, image_url } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Court name is required.' });
    }

    // Auto-generate court code if not provided
    let finalCode = court_code ? court_code.trim().toUpperCase() : '';
    if (!finalCode) {
      const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM courts');
      const letterIndex = countRows[0].total;
      const letter = String.fromCharCode(65 + letterIndex); // A, B, C, D...
      finalCode = `COURT-${letter}`;
    }

    // Check unique code
    const [existing] = await pool.query('SELECT id FROM courts WHERE court_code = ?', [finalCode]);
    if (existing.length > 0) {
      return res.status(400).json({ message: `Court code ${finalCode} is already registered.` });
    }

    const rate = parseFloat(hourly_rate) || 150.00;
    const normStatus = ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'INACTIVE'].includes(String(status).toUpperCase())
      ? String(status).toUpperCase()
      : 'AVAILABLE';

    const [result] = await pool.query(`
      INSERT INTO courts (court_code, name, hourly_rate, status, description, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [finalCode, name.trim(), rate, normStatus, description || null, image_url || null]);

    // Also update activity inventory_count on Pickleball activity record if present
    try {
      const [allCourts] = await pool.query('SELECT COUNT(*) as total FROM courts WHERE status != "INACTIVE"');
      await pool.query('UPDATE activities SET inventory_count = ? WHERE id = 2 OR LOWER(name) LIKE "%pickleball%"', [allCourts[0].total]);
    } catch (_) {}

    const [created] = await pool.query('SELECT * FROM courts WHERE id = ?', [result.insertId]);
    created[0].hourly_rate = Number(created[0].hourly_rate);

    res.status(201).json({
      message: `Court "${name.trim()}" registered successfully!`,
      court: created[0],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** PUT /api/courts/:id — Admin: Edit court details & rate */
async function updateCourt(req, res) {
  try {
    const courtId = parseInt(req.params.id, 10);
    const { name, hourly_rate, status, description, image_url } = req.body;

    const [existing] = await pool.query('SELECT * FROM courts WHERE id = ?', [courtId]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Court not found.' });
    }

    const updatedName = name !== undefined ? name.trim() : existing[0].name;
    const updatedRate = hourly_rate !== undefined ? parseFloat(hourly_rate) : existing[0].hourly_rate;
    const updatedStatus = status !== undefined ? String(status).toUpperCase() : existing[0].status;
    const updatedDesc = description !== undefined ? description : existing[0].description;
    const updatedImage = image_url !== undefined ? image_url : existing[0].image_url;

    await pool.query(`
      UPDATE courts
      SET name = ?, hourly_rate = ?, status = ?, description = ?, image_url = ?, updated_at = NOW()
      WHERE id = ?
    `, [updatedName, updatedRate, updatedStatus, updatedDesc, updatedImage, courtId]);

    const [updated] = await pool.query('SELECT * FROM courts WHERE id = ?', [courtId]);
    updated[0].hourly_rate = Number(updated[0].hourly_rate);

    res.json({
      message: `Court "${updatedName}" updated successfully!`,
      court: updated[0],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** PATCH /api/courts/:id/status — Staff/Admin: Toggle or update court status */
async function updateCourtStatus(req, res) {
  try {
    const courtId = parseInt(req.params.id, 10);
    const { status } = req.body;

    const validStatuses = ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'INACTIVE'];
    const normStatus = String(status || '').toUpperCase();

    if (!validStatuses.includes(normStatus)) {
      return res.status(400).json({ message: `Invalid court status: ${status}. Must be one of: ${validStatuses.join(', ')}` });
    }

    const [existing] = await pool.query('SELECT * FROM courts WHERE id = ?', [courtId]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Court not found.' });
    }

    await pool.query('UPDATE courts SET status = ?, updated_at = NOW() WHERE id = ?', [normStatus, courtId]);

    res.json({
      message: `Court status updated to ${normStatus}.`,
      status: normStatus,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getCourts,
  getCourtById,
  createCourt,
  updateCourt,
  updateCourtStatus,
};
