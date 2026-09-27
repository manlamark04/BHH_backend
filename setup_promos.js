const pool = require('./src/config/db');

async function setupPromoCodes() {
  try {
    // 1. Create promocodes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promocodes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        discount_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        valid_until DATETIME NOT NULL,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Insert some defaults
    await pool.query(`INSERT IGNORE INTO promocodes (code, discount_percentage, valid_until) VALUES ('SUMMER20', 20.00, '2026-12-31 23:59:59')`);
    await pool.query(`INSERT IGNORE INTO promocodes (code, discount_percentage, valid_until) VALUES ('WELCOME10', 10.00, '2026-12-31 23:59:59')`);

    // 2. Alter bills table
    try {
      await pool.query('ALTER TABLE bills ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0.00');
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }
    
    try {
      await pool.query('ALTER TABLE bills ADD COLUMN promo_code VARCHAR(50) DEFAULT NULL');
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    console.log("Promo codes setup successful.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
setupPromoCodes();
