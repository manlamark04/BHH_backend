const pool = require('../src/config/db');

async function run() {
  try {
    console.log('Altering bills status column...');
    await pool.query(`
      ALTER TABLE bills 
      MODIFY COLUMN status ENUM('unpaid','partially_paid','paid','cancelled','refunded','void') NOT NULL DEFAULT 'unpaid'
    `);
    console.log('SUCCESS: bills table status column expanded to include cancelled, refunded, void.');
    process.exit(0);
  } catch (err) {
    console.error('ERROR altering table:', err.message);
    process.exit(1);
  }
}

run();
