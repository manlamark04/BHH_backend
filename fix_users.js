const mysql = require('mysql2/promise');
require('dotenv').config();

async function updateWalkIns() {
  try {
    const pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'bhh_db'
    });

    const [result] = await pool.query(`
      UPDATE users 
      SET status = 'active' 
      WHERE created_by IS NOT NULL AND status = 'pending'
    `);
    
    console.log(`Successfully updated ${result.affectedRows} walk-in users to active.`);
    process.exit(0);
  } catch (err) {
    console.error('Error updating users:', err);
    process.exit(1);
  }
}

updateWalkIns();
