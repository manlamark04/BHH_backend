require('dotenv').config();
const pool = require('./src/config/db');

async function migrate() {
  console.log('--- Starting Cancellation Billing Migration ---');

  // 1. Add motor_rental_id column to bills if not present
  const [motorCol] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills' AND COLUMN_NAME = 'motor_rental_id'`
  );

  if (motorCol.length === 0) {
    console.log('Adding motor_rental_id column to bills table...');
    await pool.query('ALTER TABLE bills ADD COLUMN motor_rental_id INT NULL AFTER activity_rental_id');
    console.log('✓ Added motor_rental_id to bills.');
  }

  // Backfill motor_rental_id on bills matching bill_number
  await pool.query(`
    UPDATE bills b
    JOIN motor_rentals mr ON b.bill_number = CONCAT('BILL-', mr.rental_id)
    SET b.motor_rental_id = mr.id
    WHERE b.motor_rental_id IS NULL
  `);

  // 2. Add cancellation_fee column to bills table if not present
  const [billCols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills' AND COLUMN_NAME = 'cancellation_fee'`
  );

  if (billCols.length === 0) {
    console.log('Adding cancellation_fee column to bills table...');
    await pool.query('ALTER TABLE bills ADD COLUMN cancellation_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00');
    console.log('✓ Added cancellation_fee to bills.');
  } else {
    console.log('✓ cancellation_fee column exists in bills.');
  }

  // 3. Add cancellation_fee column to bookings table if not present
  const [bkgCols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'cancellation_fee'`
  );

  if (bkgCols.length === 0) {
    console.log('Adding cancellation_fee column to bookings table...');
    await pool.query('ALTER TABLE bookings ADD COLUMN cancellation_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00');
    console.log('✓ Added cancellation_fee to bookings.');
  } else {
    console.log('✓ cancellation_fee column exists in bookings.');
  }

  // 4. Synchronize historical cancelled bookings to bills
  console.log('Syncing cancelled bookings to bills...');
  const [updateResult1] = await pool.query(`
    UPDATE bills b
    JOIN bookings bk ON bk.id = b.booking_id
    SET b.status = 'cancelled', b.cancellation_fee = 0.00, b.updated_at = NOW()
    WHERE bk.status IN ('cancelled', 'rejected')
      AND b.status NOT IN ('cancelled', 'void')
  `);
  console.log(`✓ Updated ${updateResult1.affectedRows} bills for cancelled room bookings.`);

  // 5. Synchronize historical cancelled motor rentals
  const [updateResult2] = await pool.query(`
    UPDATE bills b
    JOIN motor_rentals mr ON mr.id = b.motor_rental_id
    SET b.status = 'cancelled', b.cancellation_fee = 0.00, b.updated_at = NOW()
    WHERE mr.status IN ('CANCELLED', 'REJECTED')
      AND b.status NOT IN ('cancelled', 'void')
  `);
  console.log(`✓ Updated ${updateResult2.affectedRows} bills for cancelled motor rentals.`);

  // 6. Synchronize historical cancelled activity rentals
  const [updateResult3] = await pool.query(`
    UPDATE bills b
    JOIN activity_rentals ar ON ar.id = b.activity_rental_id
    SET b.status = 'cancelled', b.cancellation_fee = 0.00, b.updated_at = NOW()
    WHERE ar.status IN ('cancelled', 'rejected')
      AND b.status NOT IN ('cancelled', 'void')
  `);
  console.log(`✓ Updated ${updateResult3.affectedRows} bills for cancelled activity rentals.`);

  console.log('--- Migration Completed Successfully ---');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
