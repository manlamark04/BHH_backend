const pool = require('../config/db');

async function migrate() {
  console.log('Modifying bills.customer_id to allow NULL...');
  try {
    await pool.query("ALTER TABLE bills MODIFY COLUMN customer_id INT NULL");
    console.log('Done altering bills.');
  } catch (err) {
    console.error('Error altering bills:', err.message);
  }

  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
