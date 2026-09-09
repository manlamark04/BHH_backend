const pool = require('../config/db');

// Ensure audit_logs table exists
async function ensureAuditTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        user_name VARCHAR(255) NULL,
        user_role VARCHAR(50) NULL,
        action VARCHAR(100) NOT NULL,
        module VARCHAR(100) NULL,
        description TEXT NULL,
        entity_type VARCHAR(50) NULL,
        entity_id INT NULL,
        ip_address VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_al_created (created_at),
        INDEX idx_al_module (module)
      ) ENGINE=InnoDB;
    `);
  } catch (err) {
    console.warn('ensureAuditTable error:', err.message);
  }
}

// Helper to record an audit log entry
async function logAction({
  userId = null,
  userName = 'System',
  userRole = 'system',
  action,
  module = 'SYSTEM',
  description,
  entityType = null,
  entityId = null,
  ipAddress = null,
}) {
  try {
    await ensureAuditTable();
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, module, description, entity_type, entity_id, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [userId, userName, userRole, action.toUpperCase(), module.toUpperCase(), description, entityType, entityId, ipAddress]
    );
  } catch (err) {
    console.warn('Failed to write to audit_logs:', err.message);
  }
}

// Get unified audit trail combining audit_logs, request_audit_logs, customer_audit_logs, motor_rental_audit_logs
async function getAuditTrail(req, res) {
  try {
    await ensureAuditTable();
    const { q, module, limit = 150 } = req.query;

    const allLogs = [];

    // 1. Fetch from audit_logs table
    try {
      const [customLogs] = await pool.query(
        `SELECT 
          CONCAT('gen-', id) AS id,
          action,
          module,
          description,
          IFNULL(user_name, 'System') AS userName,
          IFNULL(user_role, 'admin') AS userRole,
          created_at AS createdAt
         FROM audit_logs
         ORDER BY created_at DESC
         LIMIT 100`
      );
      allLogs.push(...customLogs);
    } catch (err) {
      console.warn('audit_logs read error:', err.message);
    }

    // 2. Fetch from customer_audit_logs table
    try {
      const [customerLogs] = await pool.query(
        `SELECT 
          CONCAT('cust-', id) AS id,
          action,
          'USERS' AS module,
          CONCAT(remarks, ' (Guest: ', customer_unique_id, ')') AS description,
          IFNULL(performed_by_name, 'System Admin') AS userName,
          IFNULL(performed_by_role, 'admin') AS userRole,
          created_at AS createdAt
         FROM customer_audit_logs
         ORDER BY created_at DESC
         LIMIT 100`
      );
      allLogs.push(...customerLogs);
    } catch (err) {
      console.warn('customer_audit_logs read error:', err.message);
    }

    // 3. Fetch from request_audit_logs table (Bookings & Rentals)
    try {
      const [reqLogs] = await pool.query(
        `SELECT 
          CONCAT('req-', id) AS id,
          CONCAT(UCASE(entity_type), ' ', UCASE(to_status)) AS action,
          CASE 
            WHEN entity_type = 'booking' THEN 'BOOKINGS'
            WHEN entity_type = 'motor_rental' THEN 'MOTORCYCLES'
            ELSE 'ACTIVITIES'
          END AS module,
          CONCAT('Status changed from ', IFNULL(from_status, 'NEW'), ' to ', to_status, IF(reason IS NOT NULL, CONCAT(' - Reason: ', reason), '')) AS description,
          IFNULL(performed_by_name, 'Front Desk') AS userName,
          'staff' AS userRole,
          created_at AS createdAt
         FROM request_audit_logs
         ORDER BY created_at DESC
         LIMIT 100`
      );
      allLogs.push(...reqLogs);
    } catch (err) {
      console.warn('request_audit_logs read error:', err.message);
    }

    // 4. Fetch from motor_rental_audit_logs table
    try {
      const [motorLogs] = await pool.query(
        `SELECT 
          CONCAT('motor-', id) AS id,
          action,
          'MOTORCYCLES' AS module,
          remarks AS description,
          IFNULL(performed_by_name, 'Front Desk') AS userName,
          IFNULL(performed_by_role, 'staff') AS userRole,
          created_at AS createdAt
         FROM motor_rental_audit_logs
         ORDER BY created_at DESC
         LIMIT 100`
      );
      allLogs.push(...motorLogs);
    } catch (err) {
      console.warn('motor_rental_audit_logs read error:', err.message);
    }

    // Sort descending by created_at
    allLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply filtering if provided
    let filtered = allLogs;
    if (module && module !== 'ALL') {
      filtered = filtered.filter(l => String(l.module).toUpperCase() === module.toUpperCase());
    }
    if (q && q.trim()) {
      const query = q.trim().toLowerCase();
      filtered = filtered.filter(l => 
        String(l.action).toLowerCase().includes(query) ||
        String(l.description).toLowerCase().includes(query) ||
        String(l.userName).toLowerCase().includes(query) ||
        String(l.module).toLowerCase().includes(query)
      );
    }

    const capped = filtered.slice(0, parseInt(limit, 10) || 150);
    res.json(capped);
  } catch (err) {
    console.error('getAuditTrail error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch audit trail.' });
  }
}

module.exports = {
  ensureAuditTable,
  logAction,
  getAuditTrail,
};
