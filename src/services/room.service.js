const pool = require('../config/db');
const db   = require('../db/procedures');

/** GET /api/rooms — public/customer/admin: room catalog */
async function getRooms(req, res) {
  try {
    const { status, search } = req.query;

    let query = `
      SELECT 
        r.id,
        r.room_number,
        r.room_type,
        r.capacity,
        r.rate_per_night,
        CASE
          WHEN LOWER(r.status) IN ('maintenance', 'cleaning', 'unavailable', 'inactive') THEN LOWER(r.status)
          WHEN occ_bkg.id IS NOT NULL THEN 'occupied'
          WHEN res_bkg.id IS NOT NULL THEN 'reserved'
          ELSE 'available'
        END AS status,
        r.description,
        r.image_urls,
        r.created_at,
        r.updated_at,
        COALESCE(occ_bkg.id, res_bkg.id, NULL) AS current_booking_id,
        COALESCE(occ_bkg.customer_name, res_bkg.customer_name, NULL) AS current_guest_name,
        COALESCE(occ_bkg.check_in, res_bkg.check_in, NULL) AS current_check_in,
        COALESCE(occ_bkg.check_out, res_bkg.check_out, NULL) AS current_check_out
      FROM rooms r
      LEFT JOIN (
        SELECT 
          b.id, b.room_id, u.full_name AS customer_name, b.check_in, b.check_out
        FROM bookings b
        JOIN users u ON u.id = b.customer_id
        LEFT JOIN (
          SELECT bill.booking_id, SUM(p.amount) AS total_paid
          FROM bills bill
          JOIN payments p ON p.bill_id = bill.id
          WHERE p.notes IS NULL OR p.notes NOT LIKE '%[REFUNDED%'
          GROUP BY bill.booking_id
        ) paid_tbl ON paid_tbl.booking_id = b.id
        JOIN rooms rm ON rm.id = b.room_id
        WHERE b.status = 'checked_in'
           OR (b.status IN ('confirmed', 'pending_approval') AND COALESCE(paid_tbl.total_paid, 0) >= (GREATEST(1, DATEDIFF(b.check_out, b.check_in)) * rm.rate_per_night) AND COALESCE(paid_tbl.total_paid, 0) > 0)
      ) occ_bkg ON occ_bkg.room_id = r.id
      LEFT JOIN (
        SELECT 
          b.id, b.room_id, u.full_name AS customer_name, b.check_in, b.check_out
        FROM bookings b
        JOIN users u ON u.id = b.customer_id
        WHERE b.status NOT IN ('cancelled', 'checked_out', 'rejected')
      ) res_bkg ON res_bkg.room_id = r.id
      WHERE 1=1
    `;

    const params = [];

    if (status && status !== 'all') {
      query += ` AND LOWER(r.status) = ?`;
      params.push(status.toLowerCase());
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ` AND (r.room_number LIKE ? OR r.room_type LIKE ? OR r.description LIKE ?)`;
      params.push(s, s, s);
    }

    query += ` ORDER BY CAST(r.room_number AS UNSIGNED) ASC, r.room_number ASC`;

    const [rows] = await pool.query(query, params);

    // Normalize image_urls
    const mapped = rows.map((r) => {
      let images = [];
      try {
        if (typeof r.image_urls === 'string') images = JSON.parse(r.image_urls);
        else if (Array.isArray(r.image_urls)) images = r.image_urls;
      } catch (_) {}
      return {
        ...r,
        name: `Room ${r.room_number}`,
        type: r.room_type,
        price_per_night: Number(r.rate_per_night),
        max_guests: Number(r.capacity),
        image_urls: images,
        image: images[0] || 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&auto=format&fit=crop&q=80',
      };
    });

    res.json(mapped);
  } catch (err) {
    console.error('getRooms error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/rooms/available?check_in=&check_out= */
async function getAvailableRooms(req, res) {
  try {
    const { check_in, check_out } = req.query;
    if (!check_in || !check_out) {
      return res.status(400).json({ message: 'check_in and check_out are required.' });
    }
    const rooms = await db.rooms.getAvailable(check_in, check_out);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/rooms — Admin: create room */
async function createRoom(req, res) {
  try {
    const { room_number, room_type, capacity, rate_per_night, status, description, image_urls } = req.body;

    // Check duplicate room number
    const [existing] = await pool.query('SELECT id FROM rooms WHERE room_number = ?', [room_number.trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ message: `Room ${room_number.trim()} already exists.` });
    }

    const imagesJson = JSON.stringify(Array.isArray(image_urls) ? image_urls : (image_urls ? [image_urls] : []));

    const [result] = await pool.query(`
      INSERT INTO rooms (room_number, room_type, capacity, rate_per_night, status, description, image_urls, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      room_number.trim(),
      room_type.trim(),
      Number(capacity) || 2,
      Number(rate_per_night) || 0,
      status || 'available',
      description || null,
      imagesJson,
    ]);

    const newId = result.insertId;

    // Audit log
    try {
      await pool.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
        VALUES (?, 'CREATE_ROOM', 'rooms', ?, '127.0.0.1', NOW())
      `, [req.user.id, newId]);
    } catch (_) {}

    res.status(201).json({
      id: newId,
      room_number,
      room_type,
      capacity,
      rate_per_night,
      status: status || 'available',
      message: `Room ${room_number} created successfully.`,
    });
  } catch (err) {
    console.error('createRoom error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** PUT /api/rooms/:id — Admin: update room */
async function updateRoom(req, res) {
  try {
    const roomId = parseInt(req.params.id);
    const { room_number, room_type, capacity, rate_per_night, status, description, image_urls } = req.body;

    // Check duplicate room number on other rooms
    const [dup] = await pool.query('SELECT id FROM rooms WHERE room_number = ? AND id != ?', [room_number.trim(), roomId]);
    if (dup.length > 0) {
      return res.status(409).json({ message: `Room number ${room_number.trim()} is already taken by another room.` });
    }

    const imagesJson = JSON.stringify(Array.isArray(image_urls) ? image_urls : (image_urls ? [image_urls] : []));

    await pool.query(`
      UPDATE rooms 
      SET room_number = ?, room_type = ?, capacity = ?, rate_per_night = ?, status = ?, description = ?, image_urls = ?, updated_at = NOW()
      WHERE id = ?
    `, [
      room_number.trim(),
      room_type.trim(),
      Number(capacity) || 2,
      Number(rate_per_night) || 0,
      status || 'available',
      description || null,
      imagesJson,
      roomId,
    ]);

    // Audit log
    try {
      await pool.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
        VALUES (?, 'UPDATE_ROOM', 'rooms', ?, '127.0.0.1', NOW())
      `, [req.user.id, roomId]);
    } catch (_) {}

    res.json({ message: `Room ${room_number} updated successfully.` });
  } catch (err) {
    console.error('updateRoom error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** PATCH /api/rooms/:id/status — Admin: change room status */
async function updateRoomStatus(req, res) {
  try {
    const roomId = parseInt(req.params.id);
    const { status, remarks } = req.body;

    const valid = ['available', 'occupied', 'cleaning', 'maintenance', 'inactive'];
    const norm = String(status || '').toLowerCase();
    if (!valid.includes(norm)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${valid.join(', ')}` });
    }

    await pool.query('UPDATE rooms SET status = ?, updated_at = NOW() WHERE id = ?', [norm, roomId]);

    // Audit log
    try {
      await pool.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
        VALUES (?, 'UPDATE_ROOM_STATUS', 'rooms', ?, '127.0.0.1', NOW())
      `, [req.user.id, roomId]);
    } catch (_) {}

    res.json({ message: `Room status updated to ${norm.toUpperCase()}${remarks ? ` (${remarks})` : ''}.`, status: norm });
  } catch (err) {
    console.error('updateRoomStatus error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** DELETE /api/rooms/:id — Admin: delete or deactivate room */
async function deleteRoom(req, res) {
  try {
    const roomId = parseInt(req.params.id);

    // Check if room has historical bookings
    const [bRows] = await pool.query('SELECT COUNT(*) AS cnt FROM bookings WHERE room_id = ?', [roomId]);
    const hasBookings = (bRows[0]?.cnt || 0) > 0;

    if (hasBookings) {
      await pool.query("UPDATE rooms SET status = 'inactive', updated_at = NOW() WHERE id = ?", [roomId]);
      return res.json({ message: 'Room has historical bookings and was safely set to INACTIVE instead of permanent deletion.' });
    }

    await pool.query('DELETE FROM rooms WHERE id = ?', [roomId]);

    // Audit log
    try {
      await pool.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
        VALUES (?, 'DELETE_ROOM', 'rooms', ?, '127.0.0.1', NOW())
      `, [req.user.id, roomId]);
    } catch (_) {}

    res.json({ message: 'Room deleted successfully.' });
  } catch (err) {
    console.error('deleteRoom error:', err);
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getRooms,
  getAvailableRooms,
  createRoom,
  updateRoom,
  updateRoomStatus,
  deleteRoom,
};
