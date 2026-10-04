const pool = require('../config/db');

async function check() {
  const [rows] = await pool.query("SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='bhh' AND COLUMN_NAME='customer_id' AND IS_NULLABLE='NO'");
  console.table(rows);
  process.exit(0);
}
check().catch(console.error);
