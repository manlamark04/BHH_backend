require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'bhh',
  user: process.env.DB_USER || 'bhh',
  password: process.env.DB_PASSWORD || 'bhh',
};

async function migrate() {
  const connection = await mysql.createConnection(DB_CONFIG);
  try {
    console.log('🔄 Connected to database. Starting multi-court migration...');

    // 1. Create courts table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS courts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        court_code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 150.00,
        status ENUM('AVAILABLE','RENTED','MAINTENANCE','INACTIVE') NOT NULL DEFAULT 'AVAILABLE',
        description TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_court_status (status),
        INDEX idx_court_code (court_code)
      ) ENGINE=InnoDB;
    `);
    console.log('✅ courts table verified.');

    // 2. Add court_id to activity_rentals if it doesn't exist
    const [cols] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'activity_rentals' AND COLUMN_NAME = 'court_id'
    `, [DB_CONFIG.database]);

    if (cols.length === 0) {
      await connection.query(`
        ALTER TABLE activity_rentals 
        ADD COLUMN court_id INT NULL AFTER activity_id,
        ADD CONSTRAINT fk_rentals_court FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE SET NULL,
        ADD INDEX idx_rentals_court (court_id)
      `);
      console.log('✅ court_id column added to activity_rentals.');
    } else {
      console.log('ℹ️ court_id column already exists in activity_rentals.');
    }

    // 3. Seed initial courts if empty
    const [existingCourts] = await connection.query('SELECT COUNT(*) as cnt FROM courts');
    if (existingCourts[0].cnt === 0) {
      console.log('🌱 Seeding initial Pickleball Courts: Court A and Court B...');
      const seedCourts = [
        {
          court_code: 'COURT-A',
          name: 'Court A',
          hourly_rate: 150.00,
          status: 'AVAILABLE',
          description: 'Outdoor regulation pickleball court with floodlighting, pro netting, and premium anti-slip hard surface.',
        },
        {
          court_code: 'COURT-B',
          name: 'Court B',
          hourly_rate: 150.00,
          status: 'AVAILABLE',
          description: 'Outdoor regulation pickleball court with floodlighting, pro netting, and shaded seating bench.',
        },
      ];

      for (const c of seedCourts) {
        await connection.query(
          `INSERT INTO courts (court_code, name, hourly_rate, status, description)
           VALUES (?, ?, ?, ?, ?)`,
          [c.court_code, c.name, c.hourly_rate, c.status, c.description]
        );
      }
      console.log('✅ Court A and Court B seeded.');
    }

    // 4. Backfill existing pickleball reservations with Court A
    const [courtARow] = await connection.query("SELECT id FROM courts WHERE court_code = 'COURT-A' LIMIT 1");
    if (courtARow.length > 0) {
      const courtAId = courtARow[0].id;
      const [updateRes] = await connection.query(`
        UPDATE activity_rentals ar
        JOIN activities a ON a.id = ar.activity_id
        SET ar.court_id = ?
        WHERE ar.court_id IS NULL 
          AND (LOWER(a.name) LIKE '%pickleball%' OR LOWER(a.name) LIKE '%court%' OR ar.activity_id = 2)
      `, [courtAId]);
      console.log(`✅ Backfilled ${updateRes.affectedRows} historical pickleball reservations to Court A (id: ${courtAId}).`);
    }

    console.log('🎉 Multi-court migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await connection.end();
  }
}

migrate();
