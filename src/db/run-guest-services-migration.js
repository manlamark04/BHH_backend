const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function run() {
  try {
    const sqlPath = path.join(__dirname, 'migrations', 'add_guest_service_availments.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Migration add_guest_service_availments executed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
