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
    console.log('🔄 Connected to database. Migrating Request Lifecycle State Machine...');
    await connection.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'");

    // 1. Alter bookings table
    console.log('1. Updating bookings table schema...');
    
    // Check existing columns in bookings
    const [bookingCols] = await connection.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bookings'
    `, [DB_CONFIG.database]);
    const bookingColNames = bookingCols.map(c => c.COLUMN_NAME);

    // Modify status column on bookings to support all states
    await connection.query(`
      ALTER TABLE bookings 
      MODIFY COLUMN status ENUM('pending_payment','pending_approval','confirmed','checked_in','checked_out','cancelled','rejected','requested','pending') 
      NOT NULL DEFAULT 'pending_payment'
    `);

    // Add lifecycle tracking columns if not present
    if (!bookingColNames.includes('rejection_reason')) {
      await connection.query(`ALTER TABLE bookings ADD COLUMN rejection_reason TEXT NULL AFTER notes`);
    }
    if (!bookingColNames.includes('rejected_by')) {
      await connection.query(`ALTER TABLE bookings ADD COLUMN rejected_by INT NULL AFTER rejection_reason`);
    }
    if (!bookingColNames.includes('rejected_at')) {
      await connection.query(`ALTER TABLE bookings ADD COLUMN rejected_at DATETIME NULL AFTER rejected_by`);
    }
    if (!bookingColNames.includes('approved_by')) {
      await connection.query(`ALTER TABLE bookings ADD COLUMN approved_by INT NULL AFTER rejected_at`);
    }
    if (!bookingColNames.includes('approved_at')) {
      await connection.query(`ALTER TABLE bookings ADD COLUMN approved_at DATETIME NULL AFTER approved_by`);
    }
    if (!bookingColNames.includes('payment_deadline')) {
      await connection.query(`ALTER TABLE bookings ADD COLUMN payment_deadline DATETIME NULL AFTER approved_at`);
    }
    if (!bookingColNames.includes('auto_cancelled')) {
      await connection.query(`ALTER TABLE bookings ADD COLUMN auto_cancelled BOOLEAN NOT NULL DEFAULT FALSE AFTER payment_deadline`);
    }

    // Backfill legacy status 'requested' / 'pending' -> 'pending_payment' if unpaid, or 'confirmed'
    await connection.query(`UPDATE bookings SET status = 'pending_payment' WHERE status IN ('requested', 'pending')`);
    console.log('✅ bookings table updated.');

    // 2. Alter activity_rentals table (Pickleball Court & Activities)
    console.log('2. Updating activity_rentals table schema...');
    const [activityCols] = await connection.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'activity_rentals'
    `, [DB_CONFIG.database]);
    const activityColNames = activityCols.map(c => c.COLUMN_NAME);

    await connection.query(`
      ALTER TABLE activity_rentals 
      MODIFY COLUMN status ENUM('pending_payment','pending_approval','confirmed','active','completed','cancelled','rejected','requested','pending') 
      NOT NULL DEFAULT 'pending_payment'
    `);

    if (!activityColNames.includes('rejection_reason')) {
      await connection.query(`ALTER TABLE activity_rentals ADD COLUMN rejection_reason TEXT NULL AFTER notes`);
    }
    if (!activityColNames.includes('rejected_by')) {
      await connection.query(`ALTER TABLE activity_rentals ADD COLUMN rejected_by INT NULL AFTER rejection_reason`);
    }
    if (!activityColNames.includes('rejected_at')) {
      await connection.query(`ALTER TABLE activity_rentals ADD COLUMN rejected_at DATETIME NULL AFTER rejected_by`);
    }
    if (!activityColNames.includes('approved_by')) {
      await connection.query(`ALTER TABLE activity_rentals ADD COLUMN approved_by INT NULL AFTER rejected_at`);
    }
    if (!activityColNames.includes('approved_at')) {
      await connection.query(`ALTER TABLE activity_rentals ADD COLUMN approved_at DATETIME NULL AFTER approved_by`);
    }
    if (!activityColNames.includes('payment_deadline')) {
      await connection.query(`ALTER TABLE activity_rentals ADD COLUMN payment_deadline DATETIME NULL AFTER approved_at`);
    }
    if (!activityColNames.includes('auto_cancelled')) {
      await connection.query(`ALTER TABLE activity_rentals ADD COLUMN auto_cancelled BOOLEAN NOT NULL DEFAULT FALSE AFTER payment_deadline`);
    }

    await connection.query(`UPDATE activity_rentals SET status = 'pending_payment' WHERE status IN ('requested', 'pending')`);
    console.log('✅ activity_rentals table updated.');

    // 3. Alter motor_rentals table
    console.log('3. Updating motor_rentals table schema...');
    const [motorCols] = await connection.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'motor_rentals'
    `, [DB_CONFIG.database]);
    const motorColNames = motorCols.map(c => c.COLUMN_NAME);

    await connection.query(`
      ALTER TABLE motor_rentals 
      MODIFY COLUMN status ENUM('PENDING_PAYMENT','PENDING_APPROVAL','PENDING','RESERVED','ACTIVE','COMPLETED','CANCELLED','OVERDUE','REJECTED') 
      NOT NULL DEFAULT 'PENDING_PAYMENT'
    `);

    if (!motorColNames.includes('rejection_reason')) {
      await connection.query(`ALTER TABLE motor_rentals ADD COLUMN rejection_reason TEXT NULL AFTER notes`);
    }
    if (!motorColNames.includes('rejected_by')) {
      await connection.query(`ALTER TABLE motor_rentals ADD COLUMN rejected_by INT NULL AFTER rejection_reason`);
    }
    if (!motorColNames.includes('rejected_at')) {
      await connection.query(`ALTER TABLE motor_rentals ADD COLUMN rejected_at DATETIME NULL AFTER rejected_by`);
    }
    if (!motorColNames.includes('approved_by')) {
      await connection.query(`ALTER TABLE motor_rentals ADD COLUMN approved_by INT NULL AFTER rejected_at`);
    }
    if (!motorColNames.includes('approved_at')) {
      await connection.query(`ALTER TABLE motor_rentals ADD COLUMN approved_at DATETIME NULL AFTER approved_by`);
    }
    if (!motorColNames.includes('payment_deadline')) {
      await connection.query(`ALTER TABLE motor_rentals ADD COLUMN payment_deadline DATETIME NULL AFTER approved_at`);
    }
    if (!motorColNames.includes('auto_cancelled')) {
      await connection.query(`ALTER TABLE motor_rentals ADD COLUMN auto_cancelled BOOLEAN NOT NULL DEFAULT FALSE AFTER payment_deadline`);
    }
    console.log('✅ motor_rentals table updated.');

    // 4. Create request_audit_logs table
    console.log('4. Creating request_audit_logs table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS request_audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entity_type ENUM('booking','motor_rental','activity_rental') NOT NULL,
        entity_id INT NOT NULL,
        from_status VARCHAR(50),
        to_status VARCHAR(50) NOT NULL,
        performed_by INT NULL,
        performed_by_name VARCHAR(255),
        trigger_type ENUM('manual','system','payment') NOT NULL DEFAULT 'manual',
        reason TEXT,
        metadata JSON,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ral_entity (entity_type, entity_id),
        INDEX idx_ral_created (created_at)
      ) ENGINE=InnoDB;
    `);
    console.log('✅ request_audit_logs table verified.');

    // 5. Create refunds table
    console.log('5. Creating refunds table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS refunds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entity_type ENUM('booking','motor_rental','activity_rental') NOT NULL,
        entity_id INT NOT NULL,
        bill_id INT NULL,
        payment_id INT NULL,
        customer_id INT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('pending','processed','failed') NOT NULL DEFAULT 'pending',
        reason TEXT,
        processed_by INT NULL,
        processed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_refunds_entity (entity_type, entity_id),
        INDEX idx_refunds_status (status)
      ) ENGINE=InnoDB;
    `);
    console.log('✅ refunds table verified.');

    console.log('🎉 Request Lifecycle migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

migrate();
