const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { validateDriverLicense, DRIVER_LICENSE_ERROR_MSG } = require('../utils/license.util');

/** Helper to save base64 image data URL to disk in uploads folder */
function saveBase64Image(dataUrl, prefix = 'motor') {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }
  try {
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches) return dataUrl;
    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const uploadsDir = path.join(__dirname, '..', '..', process.env.UPLOADS_DIR || 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filename = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, buffer);
    return `/uploads/${filename}`;
  } catch (err) {
    console.error('Failed to save base64 image to disk:', err);
    return dataUrl;
  }
}

/** Helper to generate next unique Rental ID: MTR-YYYY-XXXX */
async function generateNextRentalId(conn) {
  const currentYear = new Date().getFullYear();

  // Find max existing sequence in motor_rentals table for this year
  const [maxRows] = await conn.query(
    `SELECT rental_id FROM motor_rentals 
     WHERE rental_id LIKE ? 
     ORDER BY id DESC LIMIT 50`,
    [`MTR-${currentYear}-%`]
  );

  let highestExistingSeq = 0;
  for (const row of maxRows) {
    const parts = (row.rental_id || '').split('-');
    if (parts.length === 3 && parts[1] === String(currentYear)) {
      const num = parseInt(parts[2], 10);
      if (!isNaN(num) && num > highestExistingSeq) {
        highestExistingSeq = num;
      }
    }
  }

  await conn.query(
    `INSERT INTO motor_rental_sequences (year, last_sequence) 
     VALUES (?, ?) 
     ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, ?) + 1`,
    [currentYear, highestExistingSeq + 1, highestExistingSeq]
  );

  const [seqRows] = await conn.query(
    `SELECT last_sequence FROM motor_rental_sequences WHERE year = ?`,
    [currentYear]
  );

  const seqNumber = seqRows[0]?.last_sequence || (highestExistingSeq + 1);
  return `MTR-${currentYear}-${String(seqNumber).padStart(4, '0')}`;
}

