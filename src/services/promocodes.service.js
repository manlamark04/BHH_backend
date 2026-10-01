const pool = require('../config/db');

async function validatePromo(req, res) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Promo code required' });

    const [rows] = await pool.query(
      "SELECT discount_percentage, valid_until FROM promocodes WHERE code = ? AND status = 'active'",
      [code]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Invalid or inactive promo code.' });
    }

    const promo = rows[0];
    if (new Date(promo.valid_until) < new Date()) {
      return res.status(400).json({ message: 'Promo code has expired.' });
    }

    res.json({
      message: 'Promo code applied!',
      discount_percentage: parseFloat(promo.discount_percentage)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error validating promo code.' });
  }
}

// Admin routes
async function getAllPromos(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM promocodes ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching promo codes.' });
  }
}

async function createPromo(req, res) {
  try {
    const { code, discount_percentage, valid_until } = req.body;
    if (!code || !discount_percentage || !valid_until) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    await pool.query(
      "INSERT INTO promocodes (code, discount_percentage, valid_until, status) VALUES (?, ?, ?, 'active')",
      [code.toUpperCase(), discount_percentage, valid_until]
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

module.exports = { validatePromo, getAllPromos, createPromo, updatePromoStatus, deletePromo };
