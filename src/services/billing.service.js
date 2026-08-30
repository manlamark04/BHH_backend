const pool = require('../config/db');
const { getUniqueReceiptNumber } = require('../utils/receipt.util');

function formatActivityHours(startVal, endVal) {
  if (!startVal || !endVal) return '1 hr Match Play';
  try {
    const start = new Date(startVal);
    const end = new Date(endVal);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '1 hr Match Play';
    const diffHours = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60)));
    const startStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const endStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${startStr} → ${endStr} (${diffHours} hr${diffHours > 1 ? 's' : ''})`;
  } catch (_) {
    return '1 hr Match Play';
  }
}

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
        b.booking_id,
        b.activity_rental_id,
        b.motor_rental_id,
        b.total_amount,
        b.paid_amount,
        b.status,
        b.cancellation_fee,
        b.receipt_number,
        b.issued_by,
        b.issued_at,
        u.full_name AS customer_name,
        u.username AS customer_username,
        u.unique_id AS customer_code,
        u.email AS customer_email,
        u.phone AS customer_phone,
        su.full_name AS staff_name,
        bk.status AS booking_status,
        bk.room_id,
        bk.booking_type,
        bk.check_in_time,
        bk.duration_hours,
        bk.check_in,
        bk.check_out,
        bk.cancellation_fee AS booking_cancellation_fee,
        r.room_number,
        r.room_type,
        ar.status AS activity_status,
        a.name AS activity_name,
        ar.start_time AS activity_start_time,
        ar.end_time AS activity_end_time,
        mr.status AS motor_status,
        mr.rental_id AS motor_rental_code,
        bli.line_items_summary
      FROM bills b
      LEFT JOIN users u ON u.id = b.customer_id
      LEFT JOIN users su ON su.id = b.issued_by
      LEFT JOIN bookings bk ON bk.id = b.booking_id
      LEFT JOIN rooms r ON r.id = bk.room_id
      LEFT JOIN activity_rentals ar ON ar.id = b.activity_rental_id
      LEFT JOIN activities a ON a.id = ar.activity_id
      LEFT JOIN motor_rentals mr ON mr.id = b.motor_rental_id
      LEFT JOIN (
        SELECT bill_id, GROUP_CONCAT(description SEPARATOR ' | ') AS line_items_summary
        FROM bill_line_items
        GROUP BY bill_id
      ) bli ON bli.bill_id = b.id
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
        p.receipt_number,
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
        receipt_number: p.receipt_number || '—',
        is_refunded: isRefunded,
      });
    }

    const currentYear = new Date().getFullYear();

    const formattedBills = bills.map((b) => {
      const billPayments = paymentsByBill[b.id] || [];
      const validPayments = billPayments.filter((p) => !p.is_refunded);
      const computedPaid = validPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalAmount = Number(b.total_amount || 0);

      const isCancelledBooking = ['cancelled', 'rejected'].includes(String(b.booking_status || '').toLowerCase());
      const isCancelledActivity = ['cancelled', 'rejected'].includes(String(b.activity_status || '').toLowerCase());
      const isCancelledMotor = ['cancelled', 'rejected'].includes(String(b.motor_status || '').toLowerCase());
      const isCancelledBill = ['cancelled', 'void'].includes(String(b.status || '').toLowerCase());
      const isCancelled = isCancelledBooking || isCancelledActivity || isCancelledMotor || isCancelledBill;

      const cancellationFee = Number(b.cancellation_fee ?? b.booking_cancellation_fee ?? 0);
      let remainingBalance = 0;
      let status = String(b.status || '').toUpperCase();

      if (isCancelled) {
        status = 'CANCELLED';
        if (cancellationFee > 0) {
          remainingBalance = Math.max(0, cancellationFee - computedPaid);
        } else {
          remainingBalance = 0;
        }
      } else if (computedPaid >= totalAmount && totalAmount > 0) {
        status = 'PAID';
        remainingBalance = 0;
      } else if (computedPaid > 0) {
        status = 'PARTIALLY PAID';
        remainingBalance = Math.max(0, totalAmount - computedPaid);
      } else if (billPayments.some((p) => p.is_refunded) && computedPaid === 0) {
        status = 'REFUNDED';
        remainingBalance = 0;
      } else {
        status = 'PENDING';
        remainingBalance = Math.max(0, totalAmount - computedPaid);
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

      // Determine service type and description
      let serviceType = 'General / Walk-in';
      let serviceName = 'Hotel Service / Miscellaneous';
      let serviceDetails = 'Standard Charge';

      if (b.booking_id) {
        serviceType = 'Room Booking';
        serviceName = b.room_type ? `${b.room_type}` : 'Room Accommodation';
        if (b.booking_type === 'short_time') {
          serviceDetails = `Room ${b.room_number || ''} · Short Time (${b.duration_hours || 3} Hours / Per Hour)`;
        } else {
          const nights = Math.max(1, Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / (1000 * 60 * 60 * 24))) || 1;
          serviceDetails = `Room ${b.room_number || ''} · Per Night (${nights} ${nights === 1 ? 'Night' : 'Nights'})`;
        }
      } else if (b.activity_rental_id || (b.activity_name && String(b.activity_name).toLowerCase().includes('pickleball'))) {
        serviceType = 'Pickleball Court';
        serviceName = b.activity_name || 'Pickleball Court Reservation';
        serviceDetails = formatActivityHours(b.activity_start_time, b.activity_end_time);
      } else if (b.line_items_summary && (b.line_items_summary.includes('Motor') || b.line_items_summary.includes('Yamaha') || b.line_items_summary.includes('Honda') || b.line_items_summary.includes('Plate'))) {
        serviceType = 'Motor Rental';
        serviceName = b.line_items_summary.split('-')[0]?.replace('Motor Rental:', '')?.trim() || 'Motorcycle Rental';
        serviceDetails = b.line_items_summary.split('-')[1]?.trim() || 'Motor Rent Availment';
      } else if (b.bill_number && b.bill_number.startsWith('BILL-MTR')) {
        serviceType = 'Motor Rental';
        serviceName = 'Motorcycle Rental';
        serviceDetails = 'Motor Rent Availment';
      } else if (b.line_items_summary) {
        serviceType = 'Service Charge';
        serviceName = b.line_items_summary;
      }

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
        booking_type: b.booking_type,
        check_in_time: b.check_in_time,
        duration_hours: b.duration_hours,
        room_number: b.room_number,
        room_type: b.room_type,
        check_in: b.check_in,
        check_out: b.check_out,
        activity_rental_id: b.activity_rental_id,
        activity_name: b.activity_name,
        service_type: serviceType,
        service_name: serviceName,
        service_details: serviceDetails,
        line_items_summary: b.line_items_summary,
        total_amount: totalAmount,
        paid_amount: computedPaid,
        remaining_balance: remainingBalance,
        balance: remainingBalance,
        status: status,
        payment_status: status,
        method: method,
        issued_by_name: b.staff_name || 'System Administrator',
        issued_at: b.issued_at,
        receipt_number: validPayments.length > 0 ? (validPayments[0].receipt_number || '—') : (b.receipt_number || '—'),
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
        (b.method && b.method.toLowerCase().includes(q)) ||
        (b.receipt_number && b.receipt_number.toLowerCase().includes(q))
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
        b.customer_id,
        b.booking_id,
        b.activity_rental_id,
        b.motor_rental_id,
        b.total_amount,
        b.paid_amount,
        b.cancellation_fee,
        b.receipt_number,
        b.status,
        b.issued_at,
        u.full_name AS customer_name,
        u.unique_id AS customer_code,
        u.email AS customer_email,
        u.phone AS customer_phone,
        bk.status AS booking_status,
        bk.booking_type,
        bk.check_in_time,
        bk.duration_hours,
        bk.check_in,
        bk.check_out,
        bk.cancellation_fee AS booking_cancellation_fee,
        r.room_number,
        r.room_type,
        a.name AS activity_name,
        ar.status AS activity_status,
        ar.start_time AS activity_start_time,
        ar.end_time AS activity_end_time,
        mr.status AS motor_status,
        items.line_items_summary
      FROM bills b
      LEFT JOIN users u ON u.id = b.customer_id
      LEFT JOIN bookings bk ON bk.id = b.booking_id
      LEFT JOIN rooms r ON r.id = bk.room_id
      LEFT JOIN activity_rentals ar ON ar.id = b.activity_rental_id
      LEFT JOIN activities a ON a.id = ar.activity_id
      LEFT JOIN motor_rentals mr ON mr.id = b.motor_rental_id
      LEFT JOIN (
        SELECT bill_id, GROUP_CONCAT(CONCAT(description, ' (x', quantity, ')') SEPARATOR ', ') AS line_items_summary
        FROM bill_line_items
        GROUP BY bill_id
      ) items ON items.bill_id = b.id
      WHERE b.customer_id = ?
      ORDER BY b.issued_at DESC
    `, [customerId]);

    if (bills.length === 0) {
      return res.json([]);
    }

    const billIds = bills.map((b) => b.id);
    const [paymentsRows] = await pool.query(`
      SELECT p.bill_id, p.amount, p.method, p.notes, p.receipt_number, p.paid_at, p.id
      FROM payments p
      WHERE p.bill_id IN (?)
      ORDER BY p.paid_at DESC
    `, [billIds]);

    const paymentsByBill = {};
    for (const p of paymentsRows) {
      if (!paymentsByBill[p.bill_id]) paymentsByBill[p.bill_id] = [];
      const isRefunded = String(p.notes || '').includes('[REFUNDED');
      paymentsByBill[p.bill_id].push({
        ...p,
        txn_number: `TXN-${new Date(p.paid_at || Date.now()).getFullYear()}-${String(p.id).padStart(6, '0')}`,
        receipt_number: p.receipt_number || '—',
        is_refunded: isRefunded,
      });
    }

    const currentYear = new Date().getFullYear();

    const formattedBills = bills.map((b) => {
      const billPayments = paymentsByBill[b.id] || [];
      const validPayments = billPayments.filter((p) => !p.is_refunded);
      const computedPaid = validPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalAmount = Number(b.total_amount || 0);

      const isCancelledBooking = ['cancelled', 'rejected'].includes(String(b.booking_status || '').toLowerCase());
      const isCancelledActivity = ['cancelled', 'rejected'].includes(String(b.activity_status || '').toLowerCase());
      const isCancelledMotor = ['cancelled', 'rejected'].includes(String(b.motor_status || '').toLowerCase());
      const isCancelledBill = ['cancelled', 'void'].includes(String(b.status || '').toLowerCase());
      const isCancelled = isCancelledBooking || isCancelledActivity || isCancelledMotor || isCancelledBill;

      const cancellationFee = Number(b.cancellation_fee ?? b.booking_cancellation_fee ?? 0);
      let remainingBalance = 0;
      let status = String(b.status || '').toUpperCase();

      if (isCancelled) {
        status = 'CANCELLED';
        if (cancellationFee > 0) {
          remainingBalance = Math.max(0, cancellationFee - computedPaid);
        } else {
          remainingBalance = 0;
        }
      } else if (computedPaid >= totalAmount && totalAmount > 0) {
        status = 'PAID';
        remainingBalance = 0;
      } else if (computedPaid > 0) {
        status = 'PARTIALLY PAID';
        remainingBalance = Math.max(0, totalAmount - computedPaid);
      } else if (billPayments.some((p) => p.is_refunded) && computedPaid === 0) {
        status = 'REFUNDED';
        remainingBalance = 0;
      } else {
        status = 'UNPAID';
        remainingBalance = Math.max(0, totalAmount - computedPaid);
      }

      const invoiceNumber = b.bill_number && b.bill_number.startsWith('INV-')
        ? b.bill_number
        : (b.bill_number ? b.bill_number : `INV-${new Date(b.issued_at || Date.now()).getFullYear()}-${String(b.id).padStart(4, '0')}`);

      const bookingRef = b.booking_id ? `BK-${currentYear}-${String(b.booking_id).padStart(4, '0')}` : null;
      const latestPayment = billPayments[0];
      const method = latestPayment ? latestPayment.method : '—';

      let serviceType = 'Room Booking';
      let serviceName = b.room_type || 'Room Accommodation';
      let serviceDetails = b.room_number ? `Room ${b.room_number}` : 'Direct Service';

      if (b.booking_id) {
        serviceType = 'Room Booking';
        serviceName = b.room_type || 'Room Accommodation';
        if (b.booking_type === 'short_time') {
          serviceDetails = `Room ${b.room_number || ''} · Short Time (${b.duration_hours || 3} Hours / Per Hour)`;
        } else {
          const nights = Math.max(1, Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / (1000 * 60 * 60 * 24))) || 1;
          serviceDetails = `Room ${b.room_number || ''} · Per Night (${nights} ${nights === 1 ? 'Night' : 'Nights'})`;
        }
      } else if (b.activity_rental_id || (b.activity_name && String(b.activity_name).toLowerCase().includes('pickleball'))) {
        serviceType = 'Pickleball Court';
        serviceName = b.activity_name || 'Pickleball Court Reservation';
        serviceDetails = formatActivityHours(b.activity_start_time, b.activity_end_time);
      } else if (b.line_items_summary && (b.line_items_summary.includes('Motor') || b.line_items_summary.includes('Yamaha') || b.line_items_summary.includes('Honda') || b.line_items_summary.includes('Plate'))) {
        serviceType = 'Motor Rental';
        serviceName = b.line_items_summary.split('-')[0]?.replace('Motor Rental:', '')?.trim() || 'Motorcycle Rental';
        serviceDetails = b.line_items_summary.split('-')[1]?.trim() || 'Motor Rent Availment';
      } else if (b.bill_number && b.bill_number.startsWith('BILL-MTR')) {
        serviceType = 'Motor Rental';
        serviceName = 'Motorcycle Rental';
        serviceDetails = 'Motor Rent Availment';
      } else if (b.line_items_summary) {
        serviceType = 'Service Charge';
        serviceName = b.line_items_summary;
        serviceDetails = 'Service Availment';
      }

      return {
        id: b.id,
        invoice_number: invoiceNumber,
        bill_number: b.bill_number,
        customer_id: b.customer_id,
        booking_id: b.booking_id,
        booking_ref: bookingRef,
        booking_type: b.booking_type,
        check_in_time: b.check_in_time,
        duration_hours: b.duration_hours,
        room_number: b.room_number,
        room_type: serviceName,
        service_type: serviceType,
        service_name: serviceName,
        service_details: serviceDetails,
        total_amount: totalAmount,
        cancellation_fee: cancellationFee,
        is_cancelled: isCancelled,
        paid_amount: computedPaid,
        amount_paid: computedPaid,
        remaining_balance: remainingBalance,
        balance: remainingBalance,
        status: status,
        payment_status: status,
        method: method,
        receipt_number: validPayments.length > 0 ? (validPayments[0].receipt_number || '—') : (b.receipt_number || '—'),
        issued_at: b.issued_at,
        created_at: b.issued_at,
        payments: billPayments,
      };
    });

    res.json(formattedBills);
  } catch (err) {
    console.error('getMyBills error:', err);
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
        p.receipt_number,
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
    const MAX_PAYMENT_CAP = 1000000;
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than zero.' });
    }
    if (numAmount > MAX_PAYMENT_CAP) {
      return res.status(400).json({ message: 'Payment amount cannot exceed ₱1,000,000.00 per transaction.' });
    }

    let targetBillId = bill_id ? parseInt(bill_id) : null;
    if (!targetBillId && booking_id) {
      const [bkBill] = await pool.query('SELECT id FROM bills WHERE booking_id = ? ORDER BY id DESC LIMIT 1', [booking_id]);
      if (bkBill.length > 0) targetBillId = bkBill[0].id;
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

    // Generate guaranteed unique 6-char LLLDDD Official Receipt Number (e.g. OR-KJD482)
    const receiptNumber = await getUniqueReceiptNumber(pool);

    const [insertResult] = await pool.query(`
      INSERT INTO payments (bill_id, amount, method, received_by, notes, receipt_number, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [targetBillId, numAmount, normMethod, req.user.id, fullNotes || null, receiptNumber]);

    const newPaymentId = insertResult.insertId;
    const newTotalPaid = previousPaid + numAmount;
    const newRemaining = Math.max(0, totalAmount - newTotalPaid);
    const newStatus = newTotalPaid >= totalAmount ? 'paid' : (newTotalPaid > 0 ? 'partially_paid' : 'unpaid');

    // Persist paid amount, status, and receipt number to bills table
    try {
      await pool.query('UPDATE bills SET paid_amount = ?, status = ?, receipt_number = ?, updated_at = NOW() WHERE id = ?', [
        newTotalPaid,
        newStatus,
        receiptNumber,
        targetBillId,
      ]);
    } catch (billUpdateErr) {
      console.warn('Bill update warning:', billUpdateErr.message);
    }

    // Automatic check-in / start match promotion for room bookings and activity rentals
    try {
      if (bill.booking_id) {
        await pool.query("UPDATE bookings SET status = 'checked_in', updated_at = NOW() WHERE id = ?", [bill.booking_id]);
        const [bkRows] = await pool.query("SELECT room_id FROM bookings WHERE id = ?", [bill.booking_id]);
        if (bkRows.length > 0 && bkRows[0].room_id) {
          await pool.query("UPDATE rooms SET status = 'occupied', updated_at = NOW() WHERE id = ?", [bkRows[0].room_id]);
        }
      } else if (bill.activity_rental_id) {
        await pool.query("UPDATE activity_rentals SET status = 'active', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ?", [req.user.id || null, bill.activity_rental_id]);
      } else if (bill.bill_number && (bill.bill_number.includes('BILL-ACT') || bill.bill_number.includes('AR-'))) {
        const [actRows] = await pool.query("SELECT id FROM activity_rentals WHERE customer_id = ? AND status IN ('pending_payment', 'pending_approval', 'pending', 'confirmed', 'approved') ORDER BY id DESC LIMIT 1", [bill.customer_id]);
        if (actRows.length > 0) {
          await pool.query("UPDATE activity_rentals SET status = 'active', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ?", [req.user.id || null, actRows[0].id]);
        }
      } else if (bill.customer_id) {
        const [activeBkRows] = await pool.query(
          "SELECT id, room_id FROM bookings WHERE customer_id = ? AND status IN ('confirmed', 'pending', 'pending_approval', 'requested') AND DATE(check_in) <= CURDATE() AND DATE(check_out) >= CURDATE() ORDER BY id DESC LIMIT 1",
          [bill.customer_id]
        );
        if (activeBkRows.length > 0) {
          await pool.query("UPDATE bookings SET status = 'checked_in', updated_at = NOW() WHERE id = ?", [activeBkRows[0].id]);
          if (activeBkRows[0].room_id) {
            await pool.query("UPDATE rooms SET status = 'occupied', updated_at = NOW() WHERE id = ?", [activeBkRows[0].room_id]);
          }
        }
      }
    } catch (checkInErr) {
      console.warn('Auto check-in / start match warning:', checkInErr.message);
    }

    // Trigger request lifecycle state machine promotion if gate is satisfied
    try {
      const requestLifecycle = require('./request-lifecycle.service');
      const payMeta = { userId: req.user.id, userName: req.user.full_name || req.user.username };

      if (bill.booking_id) {
        await requestLifecycle.handlePaymentReceived('booking', bill.booking_id, payMeta);
      } else if (bill.activity_rental_id) {
        await requestLifecycle.handlePaymentReceived('activity_rental', bill.activity_rental_id, payMeta);
      } else if (bill.bill_number && bill.bill_number.includes('MTR-')) {
        const [mrRows] = await pool.query('SELECT id FROM motor_rentals WHERE rental_id LIKE ? OR id = ?', [
          `%${bill.bill_number.replace('BILL-', '')}%`,
          bill.customer_id
        ]);
        if (mrRows.length > 0) {
          await requestLifecycle.handlePaymentReceived('motor_rental', mrRows[0].id, payMeta);
        }
      }
    } catch (lcErr) {
      console.warn('Lifecycle transition check warning:', lcErr.message);
    }

    let customerName = 'Guest';
    let customerEmail = undefined;
    let customerPhone = undefined;

    if (bill.customer_id) {
      try {
        const [custRows] = await pool.query('SELECT full_name, email, phone FROM users WHERE id = ?', [bill.customer_id]);
        if (custRows.length > 0) {
          customerName = custRows[0].full_name || 'Guest';
          customerEmail = custRows[0].email;
          customerPhone = custRows[0].phone;
        }
      } catch (_) {}
    }

    const staffName = req.user.full_name || req.user.username || 'Front Desk Staff';
    const invoiceNumber = bill.bill_number && bill.bill_number.startsWith('INV-')
      ? bill.bill_number
      : (bill.bill_number ? bill.bill_number : `INV-${new Date(bill.issued_at || Date.now()).getFullYear()}-${String(bill.id).padStart(4, '0')}`);

    res.status(201).json({
      message: 'Payment successfully recorded.',
      payment_id: newPaymentId,
      receipt_number: receiptNumber,
      total_paid: newTotalPaid,
      remaining_balance: newRemaining,
      status: newStatus.toUpperCase(),
      receipt_data: {
        receipt_number: receiptNumber,
        invoice_number: invoiceNumber,
        bill_id: targetBillId,
        payment_id: newPaymentId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        total_amount: totalAmount,
        previous_paid: previousPaid,
        amount_paid: numAmount,
        remaining_balance: newRemaining,
        status: newStatus.toUpperCase(),
        method: normMethod,
        ref_number: ref_number || undefined,
        notes: notes || undefined,
        staff_name: staffName,
        paid_at: new Date().toISOString(),
      }
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

    const [bRows] = await pool.query('SELECT * FROM bills WHERE id = ?', [billId]);
    const bill = bRows[0];
    const totalAmount = Number(bill?.total_amount || 0);

    let newStatus = 'unpaid';
    if (newTotalPaid >= totalAmount && totalAmount > 0) newStatus = 'paid';
    else if (newTotalPaid > 0) newStatus = 'partially_paid';

    await pool.query('UPDATE bills SET paid_amount = ?, status = ?, updated_at = NOW() WHERE id = ?', [newTotalPaid, newStatus, billId]);

    // Reversal Check: If request was in pending_approval and now no longer meets deposit, revert to pending_payment
    try {
      const requestLifecycle = require('./request-lifecycle.service');
      if (bill.booking_id) {
        const gate = await requestLifecycle.checkPaymentGate('booking', bill.booking_id);
        if (!gate.isPaid && String(gate.currentStatus).toLowerCase() === 'pending_approval') {
          await pool.query("UPDATE bookings SET status = 'pending_payment', updated_at = NOW() WHERE id = ?", [bill.booking_id]);
          await requestLifecycle.logAudit(pool, {
            entityType: 'booking',
            entityId: bill.booking_id,
            fromStatus: 'pending_approval',
            toStatus: 'pending_payment',
            performedBy: req.user.id,
            performedByName: req.user.full_name,
            triggerType: 'system',
            reason: `Payment refunded/reversed. Dropped below deposit threshold. Reverted to Pending Payment.`,
          });
        }
      } else if (bill.activity_rental_id) {
        const gate = await requestLifecycle.checkPaymentGate('activity_rental', bill.activity_rental_id);
        if (!gate.isPaid && String(gate.currentStatus).toLowerCase() === 'pending_approval') {
          await pool.query("UPDATE activity_rentals SET status = 'pending_payment', updated_at = NOW() WHERE id = ?", [bill.activity_rental_id]);
          await requestLifecycle.logAudit(pool, {
            entityType: 'activity_rental',
            entityId: bill.activity_rental_id,
            fromStatus: 'pending_approval',
            toStatus: 'pending_payment',
            performedBy: req.user.id,
            performedByName: req.user.full_name,
            triggerType: 'system',
            reason: `Payment refunded/reversed. Dropped below deposit threshold. Reverted to Pending Payment.`,
          });
        }
      }
    } catch (revErr) {
      console.warn('Reversal handling error:', revErr.message);
    }

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

/**
 * POST /api/bills/:id/cancel — Staff/Admin: cancel an unpaid bill and release inventory
 */
async function cancelBill(req, res) {
  try {
    const billId = parseInt(req.params.id);
    const { reason } = req.body;

    const [bRows] = await pool.query('SELECT * FROM bills WHERE id = ?', [billId]);
    if (bRows.length === 0) return res.status(404).json({ message: 'Bill not found.' });
    const bill = bRows[0];

    await pool.query("UPDATE bills SET status = 'cancelled', updated_at = NOW() WHERE id = ?", [billId]);

    // If associated with a booking
    if (bill.booking_id) {
      await pool.query("UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = ?", [bill.booking_id]);
    }

    // If associated with an activity rental (pickleball court)
    if (bill.activity_rental_id) {
      await pool.query("UPDATE activity_rentals SET status = 'cancelled', updated_at = NOW() WHERE id = ?", [bill.activity_rental_id]);
    }

    // If associated with motor rental (e.g. BILL-MTR-xxx)
    if (bill.bill_number && bill.bill_number.startsWith('BILL-MTR')) {
      const [mrRows] = await pool.query("SELECT * FROM motor_rentals WHERE customer_id = ? AND status IN ('PENDING_PAYMENT', 'PENDING_APPROVAL', 'REQUESTED') ORDER BY id DESC LIMIT 1", [bill.customer_id]);
      if (mrRows.length > 0) {
        await pool.query("UPDATE motor_rentals SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?", [mrRows[0].id]);
        await pool.query("UPDATE motorcycles SET status = 'AVAILABLE' WHERE id = ?", [mrRows[0].motor_id]);
      }
    }

    res.json({ message: `Invoice #${bill.bill_number || billId} has been cancelled successfully.` });
  } catch (err) {
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
  cancelBill,
};
