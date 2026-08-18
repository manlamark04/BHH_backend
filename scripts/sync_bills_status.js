const pool = require('../src/config/db');

async function syncBillsWithPayments() {
  console.log('Syncing all bills with payments table...');
  try {
    const [bills] = await pool.query('SELECT id, total_amount FROM bills');
    let updatedCount = 0;

    for (const b of bills) {
      const [pRows] = await pool.query(
        "SELECT SUM(amount) AS total_paid FROM payments WHERE bill_id = ? AND (notes IS NULL OR notes NOT LIKE '%[REFUNDED%')",
        [b.id]
      );
      const paid = Number(pRows[0]?.total_paid || 0);
      const total = Number(b.total_amount || 0);

      let status = 'unpaid';
      if (paid >= total && total > 0) status = 'paid';
      else if (paid > 0) status = 'partially_paid';

      await pool.query('UPDATE bills SET paid_amount = ?, status = ? WHERE id = ?', [paid, status, b.id]);
      updatedCount++;
    }

    console.log(`Successfully synced ${updatedCount} bills!`);
  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    process.exit(0);
  }
}

syncBillsWithPayments();
