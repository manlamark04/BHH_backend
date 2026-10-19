const pool = require('../config/db');

let promoColumnsChecked = false;
async function ensurePromoColumns() {
  if (promoColumnsChecked) return;
  try {
    const [maxUsesCol] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promocodes' AND COLUMN_NAME = 'max_uses'`
    );
    if (maxUsesCol.length === 0) {
      await pool.query('ALTER TABLE `promocodes` ADD COLUMN `max_uses` INT NULL DEFAULT NULL');
    }
    const [usedCountCol] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promocodes' AND COLUMN_NAME = 'used_count'`
    );
    if (usedCountCol.length === 0) {
      await pool.query('ALTER TABLE `promocodes` ADD COLUMN `used_count` INT NOT NULL DEFAULT 0');
      try {
        await pool.query(`
          UPDATE promocodes p
          SET used_count = (
            SELECT COUNT(*) FROM bills b 
            WHERE UPPER(b.promo_code) = UPPER(p.code)
              AND b.status NOT IN ('cancelled', 'void')
          )
        `);
      } catch (syncErr) {
        console.warn('Initial promo usage sync error:', syncErr?.message || syncErr);
      }
    }
    promoColumnsChecked = true;
  } catch (err) {
    console.error('Failed to ensure promocodes columns:', err);
  }
}

async function validatePromo(req, res) {
  try {
    await ensurePromoColumns();
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Promo code required' });

    const cleanCode = String(code).trim().toUpperCase();
    const [rows] = await pool.query(
      "SELECT discount_percentage, valid_until, max_uses, used_count FROM promocodes WHERE UPPER(code) = ? AND status = 'active'",
      [cleanCode]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Invalid or inactive promo code.' });
    }

    const promo = rows[0];
    if (new Date(promo.valid_until) < new Date()) {
      return res.status(400).json({ message: 'Promo code has expired.' });
    }

    if (promo.max_uses !== null && promo.max_uses !== undefined && Number(promo.max_uses) > 0) {
      if (Number(promo.used_count || 0) >= Number(promo.max_uses)) {
        return res.status(400).json({ message: 'This promo code has reached its maximum guest limit.' });
      }
    }

    res.json({
      message: 'Promo code applied!',
      discount_percentage: parseFloat(promo.discount_percentage),
      max_uses: promo.max_uses ? Number(promo.max_uses) : null,
      used_count: Number(promo.used_count || 0)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error validating promo code.' });
  }
}

// Admin routes
async function getAllPromos(req, res) {
  try {
    await ensurePromoColumns();
    const [rows] = await pool.query('SELECT * FROM promocodes ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching promo codes.' });
  }
}

async function createPromo(req, res) {
  try {
    await ensurePromoColumns();
    const { code, discount_percentage, valid_until, max_uses } = req.body;
    if (!code || !discount_percentage || !valid_until) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    let cleanMaxUses = null;
    if (max_uses !== undefined && max_uses !== null && String(max_uses).trim() !== '') {
      const parsed = parseInt(max_uses, 10);
      if (!isNaN(parsed) && parsed > 0) {
        cleanMaxUses = parsed;
      }
    }

    await pool.query(
      "INSERT INTO promocodes (code, discount_percentage, valid_until, max_uses, used_count, status) VALUES (?, ?, ?, ?, 0, 'active')",
      [code.trim().toUpperCase(), discount_percentage, valid_until, cleanMaxUses]
    );
    res.status(201).json({ message: 'Promo code created successfully!' });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Promo code already exists.' });
    }
    res.status(500).json({ message: 'Error creating promo code.' });
  }
}

async function updatePromoStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'active' or 'inactive'
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    await pool.query('UPDATE promocodes SET status = ? WHERE id = ?', [status, id]);
    res.json({ message: 'Promo code status updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating promo code.' });
  }
}

async function deletePromo(req, res) {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM promocodes WHERE id = ?', [id]);
    res.json({ message: 'Promo code deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting promo code.' });
  }
}

module.exports = { validatePromo, getAllPromos, createPromo, updatePromoStatus, deletePromo, ensurePromoColumns };
