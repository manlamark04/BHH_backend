const mysql = require('mysql2/promise');

async function migrateAll() {
  const dbs = ['bhh', 'bhh_backend', 'cbi_hotel_db', 'cbi_backend', 'cbi', 'test_db'];
  
  for (const dbName of dbs) {
    try {
      const conn = await mysql.createConnection({
        host: 'localhost',
        user: 'bhh',
        password: 'bhh',
        database: dbName,
      });
      console.log(`Connected to ${dbName}...`);
      
      try {
        await conn.query("ALTER TABLE motor_rentals MODIFY COLUMN customer_id INT NULL");
        console.log(`  -> Altered motor_rentals in ${dbName}`);
      } catch (e) {
        console.log(`  -> Skipping motor_rentals in ${dbName}:`, e.message);
      }
      
      try {
        await conn.query("ALTER TABLE bills MODIFY COLUMN customer_id INT NULL");
        console.log(`  -> Altered bills in ${dbName}`);
      } catch (e) {
        console.log(`  -> Skipping bills in ${dbName}:`, e.message);
      }
      
      await conn.end();
    } catch (err) {
      // Could not connect, ignore
    }
  }
  process.exit(0);
}

migrateAll();
