const pool = require('../src/config/db');

async function alterRoomsStatus() {
  console.log('Modifying rooms status column to VARCHAR(50)...');
  try {
    await pool.query("ALTER TABLE rooms MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'available'");
    console.log('Successfully altered rooms.status to VARCHAR(50)!');
  } catch (err) {
    console.error('Failed to alter rooms table:', err.message);
  } finally {
    process.exit(0);
  }
}

alterRoomsStatus();
