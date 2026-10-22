const pool = require('../../src/config/db');

async function migrate() {
  console.log('--- Migrating Hybrid Refunds & Rebooking Credits Schema ---');
  try {
    // 1. Add credit_balance to users table if not exists
    const [userCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'credit_balance'");
    if (userCols.length === 0) {
      await pool.query("ALTER TABLE users ADD COLUMN credit_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER profile_photo_url");
      console.log('✅ Added credit_balance to users table');
    } else {
      console.log('ℹ️ credit_balance already exists on users');
    }

    // 2. Add refund_type and notes to refunds table if not exists
    const [refCols] = await pool.query("SHOW COLUMNS FROM refunds LIKE 'refund_type'");
    if (refCols.length === 0) {
      await pool.query("ALTER TABLE refunds ADD COLUMN refund_type ENUM('rebooking_credit','cash','gcash','bank_transfer') NOT NULL DEFAULT 'cash' AFTER amount");
      console.log('✅ Added refund_type to refunds table');
    } else {
      console.log('ℹ️ refund_type already exists on refunds');
    }

    console.log('--- Migration completed successfully ---');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
