const pool = require('../config/db');

/**
 * GET /api/bills/eod-report?date=YYYY-MM-DD
 * Daily End-of-Day (EOD) Cashier Reconciliation Report
 */
async function getEODReport(req, res) {
  try {
    const reportDate = req.query.date || new Date().toISOString().split('T')[0];

    // 1. All payments recorded on the requested date
    const [payments] = await pool.query(`
      SELECT 
        p.id AS payment_id,
        p.bill_id,
        p.amount,
        p.method,
        p.receipt_number,
        p.notes,
        p.paid_at,
        b.invoice_number,
        b.description AS bill_description,
        u_cust.full_name AS customer_name,
        u_staff.full_name AS cashier_name
      FROM payments p
      JOIN bills b ON b.id = p.bill_id
      LEFT JOIN users u_cust ON u_cust.id = b.customer_id
      LEFT JOIN users u_staff ON u_staff.id = p.received_by
      WHERE DATE(p.paid_at) = ?
      ORDER BY p.paid_at DESC
    `, [reportDate]);

    // 2. Aggregate metrics by payment method
    let cashTotal = 0;
    let gcashTotal = 0;
    let cardTotal = 0;
    let bankTotal = 0;
    let otherTotal = 0;
    let refundsTotal = 0;

    payments.forEach((p) => {
      const amt = Number(p.amount || 0);
      const isRefund = p.notes && p.notes.includes('[REFUNDED');
      
      if (isRefund) {
        refundsTotal += Math.abs(amt);
        return;
      }

      const method = String(p.method || 'cash').toLowerCase();
      if (method.includes('cash')) {
        cashTotal += amt;
      } else if (method.includes('gcash') || method.includes('maya') || method.includes('wallet')) {
        gcashTotal += amt;
      } else if (method.includes('card') || method.includes('credit') || method.includes('debit')) {
        cardTotal += amt;
      } else if (method.includes('bank') || method.includes('transfer')) {
        bankTotal += amt;
      } else {
        otherTotal += amt;
      }
    });

    const grossTotal = cashTotal + gcashTotal + cardTotal + bankTotal + otherTotal;
    const netTotal = grossTotal - refundsTotal;

    res.json({
      reportDate,
      generatedAt: new Date().toISOString(),
      generatedBy: req.user ? req.user.full_name : 'Staff Cashier',
      metrics: {
        grossTotal,
        netTotal,
        cashTotal,
        gcashTotal,
        cardTotal,
        bankTotal,
        otherTotal,
        refundsTotal,
        transactionCount: payments.length,
      },
      transactions: payments,
    });
  } catch (err) {
    console.error('getEODReport error:', err);
    res.status(500).json({ message: err.message || 'Failed to generate EOD shift report.' });
  }
}

module.exports = {
  getEODReport,
};
