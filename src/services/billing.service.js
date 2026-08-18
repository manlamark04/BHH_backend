const pool = require('../config/db');

/**
 * GET /api/bills — Staff/Admin
 * Returns all bills / invoices enriched with guest details, room info, and transaction breakdown.
 */
async function getAllBills(req, res) {
  try {
    const { status, search } = req.query;

    const [bills] = await pool.query(`
      SELECT 
        b.id,
        b.bill_number,
        b.customer_id,
        u.full_name AS customer_name,
        u.unique_id AS customer_code,
        u.email AS customer_email,
        u.phone AS customer_phone,
        b.booking_id,
        bk.status AS booking_status,
        bk.check_in,
        bk.check_out,
        r.room_number,
        r.room_type,
        b.activity_rental_id,
        b.total_amount,
        b.paid_amount,
        b.status,
        b.issued_by,
        s.full_name AS staff_name,
        b.issued_at
      FROM bills b
      JOIN users u ON u.id = b.customer_id
      LEFT JOIN users s ON s.id = b.issued_by
      LEFT JOIN bookings bk ON bk.id = b.booking_id
      LEFT JOIN rooms r ON r.id = bk.room_id
      ORDER BY b.issued_at DESC, b.id DESC
    `);

    // Fetch all payments for all bills
    const [payments] = await pool.query(`
      SELECT 
        p.id,
        p.bill_id,
        p.amount,
        p.method,
        p.received_by,
        pu.full_name AS staff_name,
        p.notes,
        p.paid_at
      FROM payments p
      LEFT JOIN users pu ON pu.id = p.received_by
      ORDER BY p.paid_at DESC, p.id DESC
    `);

    // Group payments by bill_id
    const paymentsByBill = {};
    for (const p of payments) {
      if (!paymentsByBill[p.bill_id]) paymentsByBill[p.bill_id] = [];
      const isRefunded = String(p.notes || '').includes('[REFUNDED');
      paymentsByBill[p.bill_id].push({
        ...p,
        txn_number: `TXN-${new Date(p.paid_at || Date.now()).getFullYear()}-${String(p.id).padStart(6, '0')}`,
        is_refunded: isRefunded,
      });
    }

    const currentYear = new Date().getFullYear();

    const formattedBills = bills.map((b) => {
      const billPayments = paymentsByBill[b.id] || [];
      const validPayments = billPayments.filter((p) => !p.is_refunded);
      const computedPaid = validPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalAmount = Number(b.total_amount || 0);
      const remainingBalance = Math.max(0, totalAmount - computedPaid);

      let status = String(b.status || '').toUpperCase();
      if (computedPaid >= totalAmount && totalAmount > 0) {
        status = 'PAID';
      } else if (computedPaid > 0) {
        status = 'PARTIALLY PAID';
      } else if (billPayments.some((p) => p.is_refunded) && computedPaid === 0) {
        status = 'REFUNDED';
      } else {
        status = 'PENDING';
      }

      // Invoice number format INV-YYYY-XXXX
      const invoiceNumber = b.bill_number && b.bill_number.startsWith('INV-')
        ? b.bill_number
        : `INV-${new Date(b.issued_at || Date.now()).getFullYear()}-${String(b.id).padStart(4, '0')}`;

      // Booking ref format BK-YYYY-XXXX
      const bookingRef = b.booking_id ? `BK-${currentYear}-${String(b.booking_id).padStart(4, '0')}` : null;

      // Method used
      const latestPayment = billPayments[0];
      const method = latestPayment ? latestPayment.method : '—';

      return {
        id: b.id,
        invoice_number: invoiceNumber,
        bill_number: b.bill_number,
        customer_id: b.customer_id,
        customer_name: b.customer_name,
        customer_code: b.customer_code,
        customer_email: b.customer_email,
        customer_phone: b.customer_phone,
        booking_id: b.booking_id,
        booking_ref: bookingRef,
        booking_status: b.booking_status,
        room_number: b.room_number,
        room_type: b.room_type,
        check_in: b.check_in,
        check_out: b.check_out,
        activity_rental_id: b.activity_rental_id,
        total_amount: totalAmount,
        paid_amount: computedPaid,
        remaining_balance: remainingBalance,
        status: status,
        method: method,
        issued_by_name: b.staff_name || 'System Administrator',
        issued_at: b.issued_at,
        payments: billPayments,
      };
    });

    // Optional status or search filter
    let results = formattedBills;
    if (status && status !== 'All') {
      results = results.filter((b) => b.status.toLowerCase() === status.toLowerCase());
    }
    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      results = results.filter((b) =>
        b.invoice_number.toLowerCase().includes(q) ||
        (b.booking_ref && b.booking_ref.toLowerCase().includes(q)) ||
        (b.customer_name && b.customer_name.toLowerCase().includes(q)) ||
        (b.customer_code && b.customer_code.toLowerCase().includes(q)) ||
        (b.room_number && b.room_number.toLowerCase().includes(q)) ||
        (b.method && b.method.toLowerCase().includes(q))
      );
    }

    res.json(results);
  } catch (err) {
    console.error('getAllBills error:', err);
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bills/my — Customer: own bills (transaction history) */
async function getMyBills(req, res) {
  try {
    const customerId = req.user.id;
    const [bills] = await pool.query(`
      SELECT 
        b.id,
        b.bill_number,
        b.total_amount,
        b.paid_amount,
        b.status,
        b.issued_at,
        bk.id AS booking_id,
        r.room_number,
        r.room_type
      FROM bills b
      LEFT JOIN bookings bk ON bk.id = b.booking_id
      LEFT JOIN rooms r ON r.id = bk.room_id
      WHERE b.customer_id = ?
      ORDER BY b.issued_at DESC
    `, [customerId]);

    res.json(bills);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bills/:id/items — line items */
async function getBillLineItems(req, res) {
  try {
    const [items] = await pool.query('SELECT * FROM bill_line_items WHERE bill_id = ? ORDER BY id', [parseInt(req.params.id)]);
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** GET /api/bills/:id/payments — payment history for a bill */
async function getBillPayments(req, res) {
  try {
    const [payments] = await pool.query(`
      SELECT 
        p.id,
        p.bill_id,
        p.amount,
        p.method,
        p.received_by,
        u.full_name AS staff_name,
        p.notes,
        p.paid_at
      FROM payments p
      LEFT JOIN users u ON u.id = p.received_by
      WHERE p.bill_id = ?
      ORDER BY p.paid_at DESC
    `, [parseInt(req.params.id)]);

    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/**
 * POST /api/bills — Staff/Admin: generate a bill
 */
async function generateBill(req, res) {
  try {
    const { customer_id, booking_id, activity_rental_id, line_items } = req.body;
    if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
      return res.status(400).json({ message: 'At least one line item is required.' });
    }

    const totalAmount = line_items.reduce((sum, it) => sum + (Number(it.quantity || 1) * Number(it.unit_price || 0)), 0);
    const currentYear = new Date().getFullYear();
    const billNumber = `INV-${currentYear}-${Date.now().toString().slice(-4)}`;

    const [newBill] = await pool.query(`
      INSERT INTO bills (bill_number, customer_id, booking_id, activity_rental_id, total_amount, paid_amount, status, issued_by, issued_at)
      VALUES (?, ?, ?, ?, ?, 0, 'unpaid', ?, NOW())
    `, [billNumber, customer_id, booking_id || null, activity_rental_id || null, totalAmount, req.user.id]);

    const billId = newBill.insertId;

    for (const item of line_items) {
      await pool.query(`
        INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
        VALUES (?, ?, ?, ?)
      `, [billId, item.description, item.quantity || 1, item.unit_price]);
    }

    res.status(201).json({ id: billId, bill_number: billNumber, total_amount: totalAmount });
  } catch (err) {
    console.error('generateBill error:', err);
    res.status(500).json({ message: err.message });
  }
}

/**
 * POST /api/bills/payments (or /api/payments) — Record payment
 * Body: { bill_id, booking_id?, amount, method, notes?, ref_number? }
 */
async function recordPayment(req, res) {
  try {
    const { bill_id, booking_id, amount, method, notes, ref_number } = req.body;
    const numAmount = parseFloat(amount);

    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than zero.' });
    }

    let targetBillId = bill_id;

    // If booking_id provided without bill_id, find or generate bill
    if (!targetBillId && booking_id) {
      const [existingBills] = await pool.query('SELECT * FROM bills WHERE booking_id = ?', [booking_id]);
      if (existingBills.length > 0) {
        targetBillId = existingBills[0].id;
      } else {
        // Calculate booking total
        const [bkRows] = await pool.query('SELECT * FROM bookings WHERE id = ?', [booking_id]);
        if (bkRows.length === 0) return res.status(404).json({ message: 'Booking not found.' });
        const bk = bkRows[0];
        const [rmRows] = await pool.query('SELECT rate_per_night FROM rooms WHERE id = ?', [bk.room_id]);
        const nights = Math.max(1, Math.ceil((new Date(bk.check_out) - new Date(bk.check_in)) / (1000 * 60 * 60 * 24)));
        const total = Number(rmRows[0]?.rate_per_night || 0) * nights;

        const currentYear = new Date().getFullYear();
        const billNumber = `INV-${currentYear}-${String(booking_id).padStart(4, '0')}`;

        const [createdBill] = await pool.query(`
          INSERT INTO bills (bill_number, customer_id, booking_id, total_amount, paid_amount, status, issued_by, issued_at)
          VALUES (?, ?, ?, ?, 0, 'unpaid', ?, NOW())
        `, [billNumber, bk.customer_id, booking_id, total, req.user.id]);
        targetBillId = createdBill.insertId;
      }
    }

    if (!targetBillId) {
      return res.status(400).json({ message: 'Bill or Booking ID is required.' });
    }

    const [bRows] = await pool.query('SELECT * FROM bills WHERE id = ?', [targetBillId]);
    if (bRows.length === 0) return res.status(404).json({ message: 'Bill not found.' });
    const bill = bRows[0];

    // Compute previous valid payments
    const [paidRows] = await pool.query("SELECT SUM(amount) AS total_paid FROM payments WHERE bill_id = ? AND notes NOT LIKE '%[REFUNDED%'", [targetBillId]);
    const previousPaid = Number(paidRows[0]?.total_paid || 0);
    const totalAmount = Number(bill.total_amount || 0);
    const remainingBalance = Math.max(0, totalAmount - previousPaid);

    if (numAmount > remainingBalance + 0.01 && totalAmount > 0) {
      return res.status(400).json({
        message: `Payment amount (₱${numAmount.toLocaleString()}) exceeds remaining balance of ₱${remainingBalance.toLocaleString()}.`
      });
    }

    const validMethods = ['cash', 'card', 'ewallet', 'bank_transfer', 'gcash', 'maya', 'corporate', 'other'];
    const normMethod = validMethods.includes(String(method).toLowerCase()) ? String(method).toLowerCase() : 'cash';

    const fullNotes = [ref_number ? `Ref: ${ref_number}` : '', notes || ''].filter(Boolean).join(' · ');

    const [insertResult] = await pool.query(`
      INSERT INTO payments (bill_id, amount, method, received_by, notes, paid_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [targetBillId, numAmount, normMethod, req.user.id, fullNotes || null]);

    const newPaymentId = insertResult.insertId;
    const newTotalPaid = previousPaid + numAmount;
    const newRemaining = Math.max(0, totalAmount - newTotalPaid);
    const newStatus = newTotalPaid >= totalAmount ? 'paid' : (newTotalPaid > 0 ? 'partially_paid' : 'unpaid');

    await pool.query('UPDATE bills SET paid_amount = ?, status = ? WHERE id = ?', [newTotalPaid, newStatus, targetBillId]);

    // Audit trail
    try {
      await pool.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
        VALUES (?, 'RECORD_PAYMENT', 'payments', ?, '127.0.0.1', NOW())
      `, [req.user.id, newPaymentId]);
    } catch (_) {}

    res.status(201).json({
      message: 'Payment successfully recorded.',
      payment_id: newPaymentId,
      txn_number: `TXN-${new Date().getFullYear()}-${String(newPaymentId).padStart(6, '0')}`,
      total_paid: newTotalPaid,
      remaining_balance: newRemaining,
      status: newStatus.toUpperCase(),
    });
  } catch (err) {
    console.error('recordPayment error:', err);
    res.status(500).json({ message: err.message });
  }
}

/**
 * POST /api/bills/payments/:id/refund — Refund a payment transaction
 */
async function refundPayment(req, res) {
  try {
    const paymentId = parseInt(req.params.id);
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Refund reason is required.' });
    }

    const [pRows] = await pool.query('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (pRows.length === 0) return res.status(404).json({ message: 'Payment record not found.' });
    const payment = pRows[0];

    if (String(payment.notes || '').includes('[REFUNDED')) {
      return res.status(400).json({ message: 'This payment has already been refunded.' });
    }

    const billId = payment.bill_id;
    const refundTag = `[REFUNDED: ${reason.trim()} by Admin on ${new Date().toISOString().split('T')[0]}]`;
    const updatedNotes = [payment.notes, refundTag].filter(Boolean).join(' ');

    await pool.query('UPDATE payments SET notes = ? WHERE id = ?', [updatedNotes, paymentId]);

    // Recalculate bill
    const [paidRows] = await pool.query("SELECT SUM(amount) AS total_paid FROM payments WHERE bill_id = ? AND notes NOT LIKE '%[REFUNDED%'", [billId]);
    const newTotalPaid = Number(paidRows[0]?.total_paid || 0);

    const [bRows] = await pool.query('SELECT total_amount FROM bills WHERE id = ?', [billId]);
    const totalAmount = Number(bRows[0]?.total_amount || 0);

    let newStatus = 'unpaid';
    if (newTotalPaid >= totalAmount && totalAmount > 0) newStatus = 'paid';
    else if (newTotalPaid > 0) newStatus = 'partially_paid';

    await pool.query('UPDATE bills SET paid_amount = ?, status = ? WHERE id = ?', [newTotalPaid, newStatus, billId]);

    // Audit log
    try {
      await pool.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
        VALUES (?, 'REFUND_PAYMENT', 'payments', ?, '127.0.0.1', NOW())
      `, [req.user.id, paymentId]);
    } catch (_) {}

    res.json({
      message: `Payment of ₱${Number(payment.amount).toLocaleString()} refunded successfully.`,
      refunded_amount: Number(payment.amount),
      new_total_paid: newTotalPaid,
      bill_status: newStatus.toUpperCase(),
    });
  } catch (err) {
    console.error('refundPayment error:', err);
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getAllBills,
  getMyBills,
  getBillLineItems,
  getBillPayments,
  generateBill,
  recordPayment,
  refundPayment,
};
