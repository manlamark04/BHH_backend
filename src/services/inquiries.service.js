const pool = require('../config/db');
const {
  AppError,
  BadRequestError,
  NotFoundError,
  sendSuccess,
  asyncHandler,
} = require('../utils/apiResponse');

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
const createInquiry = asyncHandler(async (req, res) => {
  const { full_name, email, phone, subject, message } = req.body;

  if (!full_name || !email || !subject || !message) {
    throw new BadRequestError('Full name, email, subject, and message are required.');
  }

  const [result] = await pool.query(`
    INSERT INTO inquiries (full_name, email, phone, subject, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'unread', NOW())
  `, [full_name.trim(), email.trim(), phone ? phone.trim() : null, subject.trim(), message.trim()]);

  return sendSuccess(res, {
    id: result.insertId,
  }, 'Thank you! Your inquiry has been sent to our reservations team. We will contact you shortly.', 201);
});

/**
 * GET /api/inquiries
 * Staff/Admin: List guest inquiries
 */
const getInquiries = asyncHandler(async (req, res) => {
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
  return sendSuccess(res, rows);
});

/**
 * PATCH /api/inquiries/:id/status
 * Staff/Admin: Update inquiry status
 */
const updateInquiryStatus = asyncHandler(async (req, res) => {
  const inquiryId = parseInt(req.params.id, 10);
  if (isNaN(inquiryId)) {
    throw new BadRequestError('Invalid inquiry ID.');
  }

  const { status, staff_notes } = req.body;
  const validStatuses = ['unread', 'replied', 'archived'];
  if (status && !validStatuses.includes(status)) {
    throw new BadRequestError(`Status must be one of: ${validStatuses.join(', ')}`);
  }

  const [result] = await pool.query(`
    UPDATE inquiries 
    SET status = COALESCE(?, status),
        staff_notes = COALESCE(?, staff_notes),
        updated_at = NOW()
    WHERE id = ?
  `, [status || null, staff_notes || null, inquiryId]);

  if (result.affectedRows === 0) {
    throw new NotFoundError(`Inquiry with ID #${inquiryId} not found.`);
  }

  return sendSuccess(res, { message: 'Inquiry updated successfully.' });
});

module.exports = {
  createInquiry,
  getInquiries,
  updateInquiryStatus,
};
