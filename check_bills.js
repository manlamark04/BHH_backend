const pool = require('./src/config/db');

async function checkBills() {
  const [rows] = await pool.query('DESCRIBE bills;');
  console.log(rows);
  process.exit(0);
}
checkBills();
