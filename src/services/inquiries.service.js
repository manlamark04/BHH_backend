const pool = require('../config/db');

// Ensure table exists on first load
async function ensureInquiriesTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inquiries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL,
        phone VARCHAR(50) NULL,
        subject VARCHAR(150) NOT NULL,
        message TEXT NOT NULL,
        status ENUM('unread', 'replied', 'archived') DEFAULT 'unread',
        staff_notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.warn('Could not verify/create inquiries table:', err.message);
  }
}
ensureInquiriesTable();

/**
 * POST /api/inquiries
 * Public: Submit a guest inquiry
 */
async function createInquiry(req, res) {
  try {
    const { full_name, email, phone, subject, message } = req.body;

    if (!full_name || !email || !subject || !message) {
      return res.status(400).json({ message: 'Full name, email, subject, and message are required.' });
    }

    const [result] = await pool.query(`
      INSERT INTO inquiries (full_name, email, phone, subject, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'unread', NOW())
    `, [full_name.trim(), email.trim(), phone ? phone.trim() : null, subject.trim(), message.trim()]);

    res.status(201).json({
      message: 'Thank you! Your inquiry has been sent to our reservations team. We will contact you shortly.',
      id: result.insertId,
    });
  } catch (err) {
    console.error('createInquiry error:', err);
    res.status(500).json({ message: err.message || 'Failed to submit inquiry.' });
  }
}

/**
 * GET /api/inquiries
 * Staff/Admin: List guest inquiries
 */
async function getInquiries(req, res) {
  try {
    const { status } = req.query;
    let query = `
      SELECT id, full_name, email, phone, subject, message, status, staff_notes, created_at, updated_at
      FROM inquiries
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ` WHERE status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT 100`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('getInquiries error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch inquiries.' });
  }
}

/**
 * PATCH /api/inquiries/:id/status
 * Staff/Admin: Update inquiry status
 */
async function updateInquiryStatus(req, res) {
  try {
    const inquiryId = parseInt(req.params.id);
    const { status, staff_notes } = req.body;

    const validStatuses = ['unread', 'replied', 'archived'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    await pool.query(`
      UPDATE inquiries 
      SET status = COALESCE(?, status),
          staff_notes = COALESCE(?, staff_notes),
          updated_at = NOW()
      WHERE id = ?
    `, [status || null, staff_notes || null, inquiryId]);

    res.json({ message: 'Inquiry updated successfully.' });
  } catch (err) {
    console.error('updateInquiryStatus error:', err);
    res.status(500).json({ message: err.message || 'Failed to update inquiry.' });
  }
}

module.exports = {
  createInquiry,
  getInquiries,
  updateInquiryStatus,
};
