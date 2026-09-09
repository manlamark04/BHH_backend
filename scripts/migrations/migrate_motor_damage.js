/**
 * Migration: Motorcycle Damage Assessment & Pickup Condition Schema
 */

const pool = require('../../src/config/db');

async function migrateMotorDamage() {
  console.log('=== Running Motorcycle Damage & Pickup Condition Migration ===\n');
  const conn = await pool.getConnection();

  try {
    // 1. Create motor_damage_assessments table
    console.log('1. Creating motor_damage_assessments table...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS motor_damage_assessments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rental_id INT NOT NULL,
        motor_id INT NOT NULL,
        customer_id INT NOT NULL,
        assessed_by INT NOT NULL,
        severity ENUM('minor', 'moderate', 'major', 'total_loss') NOT NULL DEFAULT 'minor',
        description TEXT NOT NULL,
        photos JSON NOT NULL,
        estimated_repair_cost DECIMAL(10,2) NOT NULL,
        charge_amount DECIMAL(10,2) NOT NULL,
        status ENUM('assessed', 'billed', 'waived', 'adjusted', 'settled') NOT NULL DEFAULT 'billed',
        waived_by INT NULL,
        waived_at DATETIME NULL,
        waiver_reason TEXT NULL,
        bill_id INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_mda_rental (rental_id),
        INDEX idx_mda_motor (motor_id),
        INDEX idx_mda_customer (customer_id),
        INDEX idx_mda_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ motor_damage_assessments table verified.');

    // 2. Add pickup inspection & damage tracking columns to motor_rentals
    console.log('2. Verifying motor_rentals columns...');
    const [cols] = await conn.query('DESCRIBE motor_rentals');
    const existingCols = cols.map(c => c.Field);

    const addCol = async (colName, colDef) => {
      if (!existingCols.includes(colName)) {
        console.log(`   + Adding ${colName} to motor_rentals...`);
        await conn.query(`ALTER TABLE motor_rentals ADD COLUMN ${colName} ${colDef}`);
      }
    };

    await addCol('pickup_checklist', 'JSON NULL');
    await addCol('pickup_photos', 'JSON NULL');
    await addCol('pickup_inspected_by', 'INT NULL');
    await addCol('pickup_inspected_at', 'DATETIME NULL');
    await addCol('has_damage', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await addCol('damage_fee', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
    await addCol('damage_fee_waived', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await addCol('damage_fee_waiver_reason', 'VARCHAR(255) NULL');

    console.log('✓ motor_rentals columns verified.');

    // 3. Ensure motorcycles table status includes MAINTENANCE
    console.log('3. Verifying motorcycles status column...');
    const [motorCols] = await conn.query('DESCRIBE motorcycles');
    const statusCol = motorCols.find(c => c.Field === 'status');
    if (statusCol && !statusCol.Type.includes('MAINTENANCE')) {
      console.log('   + Updating motorcycles.status ENUM to include MAINTENANCE...');
      await conn.query("ALTER TABLE motorcycles MODIFY COLUMN status ENUM('AVAILABLE','RENTED','RESERVED','MAINTENANCE','INACTIVE') NOT NULL DEFAULT 'AVAILABLE'");
    }
    console.log('✓ motorcycles table verified.');

    console.log('\n🎉 MOTORCYCLE DAMAGE SCHEMA MIGRATION COMPLETED SUCCESSFULLY! 🎉\n');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  migrateMotorDamage()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { migrateMotorDamage };