/** Helper to record motorcycle rental audit log */
async function logMotorRentalAction(conn, { rentalId, rentalUniqueId, motorId, action, performedBy, performedByName, performedByRole, remarks }) {
  await conn.query(
    `INSERT INTO motor_rental_audit_logs 
      (rental_id, rental_unique_id, motor_id, action, performed_by, performed_by_name, performed_by_role, remarks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [rentalId || null, rentalUniqueId || null, motorId || null, action, performedBy || null, performedByName || null, performedByRole || null, remarks || null]
  );
}

/** Helper to automatically update overdue active rentals */
async function checkAndUpdateOverdueRentals() {
  try {
    await pool.query(`
      UPDATE motor_rentals 
      SET status = 'OVERDUE', updated_at = NOW() 
      WHERE status = 'ACTIVE' AND expected_return_datetime < NOW()
    `);
  } catch (err) {
    console.error('Error updating overdue motor rentals:', err.message);
  }
}

// ─── MOTORCYCLE FLEET OPERATIONS ─────────────────────────────

/** GET /api/motorcycles — List all motorcycles (optionally filtered by status) */
async function getMotorcycles(req, res) {
  try {
    const { status, type, brand } = req.query;
    let sql = `
      SELECT 
        m.id,
        m.motor_id,
        m.brand,
        m.model,
        m.type,
        m.plate_number,
        m.rental_rate,
        m.rate_type,
        m.description,
        m.image_url,
        CASE 
          WHEN m.status = 'MAINTENANCE' THEN 'MAINTENANCE'
          WHEN m.status = 'RESERVED' THEN 'RESERVED'
          WHEN active_r.id IS NOT NULL AND active_r.status = 'ACTIVE' THEN 'RENTED'
          WHEN active_r.id IS NOT NULL THEN 'RESERVED'
          ELSE m.status 
        END AS status,
        m.created_at,
        m.updated_at,
        active_r.rental_id AS active_rental_id,
        active_r.status AS active_rental_status,
        active_r.expected_return_datetime
      FROM motorcycles m
      LEFT JOIN (
        SELECT mr.id, mr.motor_id, mr.rental_id, mr.status, mr.expected_return_datetime
        FROM motor_rentals mr
        WHERE mr.status IN ('ACTIVE', 'RESERVED', 'OVERDUE')
      ) active_r ON active_r.motor_id = m.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'ALL' && status !== 'All') {
      sql += ` AND (m.status = ? OR (active_r.id IS NOT NULL AND ? = 'RENTED'))`;
      params.push(status.toUpperCase(), status.toUpperCase());
    }
    if (type && type !== 'ALL') {
      sql += ` AND m.type = ?`;
      params.push(type);
    }
    if (brand && brand !== 'ALL') {
      sql += ` AND m.brand = ?`;
      params.push(brand);
    }

    sql += ` ORDER BY m.brand ASC, m.model ASC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/motorcycles/:id — Get single motorcycle details */
async function getMotorcycleById(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM motorcycles WHERE id = ?', [req.params.id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'Motorcycle not found.' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/motorcycles — Admin: Add motorcycle to fleet */
async function createMotorcycle(req, res) {
  try {
    const { brand, model, type, plate_number, rental_rate, late_fee_hourly_rate, rate_type, description, image_url, status } = req.body;

    if (!brand || !model || !type || !plate_number || !rental_rate) {
      return res.status(400).json({ message: 'Brand, model, type, plate number, and rental rate are required.' });
    }

    // Check duplicate plate number
    const [existing] = await pool.query('SELECT id FROM motorcycles WHERE plate_number = ?', [plate_number.trim().toUpperCase()]);
    if (existing && existing.length > 0) {
      return res.status(409).json({ message: 'Plate number is already registered.' });
    }

    // Generate motor ID
    const currentYear = new Date().getFullYear();
    const [countRows] = await pool.query('SELECT COUNT(*) as count FROM motorcycles');
    const motorId = `MOT-${currentYear}-${String(countRows[0].count + 1).padStart(4, '0')}`;
    const processedImageUrl = image_url ? saveBase64Image(image_url, `motor-${motorId.toLowerCase()}`) : null;

    const [result] = await pool.query(
      `INSERT INTO motorcycles 
        (motor_id, brand, model, type, plate_number, rental_rate, late_fee_hourly_rate, rate_type, description, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        motorId,
        brand.trim(),
        model.trim(),
        type.trim(),
        plate_number.trim().toUpperCase(),
        parseFloat(rental_rate),
        late_fee_hourly_rate !== undefined && late_fee_hourly_rate !== null && late_fee_hourly_rate !== '' ? parseFloat(late_fee_hourly_rate) : null,
        rate_type || 'daily',
        description || null,
        processedImageUrl,
        status || 'AVAILABLE',
      ]
    );

    const [created] = await pool.query('SELECT * FROM motorcycles WHERE id = ?', [result.insertId]);
    res.status(201).json({ message: 'Motorcycle added to fleet successfully.', motorcycle: created[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** PUT /api/motorcycles/:id — Admin: Update motorcycle details */
async function updateMotorcycle(req, res) {
  try {
    const { brand, model, type, plate_number, rental_rate, late_fee_hourly_rate, rate_type, description, image_url, status } = req.body;
    const motorId = req.params.id;

    // 1. Verify motorcycle exists
    const [existing] = await pool.query('SELECT * FROM motorcycles WHERE id = ?', [motorId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: 'Motorcycle not found.' });
    }

    // 2. If plate number changed, verify uniqueness
    if (plate_number && plate_number.trim().toUpperCase() !== existing[0].plate_number) {
      const [duplicate] = await pool.query(
        'SELECT id FROM motorcycles WHERE plate_number = ? AND id != ?',
        [plate_number.trim().toUpperCase(), motorId]
      );
      if (duplicate && duplicate.length > 0) {
        return res.status(409).json({ message: `A motorcycle with plate number ${plate_number.trim().toUpperCase()} already exists.` });
      }
    }

    // 3. Process base64 image if uploaded
    const processedImageUrl = image_url !== undefined ? saveBase64Image(image_url, `motor-${motorId}`) : undefined;

    const parsedLateRate = late_fee_hourly_rate !== undefined
      ? (late_fee_hourly_rate !== null && late_fee_hourly_rate !== '' ? parseFloat(late_fee_hourly_rate) : null)
      : undefined;

    // 4. Update fields
    await pool.query(
      `UPDATE motorcycles 
       SET brand = COALESCE(?, brand),
           model = COALESCE(?, model),
           type = COALESCE(?, type),
           plate_number = COALESCE(?, plate_number),
           rental_rate = COALESCE(?, rental_rate),
           late_fee_hourly_rate = ${parsedLateRate !== undefined ? '?' : 'late_fee_hourly_rate'},
           rate_type = COALESCE(?, rate_type),
           description = COALESCE(?, description),
           image_url = COALESCE(?, image_url),
           status = COALESCE(?, status),
           updated_at = NOW()
       WHERE id = ?`,
      [
        brand ? brand.trim() : null,
        model ? model.trim() : null,
        type ? type.trim() : null,
        plate_number ? plate_number.trim().toUpperCase() : null,
        rental_rate !== undefined && rental_rate !== null ? parseFloat(rental_rate) : null,
        ...(parsedLateRate !== undefined ? [parsedLateRate] : []),
        rate_type || null,
        description !== undefined ? description : null,
        processedImageUrl !== undefined ? processedImageUrl : null,
        status || null,
        motorId
      ]
    );

    const [updated] = await pool.query('SELECT * FROM motorcycles WHERE id = ?', [motorId]);

    // 5. Record Audit Log for Admin attribution (safe)
    try {
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
         VALUES (?, ?, 'motorcycle', ?, ?, NOW())`,
        [
          req.user?.id || null,
          `Admin ${req.user?.full_name || 'Admin'} updated motorcycle ${updated[0].brand} ${updated[0].model} (${updated[0].plate_number})`,
          motorId,
          req.ip || null
        ]
      );
    } catch (auditErr) {
      console.warn('Audit log write skipped or failed:', auditErr.message);
    }

    res.json({ message: 'Motorcycle updated successfully.', motorcycle: updated[0] });
  } catch (err) {
    console.error('Update motorcycle error:', err);
    res.status(500).json({ message: err.message || 'Failed to update motorcycle.' });
  }
}

/** PATCH /api/motorcycles/:id/status — Staff/Admin: Update status only */
async function updateMotorcycleStatus(req, res) {
  try {
    const { status } = req.body;
    const motorId = req.params.id;
    const validStatuses = ['AVAILABLE', 'RESERVED', 'RENTED', 'MAINTENANCE', 'INACTIVE'];

    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const [existing] = await pool.query('SELECT * FROM motorcycles WHERE id = ?', [motorId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: 'Motorcycle not found.' });
    }

    const newStatus = status.toUpperCase();
    await pool.query('UPDATE motorcycles SET status = ?, updated_at = NOW() WHERE id = ?', [newStatus, motorId]);

    const [updated] = await pool.query('SELECT * FROM motorcycles WHERE id = ?', [motorId]);

    // Record Audit Log
    try {
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
         VALUES (?, ?, 'motorcycle', ?, ?, NOW())`,
        [
          req.user?.id || null,
          `${req.user?.role === 'admin' ? 'Admin' : 'Staff'} ${req.user?.full_name || 'Staff'} changed status of ${updated[0].brand} ${updated[0].model} (${updated[0].plate_number}) to ${newStatus}`,
          motorId,
          req.ip || null
        ]
      );
    } catch (auditErr) {
      console.warn('Audit log write skipped:', auditErr.message);
    }

    res.json({ message: `Motorcycle status updated to ${newStatus}.`, motorcycle: updated[0] });
  } catch (err) {
    console.error('Update motorcycle status error:', err);
    res.status(500).json({ message: err.message || 'Failed to update motorcycle status.' });
  }
}

// ─── MOTORCYCLE RENTAL TRANSACTIONS ───────────────────────────

/** POST /api/motorcycles/rentals — Create & Confirm a Motorcycle Rental */
async function createMotorRental(req, res) {
  const conn = await pool.getConnection();
  try {
    const { ensureLicenseColumns } = require('./billing.service');
    await ensureLicenseColumns();

    const {
      customer_id,
      motor_id,
      start_datetime,
      expected_return_datetime,
      notes,
      license_type,
      passport_number,
      country_of_issuance,
      foreign_license_number,
      foreign_license_expiry,
      idp_number,
      idp_expiry,
      idp_category_a,
      driver_license_number,
      driver_license_expiry,
      driver_license_restrictions,
      restriction_codes,
      designated_driver_name,
    } = req.body;

    // Determine customer ID (Staff/Admin can specify customer_id; Customer rents for self)
    let targetCustomerId = customer_id ? parseInt(customer_id, 10) : null;
    if (req.user.role === 'customer') {
      targetCustomerId = req.user.id;
    }

    if (!targetCustomerId) {
      return res.status(400).json({ message: 'Customer ID is required.' });
    }
    if (!motor_id) {
      return res.status(400).json({ message: 'Motorcycle selection is required.' });
    }
    if (!start_datetime || !expected_return_datetime) {
      return res.status(400).json({ message: 'Start date/time and expected return date/time are required.' });
    }

    const startDate = new Date(start_datetime);
    const returnDate = new Date(expected_return_datetime);

    if (isNaN(startDate.getTime()) || isNaN(returnDate.getTime())) {
      return res.status(400).json({ message: 'Invalid start or return date/time format.' });
    }
    if (returnDate <= startDate) {
      return res.status(400).json({ message: 'Expected return date/time must be after the rental start date/time.' });
    }

    // --- Driver's License & Restriction / IDP Validation ---
    const selectedLicenseType = (license_type && String(license_type).toUpperCase() === 'FOREIGN') ? 'FOREIGN' : 'PH';
    let finalLicenseNum = null;
    let finalLicenseExp = null;
    let finalRestrictionsStr = null;
    let finalDesignatedDriver = designated_driver_name ? String(designated_driver_name).trim() : null;
    let finalPassportNum = null;
    let finalCountryOfIssuance = null;
    let finalForeignLicenseNum = null;
    let finalForeignLicenseExp = null;
    let finalIdpNum = null;
    let finalIdpExp = null;
    let finalIdpCatA = 0;
    let licenseBadge = '';

    if (selectedLicenseType === 'FOREIGN') {
      finalPassportNum = passport_number ? String(passport_number).trim() : '';
      finalCountryOfIssuance = country_of_issuance ? String(country_of_issuance).trim() : '';
      finalForeignLicenseNum = foreign_license_number ? String(foreign_license_number).trim() : '';
      finalForeignLicenseExp = foreign_license_expiry ? String(foreign_license_expiry).trim() : '';
      finalIdpNum = idp_number ? String(idp_number).trim() : '';
      finalIdpExp = idp_expiry ? String(idp_expiry).trim() : '';
      finalIdpCatA = (idp_category_a === true || idp_category_a === 1 || idp_category_a === 'true' || idp_category_a === '1') ? 1 : 0;

      if (!finalPassportNum || !finalCountryOfIssuance || !finalForeignLicenseNum || !finalForeignLicenseExp || !finalIdpNum || !finalIdpExp) {
        return res.status(400).json({
          message: 'Passport Number, Country of Issuance, Foreign License Number, License Expiry, IDP Number, and IDP Expiry are all required for foreign guests.',
        });
      }

      // Check IDP Category A confirmation
      if (!finalIdpCatA) {
        return res.status(400).json({
          message: "An International Driving Permit (IDP) with a motorcycle category is required for foreign guests to rent a motorcycle in the Philippines. Please present your IDP at the front desk, or contact us if you don't have one.",
        });
      }

      // Validate foreign license expiration
      const fExp = new Date(finalForeignLicenseExp);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!isNaN(fExp.getTime()) && fExp < today) {
        return res.status(400).json({
          message: "The provided foreign driver's license has expired. A valid, non-expired license is required.",
        });
      }

      // Validate IDP expiration
      const idpExpDate = new Date(finalIdpExp);
      if (!isNaN(idpExpDate.getTime()) && idpExpDate < today) {
        return res.status(400).json({
          message: "The provided International Driving Permit (IDP) has expired. A valid, non-expired permit is required.",
        });
      }

      finalLicenseNum = finalForeignLicenseNum || finalIdpNum;
      finalLicenseExp = finalIdpExp || finalForeignLicenseExp;
      finalRestrictionsStr = 'IDP Category A (Motorcycle)';
      licenseBadge = `[Foreign License (IDP) | Country: ${finalCountryOfIssuance} | Passport: ${finalPassportNum} | Foreign Lic: ${finalForeignLicenseNum} (Exp: ${finalForeignLicenseExp}) | IDP: ${finalIdpNum} (Exp: ${finalIdpExp}) | Category A: Verified]`;
    } else {
      // Philippine Driver's License validation
      let rawLicenseNum = driver_license_number || '';
      let rawLicenseExpiry = driver_license_expiry || '';
      let rawRestrictions = driver_license_restrictions || restriction_codes || [];

      // Fallback parsing if embedded in notes
      if (!rawLicenseNum && notes) {
        const lm = notes.match(/\[Driver's License:\s*([^|]+)\s*\|\s*Expiry:\s*([^|\]]+)/i);
        if (lm) {
          rawLicenseNum = lm[1].trim();
          rawLicenseExpiry = lm[2].trim();
        }
      }
      if ((!rawRestrictions || (Array.isArray(rawRestrictions) && rawRestrictions.length === 0)) && notes) {
        const rm = notes.match(/Restrictions?:\s*([^|\]\n]+)/i);
        if (rm) rawRestrictions = rm[1].trim();
      }
      if (!finalDesignatedDriver && notes) {
        const dm = notes.match(/(?:Designated\s*Driver|Driver):\s*([^|\]\n]+)/i);
        if (dm) finalDesignatedDriver = dm[1].trim();
      }

      // Format validation: Exactly A12-34-567890
      if (!rawLicenseNum || !rawLicenseNum.trim()) {
        return res.status(400).json({
          message: "Driver's license number is required.",
        });
      }

      const licenseVal = validateDriverLicense(rawLicenseNum.trim());
      if (!licenseVal.isValid) {
        return res.status(400).json({
          message: licenseVal.error || DRIVER_LICENSE_ERROR_MSG,
        });
      }
      rawLicenseNum = rawLicenseNum.trim();

      // Convert restrictions to array
      let restrictionsList = [];
      if (Array.isArray(rawRestrictions)) {
        restrictionsList = rawRestrictions.map(r => String(r).trim()).filter(Boolean);
      } else if (typeof rawRestrictions === 'string' && rawRestrictions.trim()) {
        restrictionsList = rawRestrictions.split(/[,;\/]+/).map(r => r.trim()).filter(Boolean);
      }

      // Required check: Must indicate at least one restriction code
      if (restrictionsList.length === 0) {
        return res.status(400).json({
          message: 'License Restriction Code(s) are required to rent a motorcycle. Please indicate the restriction codes on the physical driver license.',
        });
      }

      // Validation Rule: Must include restriction code A or A1
      const hasMotorcycleRestriction = restrictionsList.some(code => {
        const c = code.toUpperCase().trim();
        return c === 'A' || c === 'A1' || c.startsWith('A ') || c.startsWith('A1 ') || c.includes('MOTORCYCLE');
      });

      if (!hasMotorcycleRestriction) {
        return res.status(400).json({
          message: 'Your license does not include restriction code A or A1, which is required to legally operate a motorcycle in the Philippines. This rental cannot proceed without a valid motorcycle license restriction.',
        });
      }

      // Validate expiration date if provided
      if (rawLicenseExpiry) {
        const expDate = new Date(rawLicenseExpiry);
        if (!isNaN(expDate.getTime())) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (expDate < today) {
            return res.status(400).json({
              message: "The provided driver's license has expired. A valid, non-expired license is required to operate a motorcycle.",
            });
          }
        }
      }

      finalRestrictionsStr = restrictionsList.join(', ');
      finalLicenseNum = rawLicenseNum ? String(rawLicenseNum).trim() : null;
      finalLicenseExp = rawLicenseExpiry ? String(rawLicenseExpiry).trim() : null;
      licenseBadge = `[Driver's License: ${finalLicenseNum || 'On File'} | Expiry: ${finalLicenseExp || 'N/A'} | Restrictions: ${finalRestrictionsStr}${finalDesignatedDriver ? ` | Driver: ${finalDesignatedDriver}` : ''}]`;
    }

    const finalNotes = notes ? (notes.includes("[Driver's License:") || notes.includes("[Foreign License") ? notes : `${notes}\n${licenseBadge}`) : licenseBadge;

    // 1. Verify Customer exists and is active
    const [custRows] = await conn.query('SELECT id, unique_id, full_name, email, phone, status FROM users WHERE id = ?', [targetCustomerId]);
    if (!custRows || custRows.length === 0) {
      return res.status(404).json({ message: 'Customer account not found.' });
    }
    const customer = custRows[0];
    if (customer.status !== 'active') {
      return res.status(400).json({ message: `Customer account is ${customer.status}. Only active customers can rent motorcycles.` });
    }

    // 1b. Enforce One-Motorcycle-Rental-at-a-Time rule:
    // A guest who already has an in-progress rental (PENDING_PAYMENT, PENDING_APPROVAL, ACTIVE, RESERVED, OVERDUE)
    // cannot rent another motorcycle until their current rental is COMPLETED, CANCELLED, or REJECTED.
    const [existingRentals] = await conn.query(
      `SELECT mr.id, mr.rental_id, mr.status, mr.start_datetime, mr.expected_return_datetime,
              m.brand, m.model, m.plate_number
       FROM motor_rentals mr
       JOIN motorcycles m ON m.id = mr.motor_id
       WHERE mr.customer_id = ?
         AND mr.status IN ('PENDING_PAYMENT', 'PENDING_APPROVAL', 'ACTIVE', 'RESERVED', 'OVERDUE')
       ORDER BY mr.id DESC
       LIMIT 1`,
      [targetCustomerId]
    );

    if (existingRentals && existingRentals.length > 0) {
      const activeR = existingRentals[0];
      const bikeLabel = `${activeR.brand || ''} ${activeR.model || 'Motorcycle'}`.trim();
      const plateLabel = activeR.plate_number ? ` · Plate ${activeR.plate_number}` : '';
      const statusLabel = String(activeR.status).replace('_', ' ');

      const message = req.user.role === 'customer'
        ? `You already have a motorcycle rental in progress (${bikeLabel}${plateLabel} · ${statusLabel}). You can only rent one motorcycle at a time. Please complete or return your current rental before renting another.`
        : `Guest ${customer.full_name || 'Guest'} already has an active or pending motorcycle rental (${bikeLabel}${plateLabel} · ${statusLabel}). Only one motorcycle rental is permitted per guest at a time.`;

      return res.status(409).json({
        conflict: true,
        has_active_rental: true,
        existing_rental: activeR,
        message
      });
    }

    // Begin Database Transaction with pessimistic row-locking to prevent concurrent double-booking
    await conn.beginTransaction();

    // 2. Verify Motorcycle exists and lock target row (FOR UPDATE)
    const [motorRows] = await conn.query('SELECT * FROM motorcycles WHERE id = ? FOR UPDATE', [motor_id]);
    if (!motorRows || motorRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Motorcycle not found.' });
    }
    const motor = motorRows[0];

    if (motor.status !== 'AVAILABLE') {
      await conn.rollback();
      return res.status(400).json({
        message: `This motorcycle is currently ${motor.status} and cannot be rented.`,
      });
    }

    // 3. Check for reservation date conflicts within the locked transaction
    const [conflictRows] = await conn.query(
      `SELECT id, rental_id, start_datetime, expected_return_datetime 
       FROM motor_rentals 
       WHERE motor_id = ? 
         AND status IN ('ACTIVE', 'RESERVED', 'OVERDUE')
         AND (
           (start_datetime <= ? AND expected_return_datetime >= ?) OR
           (start_datetime <= ? AND expected_return_datetime >= ?) OR
           (start_datetime >= ? AND expected_return_datetime <= ?)
         ) LIMIT 1`,
      [motor_id, startDate, startDate, returnDate, returnDate, startDate, returnDate]
    );

    if (conflictRows && conflictRows.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        message: 'This motorcycle is already reserved or rented during the selected period.',
      });
    }

    // 4. Calculate Rental Duration & Cost automatically on Backend
    const diffMs = returnDate.getTime() - startDate.getTime();
    const rateType = motor.rate_type || 'daily';
    const rate = parseFloat(motor.rental_rate);
    let duration = 0;
    let totalAmount = 0;

    if (rateType === 'hourly') {
      const hours = Math.ceil(diffMs / (1000 * 60 * 60));
      duration = Math.max(1, hours);
      totalAmount = duration * rate;
    } else {
      // Daily rental: ceil to 24-hour periods
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      duration = Math.max(1, days);
      totalAmount = duration * rate;
    }

    // Generate unique Rental ID: MTR-YYYY-XXXX
    const rentalId = await generateNextRentalId(conn);

    const isCustomer = req.user.role === 'customer';
    const requestLifecycle = require('./request-lifecycle.service');
    const paymentDeadline = isCustomer ? requestLifecycle.getPaymentDeadline() : null;
    let initialStatus = isCustomer ? 'PENDING_APPROVAL' : 'ACTIVE';

    // Insert into motor_rentals
    const [rentalResult] = await conn.query(
      `INSERT INTO motor_rentals (
        rental_id, customer_id, motor_id, start_datetime, expected_return_datetime,
        duration, rate, rate_type, total_amount, final_amount, status, notes,
        license_type, passport_number, country_of_issuance, foreign_license_number, foreign_license_expiry, idp_number, idp_expiry, idp_category_a,
        driver_license_number, driver_license_expiry, driver_license_restrictions, designated_driver_name,
        payment_deadline, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        rentalId,
        targetCustomerId,
        motor_id,
        startDate,
        returnDate,
        duration,
        rate,
        rateType,
        totalAmount,
        totalAmount,
        initialStatus,
        finalNotes,
        selectedLicenseType,
        finalPassportNum,
        finalCountryOfIssuance,
        finalForeignLicenseNum,
        finalForeignLicenseExp,
        finalIdpNum,
        finalIdpExp,
        finalIdpCatA,
        finalLicenseNum,
        finalLicenseExp,
        finalRestrictionsStr,
        finalDesignatedDriver,
        paymentDeadline,
        req.user.id,
      ]
    );

    const newRentalDbId = rentalResult.insertId;

    // Generate bill for this motor rental
    const currentYear = new Date().getFullYear();
    const billNumber = `BILL-${rentalId}`;
    const initialPayAmount = req.body.initial_payment ? Number(req.body.initial_payment) : (isCustomer ? 0 : totalAmount);

    const [billRes] = await conn.query(`
      INSERT INTO bills (
        bill_number, customer_id, motor_rental_id, total_amount, paid_amount, status,
        license_type, passport_number, country_of_issuance, foreign_license_number, foreign_license_expiry, idp_number, idp_expiry, idp_category_a,
        driver_license_number, driver_license_expiry, driver_license_restrictions, designated_driver_name,
        issued_by, issued_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      billNumber,
      targetCustomerId,
      newRentalDbId,
      totalAmount,
      initialPayAmount,
      initialPayAmount >= totalAmount ? 'paid' : (initialPayAmount > 0 ? 'partially_paid' : 'unpaid'),
      selectedLicenseType,
      finalPassportNum,
      finalCountryOfIssuance,
      finalForeignLicenseNum,
      finalForeignLicenseExp,
      finalIdpNum,
      finalIdpExp,
      finalIdpCatA,
      finalLicenseNum,
      finalLicenseExp,
      finalRestrictionsStr,
      finalDesignatedDriver,
      req.user.id || targetCustomerId,
    ]);

    const billId = billRes.insertId;

    await conn.query(`
      INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `, [billId, `Motor Rental: ${motor.brand} ${motor.model} (${motor.plate_number}) - ${duration} ${rateType === 'hourly' ? 'hour(s)' : 'day(s)'}`, duration, rate]);

    if (initialPayAmount > 0) {
      await conn.query(`
        INSERT INTO payments (bill_id, amount, method, received_by, notes, paid_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [billId, initialPayAmount, req.body.payment_method || 'cash', req.user.id, `Payment for ${rentalId}`]);
    }

    // Update motorcycle status:
    // When a customer requests a rental, the motorcycle remains AVAILABLE until payment is recorded.
    // On immediate staff walk-in / dispatch or full payment, it is marked RENTED.
    if (!isCustomer || initialPayAmount >= totalAmount) {
      await conn.query('UPDATE motorcycles SET status = ? WHERE id = ?', ['RENTED', motor_id]);
    }

    // Create Audit Log
    const performerName = req.user.full_name || req.user.username;
    await logMotorRentalAction(conn, {
      rentalId: newRentalDbId,
      rentalUniqueId: rentalId,
      motorId: motor_id,
      action: isCustomer ? 'Motor rental requested (Pending Approval)' : 'Motorcycle rented',
      performedBy: req.user.id,
      performedByName: performerName,
      performedByRole: req.user.role,
      remarks: `Rental ${rentalId} created for ${customer.full_name} (${motor.brand} ${motor.model}, Plate: ${motor.plate_number}). Status: ${initialStatus}. Duration: ${duration} ${rateType === 'hourly' ? 'hours' : 'days'}, Total: ₱${totalAmount.toLocaleString()}`,
    });

    await requestLifecycle.logAudit(conn, {
      entityType: 'motor_rental',
      entityId: newRentalDbId,
      fromStatus: null,
      toStatus: initialStatus,
      performedBy: req.user.id,
      performedByName: performerName,
      triggerType: 'manual',
      reason: isCustomer ? 'Customer requested motor rental. Awaiting payment.' : 'Staff created motor rental.',
      metadata: { rentalId, totalAmount, paymentDeadline },
    });

    // Commit Transaction
    await conn.commit();

    // Fetch complete created rental
    const [createdRows] = await pool.query(
      `SELECT 
        mr.*,
        m.brand, m.model, m.type AS motor_type, m.plate_number, m.image_url,
        u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone, u.unique_id AS customer_unique_id,
        creator.full_name AS created_by_name
       FROM motor_rentals mr
       JOIN motorcycles m ON mr.motor_id = m.id
       JOIN users u ON mr.customer_id = u.id
       LEFT JOIN users creator ON mr.created_by = creator.id
       WHERE mr.id = ?`,
      [newRentalDbId]
    );

    res.status(201).json({
      message: isCustomer ? 'Motorcycle rental request submitted. Please complete payment.' : 'Motorcycle rental confirmed successfully!',
      rental: createdRows[0],
    });
  } catch (err) {
    await conn.rollback();
    console.error('Motor rental transaction error:', err);
    res.status(500).json({ message: err.message || 'Failed to process motorcycle rental.' });
  } finally {
    conn.release();
  }
}

/** GET /api/motorcycles/rentals — List all rentals (filtered by user role) */
async function getAllRentals(req, res) {
  try {
    // Automatically flag overdue rentals
    await checkAndUpdateOverdueRentals();

    const { status, q } = req.query;
    let sql = `
      SELECT 
        mr.*,
        m.brand, m.model, m.type AS motor_type, m.plate_number, m.image_url,
        u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone, u.unique_id AS customer_unique_id,
        creator.full_name AS created_by_name,
        returner.full_name AS returned_by_name
      FROM motor_rentals mr
      JOIN motorcycles m ON mr.motor_id = m.id
      JOIN users u ON mr.customer_id = u.id
      LEFT JOIN users creator ON mr.created_by = creator.id
      LEFT JOIN users returner ON mr.returned_by = returner.id
      WHERE 1=1
    `;
    const params = [];

    // Customers only see their own rentals
    if (req.user.role === 'customer') {
      sql += ` AND mr.customer_id = ?`;
      params.push(req.user.id);
    }

    if (status && status !== 'ALL' && status !== 'All') {
      sql += ` AND mr.status = ?`;
      params.push(status.toUpperCase());
    }

    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      sql += ` AND (
        mr.rental_id LIKE ? OR
        m.brand LIKE ? OR
        m.model LIKE ? OR
        m.plate_number LIKE ? OR
        u.full_name LIKE ? OR
        u.unique_id LIKE ?
      )`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    sql += ` ORDER BY mr.created_at DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/motorcycles/rentals/:id — Get single rental with audit trail */
async function getRentalById(req, res) {
  try {
    const rentalId = req.params.id;
    const [rows] = await pool.query(
      `SELECT 
        mr.*,
        m.brand, m.model, m.type AS motor_type, m.plate_number, m.rental_rate, m.description, m.image_url,
        u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone, u.unique_id AS customer_unique_id,
        creator.full_name AS created_by_name,
        returner.full_name AS returned_by_name
       FROM motor_rentals mr
       JOIN motorcycles m ON mr.motor_id = m.id
       JOIN users u ON mr.customer_id = u.id
       LEFT JOIN users creator ON mr.created_by = creator.id
       LEFT JOIN users returner ON mr.returned_by = returner.id
       WHERE mr.id = ? OR mr.rental_id = ?`,
      [rentalId, rentalId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'Rental transaction not found.' });
    }

    const rental = rows[0];

    // Customer security check
    if (req.user.role === 'customer' && rental.customer_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // Get audit history
    const [auditLogs] = await pool.query(
      `SELECT * FROM motor_rental_audit_logs WHERE rental_id = ? ORDER BY created_at DESC`,
      [rental.id]
    );

    // Get damage assessments if any
    const [damageAssessments] = await pool.query(
      `SELECT mda.*, staff.full_name AS assessed_by_name, waiver_staff.full_name AS waived_by_name
       FROM motor_damage_assessments mda
       JOIN users staff ON mda.assessed_by = staff.id
       LEFT JOIN users waiver_staff ON mda.waived_by = waiver_staff.id
       WHERE mda.rental_id = ? ORDER BY mda.id DESC`,
      [rental.id]
    );

    res.json({ rental, audit_logs: auditLogs, damage_assessments: damageAssessments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/motorcycles/rentals/:id/return — Staff/Admin: Process Motorcycle Return */
async function processMotorReturn(req, res) {
  const conn = await pool.getConnection();
  try {
    const targetRentalId = req.params.id;
    const staffId = req.user.id;
    const staffName = req.user.full_name || req.user.username;
    const {
      condition,
      remarks,
      maintenance_needed,
      waive_late_fee,
      late_fee_override,
      waiver_reason,
      damage, // { has_damage, severity, description, photos, estimated_repair_cost }
    } = req.body;

    const [rentalRows] = await conn.query(
      `SELECT mr.*, m.rental_rate, m.rate_type, m.late_fee_hourly_rate, m.plate_number, m.brand, m.model 
       FROM motor_rentals mr
       JOIN motorcycles m ON mr.motor_id = m.id
       WHERE (mr.id = ? OR mr.rental_id = ?) AND mr.status IN ('ACTIVE', 'OVERDUE', 'RESERVED')`,
      [targetRentalId, targetRentalId]
    );

    if (!rentalRows || rentalRows.length === 0) {
      return res.status(404).json({ message: 'Active rental not found or already completed.' });
    }

    const rental = rentalRows[0];
    const actualReturnTime = new Date();
    const expectedReturnTime = new Date(rental.expected_return_datetime);

    // Determine hourly late rate:
    let hourlyLateRate = 100.00;
    if (rental.late_fee_hourly_rate !== null && rental.late_fee_hourly_rate !== undefined && parseFloat(rental.late_fee_hourly_rate) > 0) {
      hourlyLateRate = parseFloat(rental.late_fee_hourly_rate);
    } else if (rental.rate_type === 'hourly' && parseFloat(rental.rental_rate) > 0) {
      hourlyLateRate = Math.round(parseFloat(rental.rental_rate) * 1.5);
    } else if (parseFloat(rental.rental_rate) > 0) {
      hourlyLateRate = Math.max(100, Math.round((parseFloat(rental.rental_rate) / 24) * 1.5));
    }

    let lateFee = 0;
    let hoursLate = 0;
    const isWaived = Boolean(waive_late_fee);
    const waiverReason = isWaived ? (waiver_reason || remarks || 'Staff waiver granted') : null;

    if (actualReturnTime > expectedReturnTime) {
      const lateDiffMs = actualReturnTime.getTime() - expectedReturnTime.getTime();
      hoursLate = Math.max(0, Math.ceil(lateDiffMs / (1000 * 60 * 60)));
      
      if (isWaived) {
        lateFee = 0;
      } else if (late_fee_override !== undefined && late_fee_override !== null && !isNaN(parseFloat(late_fee_override))) {
        lateFee = Math.max(0, parseFloat(late_fee_override));
      } else {
        lateFee = hoursLate * hourlyLateRate;
      }
    }

    // Damage assessment handling
    let damageFee = 0;
    let damageAssessmentRecord = null;
    const hasDamage = Boolean(
      damage &&
      (damage.has_damage || parseFloat(damage.estimated_repair_cost) > 0 || (damage.description && damage.description.trim()))
    );

    let nextMotorStatus = maintenance_needed ? 'MAINTENANCE' : 'AVAILABLE';

    await conn.beginTransaction();

    if (hasDamage) {
      const severity = ['minor', 'moderate', 'major', 'total_loss'].includes(damage.severity) ? damage.severity : 'minor';
      const damageDesc = (damage.description || 'Damage noted upon return inspection.').trim();
      damageFee = Math.max(0, parseFloat(damage.estimated_repair_cost) || 0);

      // Photos processing
      const rawPhotos = Array.isArray(damage.photos) ? damage.photos : (damage.photos ? [damage.photos] : []);
      const savedPhotos = rawPhotos.map((p, idx) => saveBase64Image(p, `damage-${rental.rental_id}-${idx + 1}`));

      // Insert into motor_damage_assessments
      const [damageRes] = await conn.query(
        `INSERT INTO motor_damage_assessments 
          (rental_id, motor_id, customer_id, assessed_by, severity, description, photos, estimated_repair_cost, charge_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'billed', NOW())`,
        [
          rental.id,
          rental.motor_id,
          rental.customer_id,
          staffId,
          severity,
          damageDesc,
          JSON.stringify(savedPhotos),
          damageFee,
          damageFee,
        ]
      );

      const damageAssessmentId = damageRes.insertId;

      // When damage is documented, vehicle MUST be flagged MAINTENANCE until repairs cleared
      nextMotorStatus = 'MAINTENANCE';

      // Find associated bill
      const [billRows] = await conn.query(
        `SELECT id, bill_number, total_amount, paid_amount 
         FROM bills 
         WHERE motor_rental_id = ? OR bill_number = ? 
         ORDER BY id DESC LIMIT 1`,
        [rental.id, `BILL-${rental.rental_id}`]
      );

      if (billRows.length > 0 && damageFee > 0) {
        const b = billRows[0];
        // Insert line item
        await conn.query(
          `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
           VALUES (?, ?, 1, ?)`,
          [
            b.id,
            `Damage Fee: ${damageDesc} (${severity.toUpperCase()}) — ${rental.rental_id}`,
            damageFee,
          ]
        );

        // Update bill totals
        const newTotal = parseFloat(b.total_amount) + damageFee;
        const paidAmt = parseFloat(b.paid_amount || 0);
        const newStatus = paidAmt >= newTotal ? 'paid' : (paidAmt > 0 ? 'partially_paid' : 'unpaid');

        await conn.query(
          `UPDATE bills 
           SET total_amount = ?,
               status = ?,
               updated_at = NOW()
           WHERE id = ?`,
          [newTotal, newStatus, b.id]
        );

        await conn.query(
          `UPDATE motor_damage_assessments SET bill_id = ? WHERE id = ?`,
          [b.id, damageAssessmentId]
        );
      }

      damageAssessmentRecord = {
        id: damageAssessmentId,
        severity,
        description: damageDesc,
        photos: savedPhotos,
        charge_amount: damageFee,
      };
    }

    const finalAmount = parseFloat(rental.total_amount) + lateFee + damageFee;

    // 1. Update motor_rentals
    await conn.query(
      `UPDATE motor_rentals 
       SET status = 'COMPLETED',
           actual_return_datetime = ?,
           late_fee = ?,
           hours_late = ?,
           hourly_late_rate = ?,
           late_fee_waived = ?,
           late_fee_waiver_reason = ?,
           has_damage = ?,
           damage_fee = ?,
           final_amount = ?,
           returned_by = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        actualReturnTime,
        lateFee,
        hoursLate,
        hourlyLateRate,
        isWaived,
        waiverReason,
        hasDamage ? 1 : 0,
        damageFee,
        finalAmount,
        staffId,
        rental.id,
      ]
    );

    // 2. Update motorcycle status
    await conn.query(
      `UPDATE motorcycles SET status = ?, updated_at = NOW() WHERE id = ?`,
      [nextMotorStatus, rental.motor_id]
    );

    // 3. Create Audit Log
    const returnRemarks = [
      remarks || 'Motorcycle returned.',
      isWaived
        ? `Late fee waived (${hoursLate} hrs overdue) — Reason: ${waiverReason}`
        : lateFee > 0
        ? `Late return penalty applied: ₱${lateFee.toLocaleString()} (${hoursLate} hr${hoursLate > 1 ? 's' : ''} late × ₱${hourlyLateRate}/hr)`
        : null,
      hasDamage
        ? `Damage assessed: ₱${damageFee.toLocaleString()} (${damageAssessmentRecord.severity.toUpperCase()}) — ${damageAssessmentRecord.description}`
        : null,
      nextMotorStatus === 'MAINTENANCE'
        ? 'Motorcycle placed into MAINTENANCE status for repair/inspection.'
        : 'Motorcycle returned to AVAILABLE status.',
    ].filter(Boolean).join(' | ');

    await logMotorRentalAction(conn, {
      rentalId: rental.id,
      rentalUniqueId: rental.rental_id,
      motorId: rental.motor_id,
      action: hasDamage ? 'Motorcycle returned with damage' : 'Motorcycle returned',
      performedBy: staffId,
      performedByName: staffName,
      performedByRole: req.user.role,
      remarks: returnRemarks,
    });

    await conn.commit();

    const [completedRows] = await pool.query(
      `SELECT mr.*, m.brand, m.model, m.plate_number 
       FROM motor_rentals mr 
       JOIN motorcycles m ON mr.motor_id = m.id 
       WHERE mr.id = ?`,
      [rental.id]
    );

    res.json({
      message: hasDamage
        ? 'Motorcycle return & damage assessment processed successfully!'
        : 'Motorcycle return processed successfully!',
      rental: completedRows[0],
      hours_late: hoursLate,
      hourly_late_rate: hourlyLateRate,
      late_fee: lateFee,
      late_fee_waived: isWaived,
      has_damage: hasDamage,
      damage_fee: damageFee,
      damage_assessment: damageAssessmentRecord,
      final_amount: finalAmount,
      motorcycle_status: nextMotorStatus,
    });
  } catch (err) {
    await conn.rollback();
    console.error('Process return error:', err);
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/** POST /api/motorcycles/rentals/:id/pickup-inspection — Staff/Admin: Save Pickup Inspection */
async function savePickupInspection(req, res) {
  const conn = await pool.getConnection();
  try {
    const targetRentalId = req.params.id;
    const staffId = req.user.id;
    const staffName = req.user.full_name || req.user.username;
    const { checklist, photos, notes } = req.body;

    const [rentalRows] = await conn.query(
      `SELECT id, rental_id, motor_id, status FROM motor_rentals WHERE id = ? OR rental_id = ?`,
      [targetRentalId, targetRentalId]
    );
    if (!rentalRows || rentalRows.length === 0) {
      return res.status(404).json({ message: 'Rental not found.' });
    }
    const rental = rentalRows[0];

    const rawPhotos = Array.isArray(photos) ? photos : (photos ? [photos] : []);
    const savedPhotos = rawPhotos.map((p, idx) => saveBase64Image(p, `pickup-${rental.rental_id}-${idx + 1}`));

    const checklistObj = checklist || {};
    if (notes) checklistObj.notes = notes;

    await conn.query(
      `UPDATE motor_rentals 
       SET pickup_checklist = ?,
           pickup_photos = ?,
           pickup_inspected_by = ?,
           pickup_inspected_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(checklistObj), JSON.stringify(savedPhotos), staffId, rental.id]
    );

    await logMotorRentalAction(conn, {
      rentalId: rental.id,
      rentalUniqueId: rental.rental_id,
      motorId: rental.motor_id,
      action: 'Pickup condition documented',
      performedBy: staffId,
      performedByName: staffName,
      performedByRole: req.user.role,
      remarks: `Pickup baseline condition recorded with ${savedPhotos.length} photo(s).`,
    });

    res.json({
      message: 'Pickup condition inspection saved successfully.',
      rental_id: rental.rental_id,
      pickup_checklist: checklistObj,
      pickup_photos: savedPhotos,
    });
  } catch (err) {
    console.error('Save pickup inspection error:', err);
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/** PATCH /api/motorcycles/rentals/:id/damage/waive — Staff/Admin: Waive or adjust damage fee */
async function waiveDamageFee(req, res) {
  const conn = await pool.getConnection();
  try {
    const targetRentalId = req.params.id;
    const staffId = req.user.id;
    const staffName = req.user.full_name || req.user.username;
    const { reason, adjust_amount } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'A justification reason is required to waive or adjust a damage fee.' });
    }

    const [rentalRows] = await conn.query(
      `SELECT id, rental_id, motor_id, total_amount, late_fee, damage_fee, final_amount, status 
       FROM motor_rentals WHERE id = ? OR rental_id = ?`,
      [targetRentalId, targetRentalId]
    );
    if (!rentalRows || rentalRows.length === 0) {
      return res.status(404).json({ message: 'Rental not found.' });
    }
    const rental = rentalRows[0];
    const currentDamageFee = parseFloat(rental.damage_fee || 0);

    if (currentDamageFee <= 0) {
      return res.status(400).json({ message: 'This rental does not have an active damage fee to waive.' });
    }

    const isAdjustment = adjust_amount !== undefined && adjust_amount !== null && !isNaN(parseFloat(adjust_amount));
    const newDamageFee = isAdjustment ? Math.max(0, parseFloat(adjust_amount)) : 0;
    const feeDifference = currentDamageFee - newDamageFee; // amount to deduct from bill

    await conn.beginTransaction();

    // 1. Update motor_damage_assessments
    await conn.query(
      `UPDATE motor_damage_assessments 
       SET status = ?,
           charge_amount = ?,
           waived_by = ?,
           waived_at = NOW(),
           waiver_reason = ?,
           updated_at = NOW()
       WHERE rental_id = ? AND status = 'billed'`,
      [isAdjustment ? 'adjusted' : 'waived', newDamageFee, staffId, reason.trim(), rental.id]
    );

    // 2. Update motor_rentals
    const newFinalAmount = parseFloat(rental.final_amount) - feeDifference;
    await conn.query(
      `UPDATE motor_rentals 
       SET damage_fee = ?,
           damage_fee_waived = ?,
           damage_fee_waiver_reason = ?,
           final_amount = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [newDamageFee, !isAdjustment, reason.trim(), newFinalAmount, rental.id]
    );

    // 3. Update Bill
    const [billRows] = await conn.query(
      `SELECT id, total_amount, paid_amount 
       FROM bills 
       WHERE motor_rental_id = ? OR bill_number = ? 
       ORDER BY id DESC LIMIT 1`,
      [rental.id, `BILL-${rental.rental_id}`]
    );

    if (billRows.length > 0) {
      const b = billRows[0];
      // Append waiver line item
      await conn.query(
        `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
         VALUES (?, ?, 1, ?)`,
        [
          b.id,
          `Damage Fee ${isAdjustment ? 'Adjustment' : 'Waiver'}: ${reason.trim()} — ${rental.rental_id}`,
          -feeDifference,
        ]
      );

      const updatedTotal = Math.max(0, parseFloat(b.total_amount) - feeDifference);
      const paidAmt = parseFloat(b.paid_amount || 0);
      const updatedStatus = paidAmt >= updatedTotal ? 'paid' : (paidAmt > 0 ? 'partially_paid' : 'unpaid');

      await conn.query(
        `UPDATE bills 
         SET total_amount = ?,
             status = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [updatedTotal, updatedStatus, b.id]
      );
    }

    // 4. Audit log
    await logMotorRentalAction(conn, {
      rentalId: rental.id,
      rentalUniqueId: rental.rental_id,
      motorId: rental.motor_id,
      action: isAdjustment ? 'Damage fee adjusted' : 'Damage fee waived',
      performedBy: staffId,
      performedByName: staffName,
      performedByRole: req.user.role,
      remarks: `${isAdjustment ? `Damage fee adjusted from ₱${currentDamageFee} to ₱${newDamageFee}` : `Damage fee (₱${currentDamageFee}) completely waived`}. Reason: ${reason.trim()}`,
    });

    await conn.commit();

    res.json({
      message: isAdjustment ? 'Damage fee adjusted successfully.' : 'Damage fee waived successfully.',
      rental_id: rental.rental_id,
      previous_fee: currentDamageFee,
      new_fee: newDamageFee,
      final_amount: newFinalAmount,
      waiver_reason: reason.trim(),
    });
  } catch (err) {
    await conn.rollback();
    console.error('Waive damage fee error:', err);
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/** GET /api/motorcycles/damage-history — Staff/Admin: Get fleet damage history */
async function getDamageHistory(req, res) {
  try {
    const { motor_id, severity, status } = req.query;
    let query = `
      SELECT 
        mda.*,
        m.brand, m.model, m.plate_number, m.image_url AS motor_image_url,
        u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone, u.unique_id AS customer_unique_id,
        staff.full_name AS assessed_by_name,
        waiver_staff.full_name AS waived_by_name,
        mr.rental_id, mr.start_datetime, mr.actual_return_datetime
      FROM motor_damage_assessments mda
      JOIN motorcycles m ON mda.motor_id = m.id
      JOIN users u ON mda.customer_id = u.id
      JOIN users staff ON mda.assessed_by = staff.id
      LEFT JOIN users waiver_staff ON mda.waived_by = waiver_staff.id
      JOIN motor_rentals mr ON mda.rental_id = mr.id
      WHERE 1=1
    `;
    const params = [];

    if (motor_id) {
      query += ` AND mda.motor_id = ?`;
      params.push(motor_id);
    }
    if (severity) {
      query += ` AND mda.severity = ?`;
      params.push(severity);
    }
    if (status) {
      query += ` AND mda.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY mda.created_at DESC LIMIT 100`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('getDamageHistory error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/motorcycles/rentals/:id/cancel — Cancel a rental */
async function cancelMotorRental(req, res) {
  const conn = await pool.getConnection();
  try {
    const targetRentalId = req.params.id;
    const [rentalRows] = await conn.query('SELECT * FROM motor_rentals WHERE (id = ? OR rental_id = ?)', [targetRentalId, targetRentalId]);

    if (!rentalRows || rentalRows.length === 0) {
      return res.status(404).json({ message: 'Rental not found.' });
    }

    const rental = rentalRows[0];
    if (rental.status === 'COMPLETED' || rental.status === 'CANCELLED') {
      return res.status(400).json({ message: `Cannot cancel a rental that is already ${rental.status}.` });
    }

    await conn.beginTransaction();

    await conn.query('UPDATE motor_rentals SET status = ?, updated_at = NOW() WHERE id = ?', ['CANCELLED', rental.id]);
    await conn.query('UPDATE motorcycles SET status = ? WHERE id = ?', ['AVAILABLE', rental.motor_id]);

    await logMotorRentalAction(conn, {
      rentalId: rental.id,
      rentalUniqueId: rental.rental_id,
      motorId: rental.motor_id,
      action: 'Rental cancelled',
      performedBy: req.user.id,
      performedByName: req.user.full_name || req.user.username,
      performedByRole: req.user.role,
      remarks: 'Rental cancelled by user. Motorcycle status restored to AVAILABLE.',
    });

    await conn.commit();
    res.json({ message: 'Rental cancelled successfully.' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/** PATCH /api/motorcycles/rentals/:id/approve — Staff/Admin: Approve rental */
async function approveMotorRental(req, res) {
  try {
    const targetRentalId = req.params.id;
    const [rentalRows] = await pool.query('SELECT id FROM motor_rentals WHERE (id = ? OR rental_id = ?)', [targetRentalId, targetRentalId]);
    if (rentalRows.length === 0) return res.status(404).json({ message: 'Rental not found.' });
    
    const requestLifecycle = require('./request-lifecycle.service');
    const result = await requestLifecycle.approveRequest('motor_rental', rentalRows[0].id, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
}

/** PATCH /api/motorcycles/rentals/:id/reject — Staff/Admin: Reject rental */
async function rejectMotorRental(req, res) {
  try {
    const targetRentalId = req.params.id;
    const [rentalRows] = await pool.query('SELECT id FROM motor_rentals WHERE (id = ? OR rental_id = ?)', [targetRentalId, targetRentalId]);
    if (rentalRows.length === 0) return res.status(404).json({ message: 'Rental not found.' });
    
    const { reason, notes } = req.body;
    const requestLifecycle = require('./request-lifecycle.service');
    const result = await requestLifecycle.rejectRequest('motor_rental', rentalRows[0].id, req.user, reason, notes);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
}

module.exports = {
  getMotorcycles,
  getMotorcycleById,
  createMotorcycle,
  updateMotorcycle,
  updateMotorcycleStatus,
  createMotorRental,
  getAllRentals,
  getRentalById,
  processMotorReturn,
  savePickupInspection,
  waiveDamageFee,
  getDamageHistory,
  cancelMotorRental,
  approveMotorRental,
  rejectMotorRental,
};
