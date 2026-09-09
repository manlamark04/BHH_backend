const bcrypt = require('bcryptjs');
const pool   = require('../config/db');
const db     = require('../db/procedures');
const { SALT_ROUNDS } = require('./auth.service');

/** Helper to record customer audit log within a connection/pool */
async function logCustomerAction(conn, { customerId, customerUniqueId, action, performedBy, performedByName, performedByRole, remarks }) {
  await conn.query(
    `INSERT INTO customer_audit_logs 
      (customer_id, customer_unique_id, action, performed_by, performed_by_name, performed_by_role, remarks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [customerId, customerUniqueId, action, performedBy || null, performedByName || null, performedByRole || null, remarks || null]
  );
}

/** Helper to generate next unique Customer ID: CBI-YYYY-XXXX */
async function generateNextCustomerId(conn) {
  const currentYear = new Date().getFullYear();

  // Find maximum existing numeric sequence in users table for this year to prevent any collision
  const [maxRows] = await conn.query(
    `SELECT unique_id FROM users 
     WHERE unique_id LIKE ? 
     ORDER BY id DESC LIMIT 50`,
    [`CBI-${currentYear}-%`]
  );

  let highestExistingSeq = 0;
  for (const row of maxRows) {
    const parts = (row.unique_id || '').split('-');
    if (parts.length === 3 && parts[1] === String(currentYear)) {
      const num = parseInt(parts[2], 10);
      if (!isNaN(num) && num > highestExistingSeq) {
        highestExistingSeq = num;
      }
    }
  }

  // Ensure sequence row exists
  await conn.query(
    `INSERT INTO customer_id_sequences (year, last_sequence) 
     VALUES (?, ?) 
     ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, ?) + 1`,
    [currentYear, highestExistingSeq + 1, highestExistingSeq]
  );

  const [seqRows] = await conn.query(
    `SELECT last_sequence FROM customer_id_sequences WHERE year = ?`,
    [currentYear]
  );

  const seqNumber = seqRows[0]?.last_sequence || (highestExistingSeq + 1);
  return `CBI-${currentYear}-${String(seqNumber).padStart(4, '0')}`;
}

/** POST /api/users/customers or /api/users/walkin — Walk-In Customer Registration */
async function registerWalkInCustomer(req, res) {
  const conn = await pool.getConnection();
  try {
    const {
      first_name,
      middle_name,
      last_name,
      phone,
      email,
      username: customUsername,
      address,
      dob,
      gender,
      civil_status,
    } = req.body;

    // 1. Required field validations
    if (!first_name || !first_name.trim()) {
      return res.status(400).json({ message: 'First Name is required.' });
    }
    if (!last_name || !last_name.trim()) {
      return res.status(400).json({ message: 'Last Name is required.' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ message: 'Contact Number is required.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email Address is required.' });
    }
    if (!address || !address.trim()) {
      return res.status(400).json({ message: 'Home Address is required.' });
    }
    if (!dob || !dob.trim()) {
      return res.status(400).json({ message: 'Date of Birth is required.' });
    }
    if (!gender || !gender.trim()) {
      return res.status(400).json({ message: 'Gender is required.' });
    }
    if (!civil_status || !civil_status.trim()) {
      return res.status(400).json({ message: 'Civil Status is required.' });
    }

    const cleanFirstName = first_name.trim();
    const cleanMiddleName = middle_name ? middle_name.trim() : null;
    const cleanLastName = last_name.trim();
    const cleanPhone = phone.trim();
    const digitsPhone = cleanPhone.replace(/\D/g, '');
    if (!/^09\d{9}$/.test(digitsPhone)) {
      return res.status(400).json({ message: 'Contact number must be an 11-digit Philippine mobile number starting with 09 (e.g. 09171234567).' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanAddress = address.trim();
    const cleanDob = dob.trim();
    const cleanGender = gender.trim();
    const cleanCivilStatus = civil_status.trim();

    // 2. Duplicate checks before transaction
    const [existingEmail] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [cleanEmail]);
    if (existingEmail && existingEmail.length > 0) {
      return res.status(409).json({ message: 'Email address is already registered.' });
    }

    const [existingPhone] = await conn.query('SELECT id FROM users WHERE phone = ? LIMIT 1', [cleanPhone]);
    if (existingPhone && existingPhone.length > 0) {
      return res.status(409).json({ message: 'Contact number is already registered.' });
    }

    let username = customUsername ? customUsername.trim().toLowerCase() : '';
    if (username) {
      const [existingUser] = await conn.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
      if (existingUser && existingUser.length > 0) {
        return res.status(409).json({ message: 'Username is already taken. Please choose another username.' });
      }
    }

    // 3. Begin Transaction
    await conn.beginTransaction();

    // 4. Generate Customer ID
    const customerId = await generateNextCustomerId(conn);

    // 5. Generate Default Password based on first name (e.g. mark123)
    const sanitizedFirst = cleanFirstName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'guest';
    const defaultPassword = `${sanitizedFirst}123`;
    const passwordHash = await bcrypt.hash(defaultPassword, SALT_ROUNDS);

    // If no custom username provided, auto-generate unique username
    if (!username) {
      username = `${sanitizedFirst}.${cleanLastName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const [existingUsername] = await conn.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
      if (existingUsername && existingUsername.length > 0) {
        username = `${username}${Math.floor(100 + Math.random() * 900)}`;
      }
    }

    const fullName = cleanMiddleName
      ? `${cleanFirstName} ${cleanMiddleName} ${cleanLastName}`
      : `${cleanFirstName} ${cleanLastName}`;

    // 6. Insert User Record with status = 'pending'
    const [insertResult] = await conn.query(
      `INSERT INTO users (
        unique_id, role, full_name, first_name, middle_name, last_name,
        email, phone, address, dob, gender, civil_status,
        username, password_hash, must_change_password, status,
        created_by, created_at, updated_at
      ) VALUES (?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'pending', ?, NOW(), NOW())`,
      [
        customerId,
        fullName,
        cleanFirstName,
        cleanMiddleName,
        cleanLastName,
        cleanEmail,
        cleanPhone,
        cleanAddress,
        cleanDob,
        cleanGender,
        cleanCivilStatus,
        username,
        passwordHash,
        req.user ? req.user.id : null,
      ]
    );

    const newDbId = insertResult.insertId;

    // 7. Audit Log
    const performedByName = req.user ? (req.user.full_name || req.user.username || `User #${req.user.id}`) : 'Self';
    const performedByRole = req.user ? req.user.role : 'walk-in';

    await logCustomerAction(conn, {
      customerId: newDbId,
      customerUniqueId: customerId,
      action: 'Customer registered',
      performedBy: req.user ? req.user.id : null,
      performedByName,
      performedByRole,
      remarks: `Walk-in registration by ${performedByRole} (${performedByName}). Status set to PENDING.`,
    });

    // 8. Commit Transaction
    await conn.commit();

    // 9. Fetch created customer record
    const [customerRows] = await pool.query('SELECT * FROM users WHERE id = ?', [newDbId]);
    const customer = customerRows[0] || {};
    delete customer.password_hash;

    res.status(201).json({
      message: 'Walk-in customer registered successfully. Account is PENDING administrator approval.',
      customer: {
        ...customer,
        customer_id: customerId,
      },
      default_password: defaultPassword,
    });
  } catch (err) {
    await conn.rollback();
    console.error('Registration transaction failed:', err);
    if (err.code === 'ER_DUP_ENTRY' || err.message?.includes('Duplicate entry')) {
      if (err.message.includes('email')) {
        return res.status(409).json({ message: 'Email address is already registered.' });
      }
      if (err.message.includes('phone')) {
        return res.status(409).json({ message: 'Contact number is already registered.' });
      }
      return res.status(409).json({ message: 'A customer with this information already exists.' });
    }
    res.status(500).json({ message: err.message || 'Customer registration failed.' });
  } finally {
    conn.release();
  }
}

