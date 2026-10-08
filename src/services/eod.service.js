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
        b.bill_number AS invoice_number,
        '' AS bill_description,
        u_cust.full_name AS customer_name,
        u_staff.full_name AS cashier_name
      FROM payments p
      JOIN bills b ON b.id = p.bill_id
      LEFT JOIN users u_cust ON u_cust.id = b.customer_id
      LEFT JOIN users u_staff ON u_staff.id = p.received_by
      WHERE DATE(p.paid_at) = ?
      ORDER BY p.paid_at DESC
    `, [reportDate]);

    // 1.5 Fetch expenses for the requested date
    const [expenses] = await pool.query(`
      SELECT 
        e.id, e.amount, e.category, e.description, e.expense_date, e.created_at,
        u.full_name as logged_by_name
      FROM expenses e
      LEFT JOIN users u ON u.id = e.logged_by
      WHERE e.expense_date = ?
      ORDER BY e.created_at DESC
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
    
    // Calculate petty cash expenses total
    const expensesTotal = expenses.reduce((sum, exp) => sum + Number(exp.amount), 0);
    const netCashTotal = cashTotal - expensesTotal;

    res.json({
      reportDate,
      generatedAt: new Date().toISOString(),
      generatedBy: req.user ? req.user.full_name : 'Staff Cashier',
      metrics: {
        grossTotal,
        netTotal,
        cashTotal,
        netCashTotal,
        expensesTotal,
        gcashTotal,
        cardTotal,
        bankTotal,
        otherTotal,
        refundsTotal,
        transactionCount: payments.length,
      },
      transactions: payments,
      expenses: expenses,
    });
  } catch (err) {
    console.error('getEODReport error:', err);
    res.status(500).json({ message: err.message || 'Failed to generate EOD shift report.' });
  }
}

async function addExpense(req, res) {
  try {
    const { amount, category, description, expense_date } = req.body;
    const staffId = req.user.id;
    const dateToUse = expense_date || new Date().toISOString().split('T')[0];
    
    const { expenses } = require('../db/procedures');
    const result = await expenses.add(amount, category, description, staffId, dateToUse);
    
    res.json({ success: true, message: 'Expense logged successfully', id: result.id });
  } catch (err) {
    console.error('addExpense error:', err);
    res.status(500).json({ message: err.message || 'Failed to log expense.' });
  }
}

async function deleteExpense(req, res) {
  try {
    const { id } = req.params;
    const pool = require('../config/db');
    const [result] = await pool.query('DELETE FROM expenses WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Expense record not found.' });
    }
    
    res.json({ success: true, message: 'Expense deleted successfully.' });
  } catch (err) {
    console.error('deleteExpense error:', err);
    res.status(500).json({ message: err.message || 'Failed to delete expense.' });
  }
}

module.exports = {
  getEODReport,
  addExpense,
  deleteExpense,
};

