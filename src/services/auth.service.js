const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const db        = require('../db/procedures');

const DEFAULT_PASSWORD = 'user123';
const SALT_ROUNDS      = 12;

/**
 * Validates a password against BHH strong password rules.
 */
function validatePassword(pw) {
  const errors = [];
  if (pw.length < 8)                      errors.push('Must be at least 8 characters.');
  if (!/[A-Z]/.test(pw))                  errors.push('Must contain at least one uppercase letter.');
  if (!/\d/.test(pw))                     errors.push('Must contain at least one digit.');
  if (/(.)\1{2,}/.test(pw))             errors.push('Must not contain 3 or more repeated identical characters in a row.');
  if (pw === DEFAULT_PASSWORD)             errors.push('Cannot use the default password.');
  return errors;
}

/**
 * POST /api/auth/register
 */
async function register(req, res) {
  const pool = require('../config/db');
  try {
    const {
      first_name,
      last_name,
      middle_name,
      full_name,
      email,
      phone,
      username: customUsername,
      address,
      dob,
      gender,
      civil_status,
      valid_id_path,
    } = req.body;

    const cleanFirstName = (first_name || full_name?.split(' ')[0] || '').trim();
    const cleanLastName = (last_name || full_name?.split(' ').slice(1).join(' ') || '').trim();
    const cleanMiddleName = middle_name ? middle_name.trim() : null;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (phone || '').trim();
    const cleanAddress = address ? address.trim() : null;
    const cleanDob = dob ? dob.trim() : null;
    const cleanGender = gender ? gender.trim() : null;
    const cleanCivilStatus = civil_status ? civil_status.trim() : null;

    if (!cleanFirstName || !cleanLastName || !cleanEmail) {
      return res.status(400).json({ message: 'First name, last name, and email address are required.' });
    }

    const digitsPhone = cleanPhone.replace(/\D/g, '');
    if (!cleanPhone || !/^09\d{9}$/.test(digitsPhone)) {
      return res.status(400).json({ message: 'Phone number must be an 11-digit Philippine mobile number starting with 09 (e.g. 09171234567).' });
    }

    const fullName = cleanMiddleName
      ? `${cleanFirstName} ${cleanMiddleName} ${cleanLastName}`
      : `${cleanFirstName} ${cleanLastName}`;

    // 1. Duplicate email check
    const [existingEmail] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [cleanEmail]);
    if (existingEmail && existingEmail.length > 0) {
      return res.status(409).json({ message: 'Email address is already registered.' });
    }

    // 2. Duplicate phone check
    if (cleanPhone) {
      const [existingPhone] = await pool.query('SELECT id FROM users WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (existingPhone && existingPhone.length > 0) {
        return res.status(409).json({ message: 'Contact number is already registered.' });
      }
    }

    // 3. Username handling
    let username = customUsername ? customUsername.trim().toLowerCase() : '';
    if (username) {
      const [existingUser] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
      if (existingUser && existingUser.length > 0) {
        return res.status(409).json({ message: 'Username is already taken. Please choose another username.' });
      }
    } else {
      const sanitizedFirst = cleanFirstName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'guest';
      const sanitizedLast = cleanLastName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
      username = `${sanitizedFirst}.${sanitizedLast}`;
      const [existingUsername] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
      if (existingUsername && existingUsername.length > 0) {
        username = `${username}${Math.floor(100 + Math.random() * 900)}`;
      }
    }

    // 4. Generate Customer ID
    const currentYear = new Date().getFullYear();
    const [countRows] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE role = "customer"');
    const seq = (countRows[0]?.cnt || 0) + 1;
    const uniqueId = `CUST-${currentYear}-${String(seq).padStart(4, '0')}`;

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

    await pool.query(
      `INSERT INTO users (
        unique_id, role, full_name, first_name, middle_name, last_name,
        email, phone, address, dob, gender, civil_status,
        username, password_hash, must_change_password, status,
        valid_id_path, created_at, updated_at
      ) VALUES (?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'pending', ?, NOW(), NOW())`,
      [
        uniqueId,
        fullName,
        cleanFirstName,
        cleanMiddleName,
        cleanLastName,
        cleanEmail,
        cleanPhone || null,
        cleanAddress,
        cleanDob,
        cleanGender,
        cleanCivilStatus,
        username,
        passwordHash,
        valid_id_path || null,
      ]
    );

    res.status(201).json({
      message: 'Account created. Awaiting admin approval.',
      unique_id: uniqueId,
      username,
    });
  } catch (err) {
    if (err.message?.includes('duplicate key') || err.message?.includes('Duplicate entry')) {
      return res.status(409).json({ message: 'Email or username already exists.' });
    }
    console.error('Registration error:', err);
    res.status(500).json({ message: err.message || 'Registration failed.' });
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  try {
    const { identifier, password } = req.body;
    const user = await db.auth.login(identifier);

    if (!user) return res.status(401).json({ message: 'Invalid credentials.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials.' });

    const statusMessages = {
      pending:   'Your account is awaiting admin approval.',
      disabled:  'Your account has been disabled. Contact the front desk.',
      rejected:  'Your account was not approved. Contact the front desk.',
      suspended: 'Your account has been suspended. Contact the front desk.',
    };
    if (user.status !== 'active') {
      return res.status(403).json({ message: statusMessages[user.status] || 'Account is not active.' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.json({
      token,
      user: {
        id:                   user.id,
        unique_id:            user.unique_id,
        role:                 user.role,
        full_name:            user.full_name,
        email:                user.email,
        gender:               user.gender || null,
        civil_status:         user.civil_status || null,
        must_change_password: Boolean(user.must_change_password),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/**
 * POST /api/auth/change-password
 */
async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body;
    const user = await db.auth.getUserById(req.user.id);

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(400).json({ message: 'Current password is incorrect.' });

    const errors = validatePassword(new_password);
    if (errors.length) return res.status(422).json({ errors });

    const sameAsCurrent = await bcrypt.compare(new_password, user.password_hash);
    if (sameAsCurrent) return res.status(422).json({ errors: ['New password cannot be the same as current password.'] });

    const newHash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await db.auth.changePassword(req.user.id, newHash);
    res.json({ message: 'Password changed successfully.', must_change_password: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/**
 * GET /api/auth/me
 */
async function getMe(req, res) {
  try {
    const user = await db.auth.getUserById(req.user.id);
    const { password_hash, ...safeUser } = user;
    safeUser.must_change_password = Boolean(safeUser.must_change_password);
    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/**
 * PUT /api/auth/profile
 */
async function updateProfile(req, res) {
  const pool = require('../config/db');
  try {
    const { first_name, middle_name, last_name, full_name, phone, gender, address, civil_status, dob } = req.body;
    
    // Auto-compute full_name if first_name / last_name provided
    let computedFullName = full_name;
    if (first_name || last_name) {
      computedFullName = [first_name, middle_name, last_name].filter(Boolean).join(' ').trim();
    }

    await pool.query(`
      UPDATE users
      SET 
        first_name = COALESCE(?, first_name),
        middle_name = COALESCE(?, middle_name),
        last_name = COALESCE(?, last_name),
        full_name = COALESCE(?, full_name),
        phone = COALESCE(?, phone),
        gender = COALESCE(?, gender),
        address = COALESCE(?, address),
        civil_status = COALESCE(?, civil_status),
        dob = COALESCE(?, dob),
        updated_at = NOW()
      WHERE id = ?
    `, [
      first_name !== undefined ? (first_name ? first_name.trim() : null) : null,
      middle_name !== undefined ? (middle_name ? middle_name.trim() : null) : null,
      last_name !== undefined ? (last_name ? last_name.trim() : null) : null,
      computedFullName !== undefined ? (computedFullName ? computedFullName.trim() : null) : null,
      phone !== undefined ? (phone ? phone.trim() : null) : null,
      gender !== undefined ? (gender ? gender.trim() : null) : null,
      address !== undefined ? (address ? address.trim() : null) : null,
      civil_status !== undefined ? (civil_status ? civil_status.trim() : null) : null,
      dob !== undefined ? (dob ? dob.trim() : null) : null,
      req.user.id
    ]);

    const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = userRows[0];
    const { password_hash, ...safeUser } = user;
    safeUser.must_change_password = Boolean(safeUser.must_change_password);
    res.json(safeUser);
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({ message: err.message });
  }
}

module.exports = { register, login, changePassword, getMe, updateProfile, validatePassword, DEFAULT_PASSWORD, SALT_ROUNDS };
