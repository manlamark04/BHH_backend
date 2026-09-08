/**
 * Integration Test: Driver's License Number Validation & Error Handling
 * Required format: A12-34-567890
 */

const assert = require('assert');
const {
  DRIVER_LICENSE_REGEX,
  DRIVER_LICENSE_ERROR_MSG,
  validateDriverLicense,
  formatDriverLicense,
} = require('../src/utils/license.util');
const svc = require('../src/services/motorcycle.service');
const pool = require('../src/config/db');

async function runTests() {
  console.log('=== Running Driver\'s License Validation Tests ===\n');

  // [Test 1] Pure Unit Tests on Validation Rules
  console.log('[Test 1] Testing Validation Rules & Regex...');

  // Valid format
  const validRes = validateDriverLicense('A12-34-567890');
  assert.strictEqual(validRes.isValid, true, 'A12-34-567890 must be valid');
  assert.strictEqual(DRIVER_LICENSE_REGEX.test('A12-34-567890'), true);
  console.log('  ✓ Valid sample A12-34-567890 passes.');

  // Invalid test cases explicitly specified by user:
  const invalidCases = [
    { input: 'AB12-34-567890', reason: 'Two letters at start' },
    { input: 'A123-45-678901', reason: '3 digits before first hyphen' },
    { input: 'A12-345-678901', reason: '3 digits before second hyphen' },
    { input: 'A12-34-5678901', reason: '7 digits at end (too long)' },
    { input: 'a12-34-567890', reason: 'Lowercase letter' },
    { input: 'A12@34-567890', reason: 'Special character @' },
    { input: 'A12-34-56789', reason: '5 digits at end (too short)' },
    { input: '112-34-567890', reason: 'First character is a digit' },
    { input: 'A12-3A-567890', reason: 'Letter in numeric section' },
    { input: '', reason: 'Empty string' },
    { input: null, reason: 'Null input' },
  ];

  for (const tc of invalidCases) {
    const res = validateDriverLicense(tc.input);
    assert.strictEqual(res.isValid, false, `Expected ${tc.input} to be invalid (${tc.reason})`);
    if (tc.input) {
      assert.strictEqual(res.error, DRIVER_LICENSE_ERROR_MSG);
    }
    console.log(`  ✓ Rejected invalid input: "${tc.input}" (${tc.reason})`);
  }
  console.log('✅ Test 1 Passed: All format validation rules strictly verified.\n');

  // [Test 2] Auto-formatting Utility Tests
  console.log('[Test 2] Testing Auto-Formatting with Hyphens & Uppercasing...');
  const formatTests = [
    { input: 'a1234567890', expected: 'A12-34-567890' },
    { input: 'n0112345678', expected: 'N01-12-345678' },
    { input: 'c02-34-567890', expected: 'C02-34-567890' },
    { input: 'a12345678909999', expected: 'A12-34-567890' }, // Clamped at 13 chars
    { input: 'A12', expected: 'A12' },
    { input: 'A123', expected: 'A12-3' },
    { input: 'A12-34', expected: 'A12-34' },
    { input: 'A12-345', expected: 'A12-34-5' },
    { input: '12345', expected: '' }, // Discard non-letter prefix
  ];

  for (const ft of formatTests) {
    const formatted = formatDriverLicense(ft.input);
    assert.strictEqual(formatted, ft.expected, `Formatting "${ft.input}" expected "${ft.expected}", got "${formatted}"`);
    console.log(`  ✓ Formatted "${ft.input}" -> "${formatted}"`);
  }
  console.log('✅ Test 2 Passed: Auto-formatting and hyphen insertion verified.\n');

  // [Test 3] Backend API Integration Test on createMotorRental
  console.log('[Test 3] Testing Backend createMotorRental API Rejection & Acceptance...');
  let testMotorId = null;
  let testCustomerId = null;
  let createdRentalId = null;

  try {
    // Clean up any lingering test rentals from previous runs
    await pool.query("DELETE FROM motor_rentals WHERE driver_license_number = 'N01-12-345678'");

    // 1. Create a dedicated active test customer
    const rndSuffix = Math.floor(Math.random() * 90000) + 10000;
    const [newCust] = await pool.query(
      'INSERT INTO users (unique_id, username, full_name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [`C-${rndSuffix}`, `user_${rndSuffix}`, 'License Test Customer', `lic-${rndSuffix}@test.com`, 'hash', 'customer', 'active']
    );
    testCustomerId = newCust.insertId;

    // 2. Create test motorcycle
    const motorCode = `LIC-${Math.floor(Math.random() * 9000) + 1000}`;
    const [motorRes] = await pool.query(
      `INSERT INTO motorcycles (motor_id, brand, model, type, plate_number, rental_rate, rate_type, status)
       VALUES (?, 'Honda', 'Click 125i', 'Scooter', ?, 500.00, 'daily', 'AVAILABLE')`,
      [motorCode, `TEST-${motorCode}`]
    );
    testMotorId = motorRes.insertId;

    // 3. Test API rejection with invalid format: A12@34-567890
    const mockReqInvalid = {
      user: { id: testCustomerId, role: 'customer' },
      body: {
        motor_id: testMotorId,
        start_datetime: '2026-10-01T08:00:00',
        expected_return_datetime: '2026-10-02T08:00:00',
        license_type: 'PH',
        driver_license_number: 'A12@34-567890',
        driver_license_expiry: '2028-10-01',
        driver_license_restrictions: ['A1'],
      },
    };
    const mockResInvalid = {
      statusCode: 200,
      json(data) { this.body = data; },
      status(c) { this.statusCode = c; return this; },
    };

    await svc.createMotorRental(mockReqInvalid, mockResInvalid);
    assert.strictEqual(mockResInvalid.statusCode, 400);
    assert.strictEqual(mockResInvalid.body.message, DRIVER_LICENSE_ERROR_MSG);
    console.log('  ✓ API returned 400 Bad Request with exact error message for A12@34-567890.');

    // 4. Test API rejection with lowercase: a12-34-567890
    const mockReqLower = {
      user: { id: testCustomerId, role: 'customer' },
      body: {
        motor_id: testMotorId,
        start_datetime: '2026-10-01T08:00:00',
        expected_return_datetime: '2026-10-02T08:00:00',
        license_type: 'PH',
        driver_license_number: 'a12-34-567890',
        driver_license_expiry: '2028-10-01',
        driver_license_restrictions: ['A1'],
      },
    };
    const mockResLower = {
      statusCode: 200,
      json(data) { this.body = data; },
      status(c) { this.statusCode = c; return this; },
    };

    await svc.createMotorRental(mockReqLower, mockResLower);
    assert.strictEqual(mockResLower.statusCode, 400);
    assert.strictEqual(mockResLower.body.message, DRIVER_LICENSE_ERROR_MSG);
    console.log('  ✓ API returned 400 Bad Request for lowercase a12-34-567890.');

    // 5. Test API acceptance with exact valid format: N01-12-345678
    const mockReqValid = {
      user: { id: testCustomerId, role: 'customer' },
      body: {
        motor_id: testMotorId,
        start_datetime: '2026-10-01T08:00:00',
        expected_return_datetime: '2026-10-02T08:00:00',
        license_type: 'PH',
        driver_license_number: 'N01-12-345678',
        driver_license_expiry: '2028-10-01',
        driver_license_restrictions: ['A1'],
      },
    };
    const mockResValid = {
      statusCode: 200,
      json(data) { this.body = data; },
      status(c) { this.statusCode = c; return this; },
    };

    await svc.createMotorRental(mockReqValid, mockResValid);
    assert.strictEqual(mockResValid.statusCode, 201);
    createdRentalId = mockResValid.body.rental.id;
    assert.strictEqual(mockResValid.body.rental.driver_license_number, 'N01-12-345678');
    console.log('  ✓ API successfully accepted valid license N01-12-345678.');

    console.log('✅ Test 3 Passed: Backend controller validation integration verified.\n');
    console.log('🎉 ALL DRIVER LICENSE VALIDATION TESTS PASSED! 🎉\n');
  } finally {
    // Cleanup
    if (createdRentalId) {
      await pool.query('DELETE FROM motor_rentals WHERE id = ?', [createdRentalId]);
    }
    if (testCustomerId) {
      await pool.query('DELETE FROM motor_rentals WHERE customer_id = ?', [testCustomerId]);
      await pool.query('DELETE FROM bill_line_items WHERE bill_id IN (SELECT id FROM bills WHERE customer_id = ?)', [testCustomerId]);
      await pool.query('DELETE FROM bills WHERE customer_id = ?', [testCustomerId]);
      await pool.query('DELETE FROM users WHERE id = ?', [testCustomerId]);
    }
    if (testMotorId) {
      await pool.query('DELETE FROM motorcycles WHERE id = ?', [testMotorId]);
    }
  }
}

if (require.main === module) {
  runTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}

module.exports = { runTests };
