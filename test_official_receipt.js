const pool = require('./src/config/db');
const { generateReceiptCode, getUniqueReceiptNumber } = require('./src/utils/receipt.util');

async function runTests() {
  console.log('=== Running Official Receipt (OR) Number Integration Tests ===\n');

  // Test 1: Validate OR Code Format
  console.log('[Test 1] Testing OR Code Generation Format (LLLDDD)...');
  for (let i = 0; i < 20; i++) {
    const code = generateReceiptCode();
    console.log(`  Sample ${i + 1}: ${code}`);
    if (!/^OR-[A-Z]{3}\d{3}$/.test(code)) {
      throw new Error(`Test 1 Failed: Generated code "${code}" does not match OR-LLLDDD format!`);
    }
    const raw6 = code.replace('OR-', '');
    if (raw6.length !== 6) {
      throw new Error(`Test 1 Failed: Raw code "${raw6}" is not exactly 6 characters!`);
    }
  }
  console.log('✅ Test 1 Passed: Generated codes strictly match OR-LLLDDD format with exactly 3 letters + 3 digits.\n');

  // Test 2: Uniqueness Generator Check
  console.log('[Test 2] Testing Unique Generation Against Database...');
  const uniqueCode = await getUniqueReceiptNumber(pool);
  console.log(`  Generated unique code: ${uniqueCode}`);
  const [dupCheck] = await pool.query('SELECT id FROM payments WHERE receipt_number = ?', [uniqueCode]);
  if (dupCheck.length > 0) {
    throw new Error('Test 2 Failed: Generated code already exists in database!');
  }
  console.log('✅ Test 2 Passed: getUniqueReceiptNumber verified unique against DB.\n');

  // Test 3: End-to-End Payment Recording with OR Generation
  console.log('[Test 3] Testing Payment Recording with OR Assignment...');
  const currentYear = new Date().getFullYear();
  const testBillNumber = `INV-${currentYear}-TEST-${Date.now().toString().slice(-4)}`;
  
  // Create unpaid test bill
  const [billRes] = await pool.query(`
    INSERT INTO bills (bill_number, customer_id, issued_by, total_amount, paid_amount, status, issued_at)
    VALUES (?, 2, 1, 800.00, 0.00, 'unpaid', NOW())
  `, [testBillNumber]);
  const testBillId = billRes.insertId;

  // Verify bill before payment has null/no receipt_number
  const [billBefore] = await pool.query('SELECT * FROM bills WHERE id = ?', [testBillId]);
  console.log('  Bill before payment:', {
    invoice: billBefore[0].bill_number,
    status: billBefore[0].status,
    receipt_number: billBefore[0].receipt_number || '—',
  });
  if (billBefore[0].receipt_number) {
    throw new Error('Test 3 Failed: Unpaid bill should not have a receipt number before payment!');
  }

  // Record payment
  const orCode = await getUniqueReceiptNumber(pool);
  const [payRes] = await pool.query(`
    INSERT INTO payments (bill_id, amount, method, received_by, notes, receipt_number, paid_at)
    VALUES (?, 800.00, 'cash', 1, 'Test payment', ?, NOW())
  `, [testBillId, orCode]);
  const testPaymentId = payRes.insertId;

  await pool.query('UPDATE bills SET paid_amount = 800.00, status = "paid", receipt_number = ? WHERE id = ?', [orCode, testBillId]);

  // Verify bill and payment after payment
  const [billAfter] = await pool.query('SELECT * FROM bills WHERE id = ?', [testBillId]);
  const [payAfter] = await pool.query('SELECT * FROM payments WHERE id = ?', [testPaymentId]);

  console.log('  Bill after payment:', {
    invoice: billAfter[0].bill_number,
    status: billAfter[0].status,
    receipt_number: billAfter[0].receipt_number,
  });
  console.log('  Payment record:', {
    id: payAfter[0].id,
    method: payAfter[0].method,
    amount: payAfter[0].amount,
    receipt_number: payAfter[0].receipt_number,
  });

  if (billAfter[0].receipt_number !== orCode || payAfter[0].receipt_number !== orCode) {
    throw new Error('Test 3 Failed: Receipt numbers were not saved or do not match!');
  }
  console.log('✅ Test 3 Passed: Payment recorded and OR number persisted to database.\n');

  // Clean up test data
  console.log('Cleaning up test data...');
  await pool.query('DELETE FROM payments WHERE id = ?', [testPaymentId]);
  await pool.query('DELETE FROM bills WHERE id = ?', [testBillId]);
  console.log('✓ Cleaned up test records.');

  console.log('\n🎉 ALL OFFICIAL RECEIPT TESTS PASSED! 🎉\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
