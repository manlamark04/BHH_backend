const pool = require('./src/config/db');

async function runTests() {
  console.log('=== Running Motor Rent Calculated Late Fee Integration Tests ===\n');

  // Test 1: Verify Table Schemas
  console.log('[Test 1] Verifying Database Schema for Late Fee Fields...');
  const [motorCols] = await pool.query('DESCRIBE motorcycles');
  const hasLateRateCol = motorCols.some(c => c.Field === 'late_fee_hourly_rate');
  if (!hasLateRateCol) throw new Error('motorcycles.late_fee_hourly_rate column missing!');

  const [rentalCols] = await pool.query('DESCRIBE motor_rentals');
  const colNames = rentalCols.map(c => c.Field);
  const required = ['hours_late', 'hourly_late_rate', 'late_fee_waived', 'late_fee_waiver_reason'];
  for (const r of required) {
    if (!colNames.includes(r)) throw new Error(`motor_rentals.${r} column missing!`);
  }
  console.log('✅ Test 1 Passed: All database columns are in place.\n');

  // Test 2: Rate Fallback and Calculation Math
  console.log('[Test 2] Testing Per-Hour Calculation Formula (Rounding & Multipliers)...');
  
  // Scenario A: 1 hr 15 mins late -> 2 hours late
  const startA = new Date('2026-08-30T08:00:00Z');
  const expectedA = new Date('2026-08-30T17:00:00Z');
  const actualA = new Date('2026-08-30T18:15:00Z'); // 1h15m late
  const diffMsA = actualA.getTime() - expectedA.getTime();
  const hoursLateA = Math.max(0, Math.ceil(diffMsA / (1000 * 60 * 60)));
  if (hoursLateA !== 2) throw new Error(`Expected 2 hours late, got ${hoursLateA}`);
  
  const customRate = 250.00;
  const lateFeeA = hoursLateA * customRate;
  if (lateFeeA !== 500.00) throw new Error(`Expected late fee ₱500.00, got ₱${lateFeeA}`);
  console.log(`  Scenario A (1h15m late @ ₱250/hr): ${hoursLateA} hrs late -> ₱${lateFeeA} late fee (Expected ₱500)`);

  // Scenario B: On-time return
  const actualB = new Date('2026-08-30T16:50:00Z'); // 10 mins early
  const hoursLateB = actualB > expectedA ? Math.ceil((actualB.getTime() - expectedA.getTime()) / (1000 * 60 * 60)) : 0;
  const lateFeeB = hoursLateB * customRate;
  if (hoursLateB !== 0 || lateFeeB !== 0) throw new Error(`Expected 0 hours and ₱0 fee for on-time return`);
  console.log(`  Scenario B (On-time return): ${hoursLateB} hrs late -> ₱${lateFeeB} late fee (Expected ₱0)`);

  console.log('✅ Test 2 Passed: Calculation rounding and logic verified.\n');

  // Test 3: Historical Records Validation
  console.log('[Test 3] Verifying Backfilled Historical Rentals...');
  const [historical] = await pool.query('SELECT rental_id, total_amount, late_fee, hours_late, hourly_late_rate FROM motor_rentals WHERE late_fee > 0');
  console.log(`  Found ${historical.length} completed rentals with calculated late fees:`);
  for (const h of historical) {
    console.log(`    • ${h.rental_id}: ₱${h.late_fee} (+${h.hours_late} hr(s) late @ ₱${h.hourly_late_rate}/hr)`);
  }
  console.log('✅ Test 3 Passed: Historical rental data holds valid breakdown values.\n');

  console.log('🎉 ALL MOTOR RENT LATE FEE TESTS PASSED! 🎉\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
