  const pool = require('../src/config/db');

async function run() {
  try {
    console.log('Adding default_password column to users table if not exists...');
    const [cols] = await pool.query("SHOW COLUMNS FROM users LIKE 'default_password'");
    if (cols.length === 0) {
      await pool.query("ALTER TABLE users ADD COLUMN default_password VARCHAR(255) DEFAULT 'user123' AFTER must_change_password");
      console.log('SUCCESS: default_password column added.');
    } else {
      console.log('Column default_password already exists.');
    }
    await pool.query("UPDATE users SET default_password = 'user123' WHERE default_password IS NULL");
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  }
}

run();
