require('dotenv').config();
const mysql = require('mysql2/promise');
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bhh_db'
};

async function run() {
  const conn = await mysql.createConnection(dbConfig);
  try {
    const [users] = await conn.query("SELECT u.id, u.first_name, u.last_name, u.full_name FROM users u LEFT JOIN users creator ON u.created_by = creator.id WHERE creator.role IN ('staff', 'admin')");
    let updatedCount = 0;
    
    for (const u of users) {
      if (u.last_name && !u.last_name.includes('(Walk-in)')) {
        const newLastName = `${u.last_name} (Walk-in)`;
        const newFullName = u.full_name ? `${u.full_name} (Walk-in)` : newLastName;
        
        await conn.query("UPDATE users SET last_name = ?, full_name = ? WHERE id = ?", [newLastName, newFullName, u.id]);
        updatedCount++;
      }
    }
    console.log(`Successfully appended (Walk-in) to ${updatedCount} existing walk-in guests.`);
  } catch (err) {
    console.error(err);
  } finally {
    await conn.end();
  }
}
run();
