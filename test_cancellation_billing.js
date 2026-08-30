require('dotenv').config();
const pool = require('./src/config/db');
const { cancelRequest } = require('./src/services/request-lifecycle.service');

async function test() {
  console.log('--- Running Cancellation Billing Integration Test ---');

  // 1. Get or create test customer
  const [customers] = await pool.query("SELECT id, full_name, email FROM users WHERE role = 'customer' LIMIT 1");
  if (customers.length === 0) {
    throw new Error('No customer found for testing');
  }
  const testCustomer = customers[0];
  console.log(`Using test customer ID ${testCustomer.id} (${testCustomer.full_name})`);

  // 2. Get a test room
  const [rooms] = await pool.query("SELECT id, room_number FROM rooms LIMIT 1");
  const testRoom = rooms[0];

  // Test Case A: Standard Cancellation (₱0 Fee)
  console.log('\n[Test Case A] Creating unpaid booking and bill for ₱950.00...');
  const [bkgResA] = await pool.query(`
    INSERT INTO bookings (customer_id, room_id, check_in, check_out, status, created_at)
    VALUES (?, ?, '2026-09-10', '2026-09-11', 'pending_payment', NOW())
  `, [testCustomer.id, testRoom.id]);
  const bkgIdA = bkgResA.insertId;

  const [billResA] = await pool.query(`
    INSERT INTO bills (bill_number, customer_id, booking_id, total_amount, paid_amount, status, issued_by, issued_at)
    VALUES (?, ?, ?, 950.00, 0.00, 'unpaid', ?, NOW())
  `, [`BILL-TEST-A-${bkgIdA}`, testCustomer.id, bkgIdA, testCustomer.id]);
  const billIdA = billResA.insertId;

  console.log(`Created booking ID ${bkgIdA} and bill ID ${billIdA}`);

  // Cancel booking without fee
  console.log('Cancelling booking without fee...');
  const cancelResA = await cancelRequest('booking', bkgIdA, testCustomer, 'Guest change of plans', false, 0.00);
  console.log('Cancel result:', cancelResA);

  // Check database bill status
  const [billRowA] = await pool.query('SELECT status, cancellation_fee, total_amount, paid_amount FROM bills WHERE id = ?', [billIdA]);
  console.log('Bill A after cancel:', billRowA[0]);
  if (billRowA[0].status !== 'cancelled' || Number(billRowA[0].cancellation_fee) !== 0) {
    throw new Error(`Test Case A Failed: Expected status cancelled and fee 0, got ${JSON.stringify(billRowA[0])}`);
  }
  console.log('✅ Test Case A Passed: Bill status updated to cancelled with 0 fee.');

  // Test Case B: Cancellation with Custom Fee (₱150 Fee)
  console.log('\n[Test Case B] Creating booking for cancellation with ₱150 fee...');
  const [bkgResB] = await pool.query(`
    INSERT INTO bookings (customer_id, room_id, check_in, check_out, status, created_at)
    VALUES (?, ?, '2026-09-15', '2026-09-16', 'pending_payment', NOW())
  `, [testCustomer.id, testRoom.id]);
  const bkgIdB = bkgResB.insertId;

  const [billResB] = await pool.query(`
    INSERT INTO bills (bill_number, customer_id, booking_id, total_amount, paid_amount, status, issued_by, issued_at)
    VALUES (?, ?, ?, 1200.00, 0.00, 'unpaid', ?, NOW())
  `, [`BILL-TEST-B-${bkgIdB}`, testCustomer.id, bkgIdB, testCustomer.id]);
  const billIdB = billResB.insertId;

  console.log('Cancelling booking with ₱150 fee...');
  const cancelResB = await cancelRequest('booking', bkgIdB, testCustomer, 'Late cancellation fee applied', false, 150.00);
  console.log('Cancel result B:', cancelResB);

  const [billRowB] = await pool.query('SELECT status, cancellation_fee, total_amount, paid_amount FROM bills WHERE id = ?', [billIdB]);
  console.log('Bill B after cancel:', billRowB[0]);
  if (billRowB[0].status !== 'cancelled' || Number(billRowB[0].cancellation_fee) !== 150) {
    throw new Error(`Test Case B Failed: Expected status cancelled and fee 150, got ${JSON.stringify(billRowB[0])}`);
  }
  console.log('✅ Test Case B Passed: Bill status updated to cancelled with ₱150 fee recorded.');

  // Check Audit Log
  const [auditRows] = await pool.query(`
    SELECT * FROM request_audit_logs WHERE entity_type = 'booking' AND entity_id IN (?, ?) ORDER BY id DESC
  `, [bkgIdA, bkgIdB]);
  console.log(`Found ${auditRows.length} audit log records for cancelled bookings.`);
  if (auditRows.length < 2) {
    throw new Error('Test Failed: Audit log records were not created.');
  }
  console.log('✅ Test Case C Passed: Audit log records verified.');

  // Clean up test data
  console.log('\nCleaning up test data...');
  await pool.query('DELETE FROM bills WHERE id IN (?, ?)', [billIdA, billIdB]);
  await pool.query('DELETE FROM bookings WHERE id IN (?, ?)', [bkgIdA, bkgIdB]);
  await pool.query("DELETE FROM request_audit_logs WHERE entity_type = 'booking' AND entity_id IN (?, ?)", [bkgIdA, bkgIdB]);
  console.log('✓ Cleaned up test data.');

  console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
  await pool.end();
}

test().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
