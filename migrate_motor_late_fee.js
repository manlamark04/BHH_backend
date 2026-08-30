const pool = require('./src/config/db');

async function migrate() {
  console.log('--- Starting Motor Rent Late Fee Migration ---');

  // 1. Add late_fee_hourly_rate to motorcycles if not exists
  const [motorCols] = await pool.query('DESCRIBE motorcycles');
  const motorColNames = motorCols.map((c) => c.Field);

  if (!motorColNames.includes('late_fee_hourly_rate')) {
    console.log('Adding late_fee_hourly_rate column to motorcycles table...');
    await pool.query('ALTER TABLE motorcycles ADD COLUMN late_fee_hourly_rate DECIMAL(10,2) NULL DEFAULT NULL AFTER rental_rate');
    console.log('✓ Added late_fee_hourly_rate to motorcycles.');
  } else {
    console.log('late_fee_hourly_rate column already exists on motorcycles.');
  }

  // 2. Add late fee breakdown columns to motor_rentals if not exist
  const [rentalCols] = await pool.query('DESCRIBE motor_rentals');
  const rentalColNames = rentalCols.map((c) => c.Field);

  if (!rentalColNames.includes('hours_late')) {
    console.log('Adding hours_late column to motor_rentals...');
    await pool.query('ALTER TABLE motor_rentals ADD COLUMN hours_late INT NOT NULL DEFAULT 0 AFTER late_fee');
  }

  if (!rentalColNames.includes('hourly_late_rate')) {
    console.log('Adding hourly_late_rate column to motor_rentals...');
    await pool.query('ALTER TABLE motor_rentals ADD COLUMN hourly_late_rate DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER hours_late');
  }

  if (!rentalColNames.includes('late_fee_waived')) {
    console.log('Adding late_fee_waived column to motor_rentals...');
    await pool.query('ALTER TABLE motor_rentals ADD COLUMN late_fee_waived BOOLEAN NOT NULL DEFAULT FALSE AFTER hourly_late_rate');
  }

  if (!rentalColNames.includes('late_fee_waiver_reason')) {
    console.log('Adding late_fee_waiver_reason column to motor_rentals...');
    await pool.query('ALTER TABLE motor_rentals ADD COLUMN late_fee_waiver_reason VARCHAR(255) NULL AFTER late_fee_waived');
  }

  console.log('✓ motor_rentals columns verified.');

  // 3. Backfill historical completed rentals that have late_fee > 0
  const [historicalRentals] = await pool.query('SELECT * FROM motor_rentals WHERE late_fee > 0');
  console.log(`Found ${historicalRentals.length} historical rentals with late fees.`);

  for (const r of historicalRentals) {
    if (r.expected_return_datetime && r.actual_return_datetime) {
      const exp = new Date(r.expected_return_datetime);
      const act = new Date(r.actual_return_datetime);
      const diffMs = act.getTime() - exp.getTime();
      let hrs = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
      if (hrs <= 0) hrs = 1;
      const rate = (parseFloat(r.late_fee) / hrs).toFixed(2);

      await pool.query(
        'UPDATE motor_rentals SET hours_late = ?, hourly_late_rate = ? WHERE id = ?',
        [hrs, rate, r.id]
      );
      console.log(`  Updated Rental ${r.rental_id || r.id}: ${hrs} hrs late @ ₱${rate}/hr (Total: ₱${r.late_fee})`);
    } else {
      // Fallback if missing dates
      const hrs = 1;
      const rate = parseFloat(r.late_fee);
      await pool.query(
        'UPDATE motor_rentals SET hours_late = ?, hourly_late_rate = ? WHERE id = ?',
        [hrs, rate, r.id]
      );
    }
  }

  console.log('--- Migration Completed Successfully ---');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
