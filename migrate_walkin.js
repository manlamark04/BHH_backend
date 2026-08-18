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
    console.log('🔄 Connected to database. Running migration...');

    // 1. Check existing columns in users
    const [cols] = await connection.query('DESCRIBE users');
    const existingColNames = cols.map(c => c.Field);

    const addCol = async (colName, colDef) => {
      if (!existingColNames.includes(colName)) {
        console.log(`Adding column: ${colName}`);
        await connection.query(`ALTER TABLE users ADD COLUMN ${colName} ${colDef}`);
      } else {
        console.log(`Column ${colName} already exists.`);
      }
    };

    await addCol('first_name', 'VARCHAR(100) NULL AFTER full_name');
    await addCol('middle_name', 'VARCHAR(100) NULL AFTER first_name');
    await addCol('last_name', 'VARCHAR(100) NULL AFTER middle_name');
    await addCol('address', 'TEXT NULL AFTER phone');
    await addCol('dob', 'DATE NULL AFTER address');
    await addCol('gender', 'VARCHAR(20) NULL AFTER dob');
    await addCol('civil_status', 'VARCHAR(30) NULL AFTER gender');
    await addCol('approved_by', 'INT NULL AFTER created_by');
    await addCol('approved_at', 'DATETIME NULL AFTER approved_by');
    await addCol('rejection_reason', 'TEXT NULL AFTER approved_at');

    // Update status enum or varchar to support 'pending', 'active', 'disabled', 'rejected', 'suspended'
    await connection.query(`ALTER TABLE users MODIFY COLUMN status VARCHAR(30) NOT NULL DEFAULT 'pending'`);

    // 2. Create customer_audit_logs table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        customer_unique_id VARCHAR(50) NOT NULL,
        action VARCHAR(100) NOT NULL,
        performed_by INT NULL,
        performed_by_name VARCHAR(255) NULL,
        performed_by_role VARCHAR(50) NULL,
        remarks TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cal_customer (customer_id),
        INDEX idx_cal_unique_id (customer_unique_id)
      ) ENGINE=InnoDB;
    `);
    console.log('✅ customer_audit_logs table verified.');

    // 3. Create sequence table for Customer IDs (CBI-YYYY-XXXX) to guarantee atomic, collision-free, incrementing sequence
    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_id_sequences (
        year INT PRIMARY KEY,
        last_sequence INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB;
    `);
    console.log('✅ customer_id_sequences table verified.');

    console.log('🎉 Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await connection.end();
  }
}

migrate();
