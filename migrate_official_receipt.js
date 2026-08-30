const pool = require('./src/config/db');
const { generateReceiptCode } = require('./src/utils/receipt.util');

async function migrate() {
  console.log('--- Starting Official Receipt (OR) Number Migration ---');

  // 1. Check/Add receipt_number column to payments table
  const [paymentCols] = await pool.query("SHOW COLUMNS FROM payments LIKE 'receipt_number'");
  if (paymentCols.length === 0) {
    console.log('Adding receipt_number column to payments table...');
    await pool.query('ALTER TABLE payments ADD COLUMN receipt_number VARCHAR(30) NULL UNIQUE AFTER notes');
    console.log('✓ Added receipt_number to payments table.');
  } else {
    console.log('✓ Column receipt_number already exists in payments table.');
  }

  // 2. Check/Add receipt_number column to bills table
  const [billCols] = await pool.query("SHOW COLUMNS FROM bills LIKE 'receipt_number'");
  if (billCols.length === 0) {
    console.log('Adding receipt_number column to bills table...');
    await pool.query('ALTER TABLE bills ADD COLUMN receipt_number VARCHAR(30) NULL AFTER status');
    console.log('✓ Added receipt_number to bills table.');
  } else {
    console.log('✓ Column receipt_number already exists in bills table.');
  }

  // 3. Backfill existing payments with unique LLLDDD OR numbers
  const [payments] = await pool.query('SELECT id, bill_id, receipt_number FROM payments ORDER BY id ASC');
  const usedCodes = new Set();

  for (const p of payments) {
    if (p.receipt_number) {
      usedCodes.add(p.receipt_number);
    }
  }

  let backfilledCount = 0;
  for (const p of payments) {
    if (!p.receipt_number) {
      let code = generateReceiptCode();
      while (usedCodes.has(code)) {
        code = generateReceiptCode();
      }
      usedCodes.add(code);

      await pool.query('UPDATE payments SET receipt_number = ? WHERE id = ?', [code, p.id]);
      if (p.bill_id) {
        await pool.query('UPDATE bills SET receipt_number = ? WHERE id = ?', [code, p.bill_id]);
      }
      backfilledCount++;
    } else if (p.bill_id) {
      await pool.query('UPDATE bills SET receipt_number = ? WHERE id = ?', [p.receipt_number, p.bill_id]);
    }
  }

  console.log(`✓ Backfilled ${backfilledCount} payment records with unique Official Receipt numbers.`);
  console.log('--- Migration Completed Successfully ---');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
