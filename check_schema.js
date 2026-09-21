const pool = require('./src/config/db');

async function check() {
  try {
    const [rows] = await pool.query('DESCRIBE pos_products');
    console.log(rows.map(r => r.Field));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