/** GET /api/users/customers — Search & list customer records (sorted Created Date DESC) */
async function getAllCustomers(req, res) {
  try {
    const { q, status } = req.query;
    let sql = `
      SELECT 
        u.id,
        u.unique_id,
        u.role,
        u.full_name,
        u.first_name,
        u.middle_name,
        u.last_name,
        u.email,
        u.phone,
        u.address,
        u.dob,
        u.gender,
        u.civil_status,
        u.username,
        u.status,
        u.created_by,
        u.created_at,
        u.approved_by,
        u.approved_at,
        u.rejection_reason,
        creator.full_name AS created_by_name,
        creator.role AS created_by_role,
        approver.full_name AS approved_by_name
      FROM users u
      LEFT JOIN users creator ON u.created_by = creator.id
      LEFT JOIN users approver ON u.approved_by = approver.id
      WHERE u.role = 'customer'
    `;
    const params = [];

    if (status && status !== 'all' && status !== 'All') {
      sql += ` AND LOWER(u.status) = ?`;
      params.push(status.toLowerCase());
    }

    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      sql += ` AND (
        u.unique_id LIKE ? OR
        u.first_name LIKE ? OR
        u.middle_name LIKE ? OR
        u.last_name LIKE ? OR
        u.full_name LIKE ? OR
        u.phone LIKE ? OR
        u.email LIKE ? OR
        u.username LIKE ?
      )`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    sql += ` ORDER BY u.created_at DESC`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/users/customers/:id — Get single customer with audit history */
async function getCustomerById(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);

    // Permission check: customers can only view their own record
    if (req.user.role === 'customer' && req.user.id !== targetId) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    const [rows] = await pool.query(
      `SELECT 
        u.id,
        u.unique_id,
        u.role,
        u.full_name,
        u.first_name,
        u.middle_name,
        u.last_name,
        u.email,
        u.phone,
        u.address,
        u.dob,
        u.gender,
        u.civil_status,
        u.username,
        u.status,
        u.created_by,
        u.created_at,
        u.approved_by,
        u.approved_at,
        u.rejection_reason,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_name
       FROM users u
       LEFT JOIN users creator ON u.created_by = creator.id
       LEFT JOIN users approver ON u.approved_by = approver.id
       WHERE u.id = ? AND u.role = 'customer'`,
      [targetId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const customer = rows[0];

    // Fetch audit history
    const [auditLogs] = await pool.query(
      `SELECT * FROM customer_audit_logs WHERE customer_id = ? ORDER BY created_at DESC`,
      [targetId]
    );

    res.json({ customer, audit_logs: auditLogs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/users/customers/:id/approve — Admin approves customer */
async function approveCustomer(req, res) {
  const conn = await pool.getConnection();
  try {
    const targetId = parseInt(req.params.id, 10);
    const adminId = req.user.id;
    const adminName = req.user.full_name || req.user.username;

    const [existing] = await conn.query('SELECT * FROM users WHERE id = ?', [targetId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: 'Customer not found.' });
    }
    const customer = existing[0];

    await conn.beginTransaction();

    await conn.query(
      `UPDATE users 
       SET status = 'active', 
           approved_by = ?, 
           approved_at = NOW(), 
           rejection_reason = NULL,
           updated_at = NOW() 
       WHERE id = ?`,
      [adminId, targetId]
    );

    await logCustomerAction(conn, {
      customerId: targetId,
      customerUniqueId: customer.unique_id,
      action: 'Customer approved',
      performedBy: adminId,
      performedByName: adminName,
      performedByRole: 'admin',
      remarks: 'Customer registration approved. Account status changed to ACTIVE.',
    });

    await conn.commit();

    const [updatedRows] = await pool.query('SELECT * FROM users WHERE id = ?', [targetId]);
    const updated = updatedRows[0];
    delete updated.password_hash;

    res.json({ message: 'Customer approved successfully.', customer: updated });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/** POST /api/users/customers/:id/reject — Admin rejects customer */
async function rejectCustomer(req, res) {
  const conn = await pool.getConnection();
  try {
    const targetId = parseInt(req.params.id, 10);
    const adminId = req.user.id;
    const adminName = req.user.full_name || req.user.username;
    const { reason } = req.body;

    const [existing] = await conn.query('SELECT * FROM users WHERE id = ?', [targetId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: 'Customer not found.' });
    }
    const customer = existing[0];

    await conn.beginTransaction();

    await conn.query(
      `UPDATE users 
       SET status = 'rejected', 
           approved_by = ?, 
           approved_at = NOW(), 
           rejection_reason = ?, 
           updated_at = NOW() 
       WHERE id = ?`,
      [adminId, reason || null, targetId]
    );

    await logCustomerAction(conn, {
      customerId: targetId,
      customerUniqueId: customer.unique_id,
      action: 'Customer rejected',
      performedBy: adminId,
      performedByName: adminName,
      performedByRole: 'admin',
      remarks: reason ? `Registration rejected: ${reason}` : 'Registration rejected by administrator.',
    });

    await conn.commit();

    const [updatedRows] = await pool.query('SELECT * FROM users WHERE id = ?', [targetId]);
    const updated = updatedRows[0];
    delete updated.password_hash;

    res.json({ message: 'Customer rejected.', customer: updated });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/** POST /api/users/customers/:id/suspend — Admin suspends customer */
async function suspendCustomer(req, res) {
  const conn = await pool.getConnection();
  try {
    const targetId = parseInt(req.params.id, 10);
    const adminId = req.user.id;
    const adminName = req.user.full_name || req.user.username;
    const { reason } = req.body;

    const [existing] = await conn.query('SELECT * FROM users WHERE id = ?', [targetId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: 'Customer not found.' });
    }
    const customer = existing[0];

    await conn.beginTransaction();

    await conn.query(
      `UPDATE users 
       SET status = 'suspended', 
           updated_at = NOW() 
       WHERE id = ?`,
      [targetId]
    );

    await logCustomerAction(conn, {
      customerId: targetId,
      customerUniqueId: customer.unique_id,
      action: 'Customer suspended',
      performedBy: adminId,
      performedByName: adminName,
      performedByRole: 'admin',
      remarks: reason ? `Account suspended: ${reason}` : 'Account suspended by administrator.',
    });

    await conn.commit();

    const [updatedRows] = await pool.query('SELECT * FROM users WHERE id = ?', [targetId]);
    const updated = updatedRows[0];
    delete updated.password_hash;

    res.json({ message: 'Customer account suspended.', customer: updated });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/** POST /api/users/customers/:id/reactivate — Admin reactivates customer */
async function reactivateCustomer(req, res) {
  const conn = await pool.getConnection();
  try {
    const targetId = parseInt(req.params.id, 10);
    const adminId = req.user.id;
    const adminName = req.user.full_name || req.user.username;

    const [existing] = await conn.query('SELECT * FROM users WHERE id = ?', [targetId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: 'Customer not found.' });
    }
    const customer = existing[0];

    await conn.beginTransaction();

    await conn.query(
      `UPDATE users 
       SET status = 'active', 
           updated_at = NOW() 
       WHERE id = ?`,
      [targetId]
    );

    await logCustomerAction(conn, {
      customerId: targetId,
      customerUniqueId: customer.unique_id,
      action: 'Customer account activated',
      performedBy: adminId,
      performedByName: adminName,
      performedByRole: 'admin',
      remarks: 'Customer account reactivated to ACTIVE.',
    });

    await conn.commit();

    const [updatedRows] = await pool.query('SELECT * FROM users WHERE id = ?', [targetId]);
    const updated = updatedRows[0];
    delete updated.password_hash;

    res.json({ message: 'Customer account reactivated.', customer: updated });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/** GET /api/users/customers/:id/audit — Get audit trail */
async function getCustomerAuditHistory(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      `SELECT * FROM customer_audit_logs WHERE customer_id = ? ORDER BY created_at DESC`,
      [targetId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// ─── Standard User Management (Admin & Staff endpoints) ────────

/** GET /api/users — Admin: list all users with full demographic and approval details */
async function getAllUsers(req, res) {
  try {
    const { role } = req.query;
    let sql = `
      SELECT 
        u.id,
        u.unique_id,
        u.role,
        u.full_name,
        u.first_name,
        u.middle_name,
        u.last_name,
        u.email,
        u.phone,
        u.address,
        DATE_FORMAT(u.dob, '%Y-%m-%d') AS dob,
        u.gender,
        u.civil_status,
        u.username,
        u.status,
        u.must_change_password,
        u.default_password,
        u.created_by,
        u.created_at,
        u.approved_by,
        u.approved_at,
        u.rejection_reason,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_name
      FROM users u
      LEFT JOIN users creator ON u.created_by = creator.id
      LEFT JOIN users approver ON u.approved_by = approver.id
    `;
    const params = [];
    if (role && role !== 'all' && role !== 'All') {
      sql += ' WHERE LOWER(u.role) = ?';
      params.push(role.toLowerCase());
    }
    sql += ' ORDER BY u.created_at DESC';

    const [users] = await pool.query(sql, params);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/users/pending — Admin: approval queue */
async function getPendingUsers(req, res) {
  try {
    const sql = `
      SELECT 
        u.id,
        u.unique_id,
        u.role,
        u.full_name,
        u.first_name,
        u.middle_name,
        u.last_name,
        u.email,
        u.phone,
        u.address,
        DATE_FORMAT(u.dob, '%Y-%m-%d') AS dob,
        u.gender,
        u.civil_status,
        u.username,
        u.status,
        u.created_by,
        u.created_at,
        creator.full_name AS creator_name
      FROM users u
      LEFT JOIN users creator ON u.created_by = creator.id
      WHERE LOWER(u.status) = 'pending'
      ORDER BY u.created_at ASC
    `;
    const [users] = await pool.query(sql);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/users/approve/:id — Admin */
async function approveUser(req, res) {
  try {
    const user = await db.users.approve(parseInt(req.params.id, 10), req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User approved.', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/users/reject/:id — Admin */
async function rejectUser(req, res) {
  try {
    const { reason } = req.body;
    const user = await db.users.reject(parseInt(req.params.id, 10), req.user.id, reason || null);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User rejected.', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/users/toggle/:id — Admin: enable/disable */
async function toggleUserStatus(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);

    // Task 13: Last-admin disable guard — prevent total lockout
    const [targetRows] = await pool.query('SELECT role, status FROM users WHERE id = ? LIMIT 1', [targetId]);
    if (!targetRows || targetRows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    const target = targetRows[0];
    if (target.role === 'admin' && String(target.status).toLowerCase() === 'active') {
      const [adminCountRows] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND LOWER(status) = 'active'"
      );
      const activeAdminCount = Number(adminCountRows[0]?.cnt || 0);
      if (activeAdminCount <= 1) {
        return res.status(400).json({
          message: 'Cannot disable the last active administrator. Create another admin account first to prevent a system lockout.',
        });
      }
    }

    const user = await db.users.toggleStatus(targetId, req.user.id);
    res.json({ message: `User ${user.status}.`, user });
  } catch (err) {
    if (err.message?.includes('last active admin')) {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/users/staff — Admin: create staff account */
async function createStaff(req, res) {
  try {
    const {
      first_name,
      middle_name,
      last_name,
      full_name,
      email,
      phone,
      username,
      password,
      address,
      dob,
      gender,
      civil_status,
    } = req.body;

    if (!password) return res.status(400).json({ message: 'Password is required.' });

    const finalFullName = (full_name && full_name.trim())
      ? full_name.trim()
      : [first_name, middle_name, last_name].filter(Boolean).map(s => String(s).trim()).join(' ');

    if (!finalFullName) {
      return res.status(400).json({ message: 'Name is required.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await db.users.create('staff', finalFullName, email, phone || null, username, passwordHash, req.user.id, null);
    if (!user) return res.status(500).json({ message: 'Staff creation failed.' });

    await pool.query(
      `UPDATE users 
       SET status = 'active', 
           first_name = ?, 
           middle_name = ?, 
           last_name = ?, 
           address = ?, 
           dob = ?, 
           gender = ?, 
           civil_status = ?,
           default_password = ?
       WHERE id = ?`,
      [
        first_name || null,
        middle_name || null,
        last_name || null,
        address || null,
        dob || null,
        gender || null,
        civil_status || null,
        password,
        user.id
      ]
    );

    const fresh = await db.auth.getUserById(user.id);
    const { password_hash, ...safeUser } = fresh;
    res.status(201).json({ message: 'Staff account created.', ...safeUser });
  } catch (err) {
    if (err.message?.includes('Duplicate entry') || err.message?.includes('duplicate key')) {
      return res.status(409).json({ message: 'Email or username already exists.' });
    }
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/users/approve-customer/:id — Admin: approve and create account credentials for customer */
async function approveCustomerAccount(req, res) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const targetId = parseInt(req.params.id, 10);
    const { username, password, unique_id } = req.body;

    const [rows] = await conn.query('SELECT * FROM users WHERE id = ?', [targetId]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Customer registration not found.' });
    }
    const user = rows[0];

    let defaultPw = password && password.trim() ? password.trim() : (user.default_password || 'user123');
    let passwordHash = user.password_hash;
    let mustChangePassword = 1;
    if (password && password.trim()) {
      passwordHash = await bcrypt.hash(password.trim(), SALT_ROUNDS);
    }

    const finalUsername = username ? username.trim().toLowerCase() : user.username;
    const finalUniqueId = unique_id ? unique_id.trim() : user.unique_id;

    // Check if username changed and is already taken
    if (finalUsername !== user.username) {
      const [existingUser] = await conn.query('SELECT id FROM users WHERE username = ? AND id != ?', [finalUsername, targetId]);
      if (existingUser.length > 0) {
        await conn.rollback();
        return res.status(409).json({ message: 'Username is already taken by another user.' });
      }
    }

    await conn.query(
      `UPDATE users 
       SET status = 'active', 
           username = ?, 
           unique_id = ?, 
           password_hash = ?, 
           default_password = ?,
           must_change_password = ?, 
           approved_by = ?, 
           approved_at = NOW(), 
           updated_at = NOW() 
       WHERE id = ?`,
      [finalUsername, finalUniqueId, passwordHash, defaultPw, mustChangePassword, req.user.id, targetId]
    );

    // Audit Log
    const performerName = req.user.full_name || req.user.username || 'Admin';
    await logCustomerAction(conn, {
      customerId: targetId,
      customerUniqueId: finalUniqueId,
      action: 'Customer Account Approved & Created',
      performedBy: req.user.id,
      performedByName: performerName,
      performedByRole: req.user.role,
      remarks: `Customer account approved and activated by ${performerName}. Login username: ${finalUsername}.`,
    });

    await conn.commit();

    const [updatedRows] = await pool.query('SELECT id, unique_id, role, full_name, email, phone, username, status, approved_at FROM users WHERE id = ?', [targetId]);
    res.json({
      message: `Account for ${user.full_name} has been approved and activated! The customer can now log in.`,
      user: updatedRows[0],
    });
  } catch (err) {
    await conn.rollback();
    console.error('Approve customer account failed:', err);
    res.status(500).json({ message: err.message || 'Failed to approve customer account.' });
  } finally {
    conn.release();
  }
}

/** GET /api/users/customers/search — Staff search */
async function searchCustomers(req, res) {
  return getAllCustomers(req, res);
}

module.exports = {
  registerWalkInCustomer,
  getAllCustomers,
  getCustomerById,
  approveCustomer,
  rejectCustomer,
  suspendCustomer,
  reactivateCustomer,
  getCustomerAuditHistory,
  getAllUsers,
  getPendingUsers,
  approveUser,
  rejectUser,
  toggleUserStatus,
  createStaff,
  approveCustomerAccount,
  searchCustomers,
};
