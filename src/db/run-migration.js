const pool = require('../config/db');

async function migrate() {
  console.log('Running migration...');
  const [colsBefore] = await pool.query('DESCRIBE bookings');
  const existingFields = colsBefore.map(c => c.Field);

  if (!existingFields.includes('booking_type')) {
    console.log('Adding booking_type...');
    await pool.query("ALTER TABLE bookings ADD COLUMN booking_type VARCHAR(20) NOT NULL DEFAULT 'per_night' AFTER room_id");
  }

  if (!existingFields.includes('check_in_time')) {
    console.log('Adding check_in_time...');
    await pool.query("ALTER TABLE bookings ADD COLUMN check_in_time TIME DEFAULT NULL AFTER check_out");
  }

  if (!existingFields.includes('duration_hours')) {
    console.log('Adding duration_hours...');
    await pool.query("ALTER TABLE bookings ADD COLUMN duration_hours TINYINT UNSIGNED DEFAULT NULL AFTER check_in_time");
  }

  // Also modify check_in and check_out to DATETIME or keep as is?
  // Let's check: if check_in and check_out are DATE, storing '2026-08-26 14:00:00' will truncate time unless they are DATETIME!
  // Let's check check_in / check_out column types:
  const checkInCol = colsBefore.find(c => c.Field === 'check_in');
  console.log('check_in current type:', checkInCol ? checkInCol.Type : 'unknown');

  // Let's modify check_in and check_out to DATETIME so date + time is preserved accurately for all bookings!
  if (checkInCol && checkInCol.Type.toLowerCase().startsWith('date') && !checkInCol.Type.toLowerCase().startsWith('datetime')) {
    console.log('Modifying check_in and check_out to DATETIME...');
    await pool.query("ALTER TABLE bookings MODIFY COLUMN check_in DATETIME NOT NULL");
    await pool.query("ALTER TABLE bookings MODIFY COLUMN check_out DATETIME NOT NULL");
  }

  // Index
  try {
    await pool.query("ALTER TABLE bookings ADD INDEX idx_bookings_type (booking_type)");
  } catch (e) {
    if (!e.message.includes('Duplicate key name')) throw e;
  }

  const [colsAfter] = await pool.query('DESCRIBE bookings');
  console.log('Migration complete. Current columns:');
  console.table(colsAfter.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Default: c.Default })));
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
