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
    console.log('🔄 Connected to database. Migrating motorcycle rental tables...');

    // 1. Create motorcycles table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS motorcycles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        motor_id VARCHAR(50) UNIQUE NOT NULL,
        brand VARCHAR(100) NOT NULL,
        model VARCHAR(150) NOT NULL,
        type VARCHAR(100) NOT NULL,
        plate_number VARCHAR(50) UNIQUE NOT NULL,
        rental_rate DECIMAL(10,2) NOT NULL,
        rate_type ENUM('hourly','daily') NOT NULL DEFAULT 'daily',
        description TEXT,
        image_url TEXT,
        status ENUM('AVAILABLE','RESERVED','RENTED','MAINTENANCE','INACTIVE') NOT NULL DEFAULT 'AVAILABLE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_motor_status (status),
        INDEX idx_motor_plate (plate_number)
      ) ENGINE=InnoDB;
    `);
    console.log('✅ motorcycles table verified.');

    // 2. Create motor_rental_sequences table for atomic MTR-YYYY-XXXX ID generation
    await connection.query(`
      CREATE TABLE IF NOT EXISTS motor_rental_sequences (
        year INT PRIMARY KEY,
        last_sequence INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB;
    `);
    console.log('✅ motor_rental_sequences table verified.');

    // 3. Create motor_rentals table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS motor_rentals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rental_id VARCHAR(50) UNIQUE NOT NULL,
        customer_id INT NOT NULL,
        motor_id INT NOT NULL,
        start_datetime DATETIME NOT NULL,
        expected_return_datetime DATETIME NOT NULL,
        actual_return_datetime DATETIME NULL,
        duration DECIMAL(10,2) NOT NULL,
        rate DECIMAL(10,2) NOT NULL,
        rate_type VARCHAR(20) NOT NULL DEFAULT 'daily',
        total_amount DECIMAL(10,2) NOT NULL,
        late_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        final_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        status ENUM('PENDING','RESERVED','ACTIVE','COMPLETED','CANCELLED','OVERDUE') NOT NULL DEFAULT 'ACTIVE',
        notes TEXT,
        created_by INT NULL,
        returned_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_mr_customer FOREIGN KEY (customer_id) REFERENCES users(id),
        CONSTRAINT fk_mr_motor FOREIGN KEY (motor_id) REFERENCES motorcycles(id),
        CONSTRAINT fk_mr_createdby FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_mr_returnedby FOREIGN KEY (returned_by) REFERENCES users(id),
        INDEX idx_mr_status (status),
        INDEX idx_mr_dates (start_datetime, expected_return_datetime)
      ) ENGINE=InnoDB;
    `);
    console.log('✅ motor_rentals table verified.');

    // 4. Create motor_rental_audit_logs table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS motor_rental_audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rental_id INT NULL,
        rental_unique_id VARCHAR(50) NULL,
        motor_id INT NULL,
        action VARCHAR(100) NOT NULL,
        performed_by INT NULL,
        performed_by_name VARCHAR(255) NULL,
        performed_by_role VARCHAR(50) NULL,
        remarks TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mral_rental (rental_id),
        INDEX idx_mral_motor (motor_id)
      ) ENGINE=InnoDB;
    `);
    console.log('✅ motor_rental_audit_logs table verified.');

    // 5. Seed Initial Motorcycle Catalog if empty
    const [existing] = await connection.query('SELECT COUNT(*) as cnt FROM motorcycles');
    if (existing[0].cnt === 0) {
      console.log('🌱 Seeding initial motorcycle fleet...');
      const seedMotors = [
        {
          motor_id: 'MOT-2026-0001',
          brand: 'Honda',
          model: 'Click 125',
          type: 'Scooter',
          plate_number: 'BHH-7101',
          rental_rate: 500.00,
          rate_type: 'daily',
          description: 'Smooth automatic 125cc scooter. Fuel efficient with spacious under-seat compartment.',
          image_url: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=600&auto=format&fit=crop&q=80',
          status: 'AVAILABLE',
        },
        {
          motor_id: 'MOT-2026-0002',
          brand: 'Yamaha',
          model: 'Mio Sporty',
          type: 'Scooter',
          plate_number: 'BHH-7102',
          rental_rate: 450.00,
          rate_type: 'daily',
          description: 'Lightweight and agile automatic scooter. Ideal for solo exploring in Batuan and Bohol.',
          image_url: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=600&auto=format&fit=crop&q=80',
          status: 'AVAILABLE',
        },
        {
          motor_id: 'MOT-2026-0003',
          brand: 'Honda',
          model: 'Beat 110',
          type: 'Scooter',
          plate_number: 'BHH-7103',
          rental_rate: 450.00,
          rate_type: 'daily',
          description: 'Economical 110cc automatic scooter with enhanced smart power engine.',
          image_url: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=600&auto=format&fit=crop&q=80',
          status: 'AVAILABLE',
        },
        {
          motor_id: 'MOT-2026-0004',
          brand: 'Yamaha',
          model: 'NMAX 155',
          type: 'Maxi-Scooter',
          plate_number: 'BHH-7104',
          rental_rate: 750.00,
          rate_type: 'daily',
          description: 'Premium 155cc maxi-scooter with ABS, dual-channel disc brakes, and superior ride comfort.',
          image_url: 'https://images.unsplash.com/photo-1609630875171-b1321377ee65?w=600&auto=format&fit=crop&q=80',
          status: 'AVAILABLE',
        },
        {
          motor_id: 'MOT-2026-0005',
          brand: 'Yamaha',
          model: 'Aerox 155',
          type: 'Sport Scooter',
          plate_number: 'BHH-7105',
          rental_rate: 700.00,
          rate_type: 'daily',
          description: 'Sporty dynamic performance with VVA engine and aggressive handling.',
          image_url: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=600&auto=format&fit=crop&q=80',
          status: 'AVAILABLE',
        },
      ];

      for (const m of seedMotors) {
        await connection.query(
          `INSERT INTO motorcycles (motor_id, brand, model, type, plate_number, rental_rate, rate_type, description, image_url, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [m.motor_id, m.brand, m.model, m.type, m.plate_number, m.rental_rate, m.rate_type, m.description, m.image_url, m.status]
        );
      }
      console.log(`✅ Seeded ${seedMotors.length} motorcycles.`);
    }

    console.log('🎉 Motorcycle rental migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await connection.end();
  }
}

migrate();
