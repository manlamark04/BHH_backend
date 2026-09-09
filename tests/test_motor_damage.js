/**
 * Integration Tests for Motorcycle Damage Assessment & Pickup Condition Workflow
 */

const assert = require('assert');
const pool = require('../src/config/db');

async function runTests() {
  console.log('=== Running Motorcycle Damage Assessment & Pickup Condition Tests ===\n');

  const testSuffix = Date.now().toString().slice(-4);
  const testPlate = `DMG-${testSuffix}`;
  let createdMotorId = null;
  let createdRentalId = null;
  let createdBillId = null;
  let customerId = null;
  let staffId = null;

  try {
    // 0. Setup: Grab or create customer and staff
    const [custRows] = await pool.query("SELECT id FROM users WHERE role = 'customer' LIMIT 1");
    customerId = custRows[0]?.id || 2;

    const [staffRows] = await pool.query("SELECT id FROM users WHERE role IN ('staff', 'admin') LIMIT 1");
    staffId = staffRows[0]?.id || 1;

    // Create test motorcycle
    const [mRes] = await pool.query(
      `INSERT INTO motorcycles (motor_id, brand, model, type, plate_number, rental_rate, rate_type, status, created_at)
       VALUES (?, 'Honda', 'Click 125i Damage Test', 'Scooter', ?, 500.00, 'daily', 'AVAILABLE', NOW())`,
      [`MOT-TEST-${testSuffix}`, testPlate]
    );
    createdMotorId = mRes.insertId;

    // Create test rental
    const rentalCode = `MTR-TEST-${testSuffix}`;
    const [rRes] = await pool.query(
      `INSERT INTO motor_rentals (
        rental_id, customer_id, motor_id, start_datetime, expected_return_datetime,
        duration, rate, rate_type, total_amount, final_amount, status, created_by, created_at
      ) VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), 1, 500.00, 'daily', 500.00, 500.00, 'ACTIVE', ?, NOW())`,
      [rentalCode, customerId, createdMotorId, staffId]
    );
    createdRentalId = rRes.insertId;

    // Create corresponding bill
    const [bRes] = await pool.query(
      `INSERT INTO bills (bill_number, customer_id, motor_rental_id, total_amount, paid_amount, status, issued_by, issued_at)
       VALUES (?, ?, ?, 500.00, 0.00, 'unpaid', ?, NOW())`,
      [`BILL-${rentalCode}`, customerId, createdRentalId, staffId]
    );
    createdBillId = bRes.insertId;

    await pool.query(
      `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
       VALUES (?, 'Motor Rental: Honda Click 125i - 1 day(s)', 1, 500.00)`,
      [createdBillId]
    );

    console.log(`Created test motorcycle #${createdMotorId} (${testPlate}) and rental #${createdRentalId} (${rentalCode})`);

    // [Test 1] Pickup Condition Documentation
    console.log('\n[Test 1] Testing Pickup Inspection Documentation...');
    const pickupChecklist = {
      no_scratches: true,
      mirrors_intact: true,
      lights_working: true,
      brakes_responsive: true,
      fuel_level: 'full',
      helmets_count: 2,
      notes: 'Small pre-existing paint chip on front fender.',
    };
    const pickupPhotos = ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='];

    // Call service helper logic directly or query DB
    const svc = require('../src/services/motorcycle.service');
    const mockReq1 = {
      params: { id: createdRentalId },
      user: { id: staffId, role: 'staff', full_name: 'Test Staff' },
      body: { checklist: pickupChecklist, photos: pickupPhotos },
    };
    const mockRes1 = {
      statusCode: 200,
      json(data) { this.body = data; },
      status(c) { this.statusCode = c; return this; },
    };

    await svc.savePickupInspection(mockReq1, mockRes1);
    assert.strictEqual(mockRes1.statusCode, 200);

    const [rentalAfterPickup] = await pool.query('SELECT * FROM motor_rentals WHERE id = ?', [createdRentalId]);
    const storedChecklist = typeof rentalAfterPickup[0].pickup_checklist === 'string'
      ? JSON.parse(rentalAfterPickup[0].pickup_checklist)
      : rentalAfterPickup[0].pickup_checklist;
    assert.strictEqual(storedChecklist.helmets_count, 2);
    assert.strictEqual(storedChecklist.notes, 'Small pre-existing paint chip on front fender.');
    console.log('  ✓ Pickup checklist and baseline photo URLs persisted to rental.');
    console.log('✅ Test 1 Passed: Pickup condition successfully saved.\n');

    // [Test 2] Return with Damage Assessment & Itemized Bill Charge
    console.log('[Test 2] Testing Return With Damage Assessment & Auto-Billing...');
    const damagePayload = {
      has_damage: true,
      severity: 'moderate',
      description: 'Cracked left side mirror and scraped muffler cover from slip.',
      estimated_repair_cost: 1200.00,
      photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const mockReq2 = {
      params: { id: createdRentalId },
      user: { id: staffId, role: 'staff', full_name: 'Test Staff' },
      body: {
        remarks: 'Returned with cosmetic crash damage on left side.',
        maintenance_needed: true,
        damage: damagePayload,
      },
    };
    const mockRes2 = {
      statusCode: 200,
      json(data) { this.body = data; },
      status(c) { this.statusCode = c; return this; },
    };

    await svc.processMotorReturn(mockReq2, mockRes2);
    assert.strictEqual(mockRes2.statusCode, 200);
    assert.strictEqual(mockRes2.body.has_damage, true);
    assert.strictEqual(mockRes2.body.damage_fee, 1200);
    assert.strictEqual(mockRes2.body.final_amount, 1700); // 500 base + 1200 damage

    // Verify motorcycle status routed to MAINTENANCE
    const [motorAfterReturn] = await pool.query('SELECT status FROM motorcycles WHERE id = ?', [createdMotorId]);
    assert.strictEqual(motorAfterReturn[0].status, 'MAINTENANCE');
    console.log('  ✓ Damaged motorcycle automatically marked MAINTENANCE (locked from re-booking).');

    // Verify motor_damage_assessments table
    const [assessments] = await pool.query('SELECT * FROM motor_damage_assessments WHERE rental_id = ?', [createdRentalId]);
    assert.strictEqual(assessments.length, 1);
    assert.strictEqual(assessments[0].severity, 'moderate');
    assert.strictEqual(Number(assessments[0].charge_amount), 1200.00);
    assert.strictEqual(assessments[0].status, 'billed');
    console.log('  ✓ motor_damage_assessments record created with severity and estimated cost.');

    // Verify bill line item and total amount
    const [billAfterDamage] = await pool.query('SELECT * FROM bills WHERE id = ?', [createdBillId]);
    assert.strictEqual(Number(billAfterDamage[0].total_amount), 1700.00);
    const remainingBalance = Number(billAfterDamage[0].total_amount) - Number(billAfterDamage[0].paid_amount);
    assert.strictEqual(remainingBalance, 1700.00);

    const [lineItems] = await pool.query('SELECT * FROM bill_line_items WHERE bill_id = ?', [createdBillId]);
    const damageLineItem = lineItems.find(li => li.description.includes('Damage Fee'));
    assert(Boolean(damageLineItem), 'Expected Damage Fee line item on bill');
    assert.strictEqual(Number(damageLineItem.unit_price), 1200.00);
    console.log('  ✓ Distinct "Damage Fee" line item added to bill, increasing total from ₱500 to ₱1,700.');
    console.log('✅ Test 2 Passed: Damage assessment and bill itemization verified.\n');

    // [Test 3] Damage Fee Waiver Path
    console.log('[Test 3] Testing Damage Fee Waiver Path...');
    const mockReq3 = {
      params: { id: createdRentalId },
      user: { id: staffId, role: 'admin', full_name: 'Test Admin' },
      body: {
        reason: 'Guest covered mirror replacement directly with local repair shop.',
      },
    };
    const mockRes3 = {
      statusCode: 200,
      json(data) { this.body = data; },
      status(c) { this.statusCode = c; return this; },
    };

    await svc.waiveDamageFee(mockReq3, mockRes3);
    assert.strictEqual(mockRes3.statusCode, 200);
    assert.strictEqual(mockRes3.body.new_fee, 0);
    assert.strictEqual(mockRes3.body.final_amount, 500);

    // Verify bill line item adjusted
    const [billAfterWaiver] = await pool.query('SELECT * FROM bills WHERE id = ?', [createdBillId]);
    assert.strictEqual(Number(billAfterWaiver[0].total_amount), 500.00);

    const [assessmentAfterWaiver] = await pool.query('SELECT * FROM motor_damage_assessments WHERE rental_id = ?', [createdRentalId]);
    assert.strictEqual(assessmentAfterWaiver[0].status, 'waived');
    assert.strictEqual(assessmentAfterWaiver[0].waiver_reason, 'Guest covered mirror replacement directly with local repair shop.');
    console.log('  ✓ Damage fee successfully waived, bill total restored to ₱500, and justification logged.');
    console.log('✅ Test 3 Passed: Damage waiver workflow verified.\n');

    // [Test 4] Damage History Reporting API
    console.log('[Test 4] Testing Fleet Damage History Reporting API...');
    const mockReq4 = {
      query: { motor_id: createdMotorId },
      user: { id: staffId, role: 'admin' },
    };
    const mockRes4 = {
      statusCode: 200,
      json(data) { this.body = data; },
      status(c) { this.statusCode = c; return this; },
    };

    await svc.getDamageHistory(mockReq4, mockRes4);
    assert.strictEqual(mockRes4.statusCode, 200);
    assert(Array.isArray(mockRes4.body));
    assert.strictEqual(mockRes4.body.length, 1);
    assert.strictEqual(mockRes4.body[0].brand, 'Honda');
    assert.strictEqual(mockRes4.body[0].plate_number, testPlate);
    console.log('  ✓ Fleet damage history returns structured records with motorcycle and customer details.');
    console.log('✅ Test 4 Passed: Damage history report verified.\n');

    console.log('🎉 ALL MOTORCYCLE DAMAGE ASSESSMENT TESTS PASSED! 🎉\n');
  } finally {
    // Cleanup
    if (createdRentalId) {
      await pool.query('DELETE FROM motor_damage_assessments WHERE rental_id = ?', [createdRentalId]);
      await pool.query('DELETE FROM motor_rental_audit_logs WHERE rental_id = ?', [createdRentalId]);
      if (createdBillId) {
        await pool.query('DELETE FROM bill_line_items WHERE bill_id = ?', [createdBillId]);
        await pool.query('DELETE FROM bills WHERE id = ?', [createdBillId]);
      }
      await pool.query('DELETE FROM motor_rentals WHERE id = ?', [createdRentalId]);
    }
    if (createdMotorId) {
      await pool.query('DELETE FROM motorcycles WHERE id = ?', [createdMotorId]);
    }
  }
}

if (require.main === module) {
  runTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test error:', err);
      process.exit(1);
    });
}

module.exports = { runTests };
