const pool = require('../config/db');
const { getUniqueReceiptNumber } = require('../utils/receipt.util');
const { notifyStaffAndAdmin, notifyUser } = require('./notification.emitter');
const requestLifecycle = require('./request-lifecycle.service');

let tableChecked = false;
async function ensureGuestServicesTable() {
  if (tableChecked) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guest_service_availments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        booking_id INT NOT NULL,
        customer_id INT NOT NULL,
        service_id INT NULL,
        service_name VARCHAR(150) NOT NULL,
        quantity DECIMAL(10,2) NOT NULL DEFAULT 1.00,
        unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        payment_type ENUM('pay_now', 'charge_to_room') NOT NULL DEFAULT 'charge_to_room',
        payment_status ENUM('paid', 'pending', 'settled_at_checkout', 'waived') NOT NULL DEFAULT 'pending',
        payment_method VARCHAR(50) NULL,
        receipt_number VARCHAR(100) NULL,
        bill_id INT NULL,
        availed_by INT NULL,
        notes TEXT NULL,
        availed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        settled_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_booking_id (booking_id),
        INDEX idx_customer_id (customer_id),
        INDEX idx_status (payment_status)
      )
    `);
    tableChecked = true;
  } catch (err) {
    console.error('ensureGuestServicesTable warning:', err.message);
  }
}

/**
 * POST /api/guest-services/avail
 * Staff / Admin records an amenity or service availed by an in-house guest.
 * Supports:
 *   - payment_type: 'pay_now' (immediate settlement upfront)
 *   - payment_type: 'charge_to_room' (deferred settlement at checkout / on running bill)
 */
async function availService(req, res) {
  try {
    await ensureGuestServicesTable();
    const {
      booking_id,
      service_id,
      service_name,
      quantity = 1,
      unit_price = 0,
      payment_type = 'charge_to_room',
      payment_method = 'cash',
      notes = '',
    } = req.body;

    const bId = parseInt(booking_id, 10);
    if (!bId || !service_name) {
      return res.status(400).json({ message: 'Booking ID and Service Name are required.' });
    }

    const qty = Math.max(0.01, parseFloat(quantity) || 1);
    const price = Math.max(0, parseFloat(unit_price) || 0);
    const totalAmount = Math.round(qty * price * 100) / 100;

    // Fetch booking & guest details
    const [bRows] = await pool.query(`
      SELECT 
        b.id, b.customer_id, b.room_id, b.status, b.is_arrived,
        u.full_name AS customer_name, u.email AS customer_email,
        r.room_number, r.room_type
      FROM bookings b
      JOIN users u ON u.id = b.customer_id
      JOIN rooms r ON r.id = b.room_id
      WHERE b.id = ?
    `, [bId]);

    if (bRows.length === 0) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = bRows[0];
    const customerId = booking.customer_id;

    let receiptNumber = null;
    let billId = null;
    let paymentStatus = payment_type === 'pay_now' ? 'paid' : 'pending';

    // If "Pay Now" upfront: generate receipt & invoice immediately
    if (payment_type === 'pay_now' && totalAmount > 0) {
      receiptNumber = await getUniqueReceiptNumber(pool);
      const currentYear = new Date().getFullYear();
      const billNumber = `INV-SRV-${currentYear}-${Date.now().toString().slice(-4)}`;

      // Insert into bills
      const [newBill] = await pool.query(`
        INSERT INTO bills (
          bill_number, customer_id, booking_id, total_amount, paid_amount, status, receipt_number, issued_by, issued_at
        ) VALUES (?, ?, ?, ?, ?, 'paid', ?, ?, NOW())
      `, [billNumber, customerId, bId, totalAmount, totalAmount, receiptNumber, req.user.id]);

      billId = newBill.insertId;

      // Insert into bill_line_items
      await pool.query(`
        INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
        VALUES (?, ?, ?, ?)
      `, [billId, `${service_name.trim()} (Guest Availment)`, qty, price]);

      // Insert payment record
      await pool.query(`
        INSERT INTO payments (bill_id, amount, method, received_by, receipt_number, paid_at, notes)
        VALUES (?, ?, ?, ?, ?, NOW(), ?)
      `, [
        billId,
        totalAmount,
        ['cash', 'card', 'ewallet', 'gcash', 'maya'].includes(String(payment_method).toLowerCase())
          ? String(payment_method).toLowerCase()
          : 'cash',
        req.user.id,
        receiptNumber,
        `Upfront payment for ${service_name} (x${qty}) · Rm ${booking.room_number}`,
      ]);
    }

    // Insert into guest_service_availments
    const [result] = await pool.query(`
      INSERT INTO guest_service_availments (
        booking_id, customer_id, service_id, service_name, quantity, unit_price,
        total_amount, payment_type, payment_status, payment_method, receipt_number,
        bill_id, availed_by, notes, availed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      bId,
      customerId,
      service_id ? parseInt(service_id, 10) : null,
      service_name.trim(),
      qty,
      price,
      totalAmount,
      payment_type,
      paymentStatus,
      payment_type === 'pay_now' ? payment_method : null,
      receiptNumber,
      billId,
      req.user.id,
      notes ? notes.trim() : null,
    ]);

    const availmentId = result.insertId;

    // Notify staff, admin, and user
    notifyStaffAndAdmin();
    notifyUser(customerId);

    // Audit log
    await requestLifecycle.logAudit(pool, {
      entityType: 'booking',
      entityId: bId,
      fromStatus: booking.status,
      toStatus: booking.status,
      performedBy: req.user.id,
      performedByName: req.user.full_name || req.user.username,
      triggerType: 'manual',
      reason: `Guest availed ${service_name} (x${qty}) for ₱${totalAmount.toLocaleString()} [${payment_type === 'pay_now' ? 'Paid Upfront' : 'Charged to Room / Checkout'}]`,
    });

    res.status(201).json({
      message: payment_type === 'pay_now'
        ? `Service successfully availed and paid (Receipt: ${receiptNumber}).`
        : `Service successfully charged to Room ${booking.room_number} (Added to Running Bill).`,
      availment: {
        id: availmentId,
        booking_id: bId,
        customer_id: customerId,
        service_name: service_name.trim(),
        quantity: qty,
        unit_price: price,
        total_amount: totalAmount,
        payment_type,
        payment_status: paymentStatus,
        receipt_number: receiptNumber,
        bill_id: billId,
      },
    });
  } catch (err) {
    console.error('availService error:', err);
    res.status(500).json({ message: err.message });
  }
}

/**
 * GET /api/guest-services/running-bill/:bookingId
 * Returns the comprehensive running bill / statement of account for a booking.
 * Combines room charges + all availed amenities/services (both paid upfront and pending).
 */
async function getRunningBill(req, res) {
  try {
    await ensureGuestServicesTable();
    const bId = parseInt(req.params.bookingId, 10);
    if (!bId) {
      return res.status(400).json({ message: 'Invalid booking ID.' });
    }

    // Fetch booking details
    const [bRows] = await pool.query(`
      SELECT 
        b.id AS booking_id,
        CONCAT('BK-', YEAR(b.created_at), '-', LPAD(b.id, 4, '0')) AS booking_ref,
        b.customer_id,
        u.full_name AS customer_name,
        u.email AS customer_email,
        u.phone AS customer_phone,
        b.room_id,
        r.room_number,
        r.room_type,
        r.rate_per_night,
        b.booking_type,
        b.duration_hours,
        b.check_in_time,
        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
        CASE
          WHEN b.booking_type = 'short_time' THEN b.duration_hours
          ELSE GREATEST(1, DATEDIFF(b.check_out, b.check_in))
        END AS nights,
        b.status AS booking_status,
        b.is_arrived
      FROM bookings b
      JOIN users u ON u.id = b.customer_id
      JOIN rooms r ON r.id = b.room_id
      WHERE b.id = ?
    `, [bId]);

    if (bRows.length === 0) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = bRows[0];

    // Check customer authorization if requester is a customer
    if (req.user && req.user.role === 'customer' && req.user.id !== booking.customer_id) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // Fetch primary booking room bill
    const [billRows] = await pool.query(`
      SELECT id, bill_number, total_amount, paid_amount, status, receipt_number
      FROM bills
      WHERE booking_id = ? AND (bill_number IS NULL OR bill_number NOT LIKE 'INV-SRV-%')
      ORDER BY id ASC
      LIMIT 1
    `, [bId]);

    const roomBill = billRows[0] || null;
    const roomTotal = roomBill ? Number(roomBill.total_amount || 0) : (
      booking.booking_type === 'short_time'
        ? Math.round(((Number(booking.rate_per_night) / 24) * 2 * (booking.duration_hours || 3)) * 100) / 100
        : Number(booking.rate_per_night) * (booking.nights || 1)
    );
    const roomPaid = roomBill ? Number(roomBill.paid_amount || 0) : 0;
    const roomBalance = Math.max(0, roomTotal - roomPaid);

    // Fetch all service availments
    const [availments] = await pool.query(`
      SELECT 
        gsa.id,
        gsa.booking_id,
        gsa.customer_id,
        gsa.service_id,
        gsa.service_name,
        gsa.quantity,
        gsa.unit_price,
        gsa.total_amount,
        gsa.payment_type,
        gsa.payment_status,
        gsa.payment_method,
        gsa.receipt_number,
        gsa.bill_id,
        gsa.notes,
        gsa.availed_at,
        gsa.settled_at,
        staff.full_name AS staff_name
      FROM guest_service_availments gsa
      LEFT JOIN users staff ON staff.id = gsa.availed_by
      WHERE gsa.booking_id = ?
      ORDER BY gsa.availed_at ASC
    `, [bId]);

    // Compute service financials
    let servicesTotal = 0;
    let servicesPaidUpfront = 0;
    let servicesPendingAtCheckout = 0;

    for (const a of availments) {
      const amt = Number(a.total_amount || 0);
      servicesTotal += amt;
      if (a.payment_status === 'paid' || a.payment_status === 'settled_at_checkout') {
        servicesPaidUpfront += amt;
      } else if (a.payment_status === 'pending') {
        servicesPendingAtCheckout += amt;
      }
    }

    const grandTotal = roomTotal + servicesTotal;
    const totalPaid = roomPaid + servicesPaidUpfront;
    const netBalanceDue = roomBalance + servicesPendingAtCheckout;

    res.json({
      booking,
      room_charges: {
        bill_id: roomBill?.id || null,
        bill_number: roomBill?.bill_number || null,
        rate_per_night: Number(booking.rate_per_night),
        nights: booking.nights,
        total: roomTotal,
        paid: roomPaid,
        balance: roomBalance,
        status: roomBill?.status || (roomBalance === 0 ? 'paid' : 'pending'),
      },
      services: availments,
      summary: {
        services_count: availments.length,
        services_total: servicesTotal,
        services_paid_upfront: servicesPaidUpfront,
        services_pending_at_checkout: servicesPendingAtCheckout,
        grand_total: grandTotal,
        total_paid: totalPaid,
        net_balance_due: netBalanceDue,
      },
    });
  } catch (err) {
    console.error('getRunningBill error:', err);
    res.status(500).json({ message: err.message });
  }
}

/**
 * GET /api/guest-services/unpaid/:bookingId
 * Returns only the pending / unbilled charges that need to be settled at checkout.
 */
async function getUnpaidCharges(req, res) {
  try {
    await ensureGuestServicesTable();
    const bId = parseInt(req.params.bookingId, 10);
    if (!bId) {
      return res.status(400).json({ message: 'Invalid booking ID.' });
    }

    const [rows] = await pool.query(`
      SELECT 
        id, service_name, quantity, unit_price, total_amount, payment_type, payment_status, notes, availed_at
      FROM guest_service_availments
      WHERE booking_id = ? AND payment_status = 'pending'
      ORDER BY availed_at ASC
    `, [bId]);

    const totalUnpaid = rows.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

    res.json({
      booking_id: bId,
      unpaid_count: rows.length,
      total_unpaid: totalUnpaid,
      items: rows,
    });
  } catch (err) {
    console.error('getUnpaidCharges error:', err);
    res.status(500).json({ message: err.message });
  }
}

/**
 * POST /api/guest-services/settle/:bookingId
 * Settles all pending charges at checkout.
 * Links them to a checkout bill/receipt and adds line items to the main booking bill.
 */
async function settleAtCheckout(req, res) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const bId = parseInt(req.params.bookingId, 10);
    const { receipt_number, payment_method = 'cash' } = req.body;

    // Get pending charges
    const [pending] = await conn.query(`
      SELECT * FROM guest_service_availments
      WHERE booking_id = ? AND payment_status = 'pending'
    `, [bId]);

    if (pending.length === 0) {
      await conn.commit();
      return res.json({ message: 'No pending charges to settle.', settled_count: 0, total_settled: 0 });
    }

    const totalSettled = pending.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

    // Find main booking bill
    const [billRows] = await conn.query(`
      SELECT id, total_amount, paid_amount FROM bills
      WHERE booking_id = ? AND (bill_number IS NULL OR bill_number NOT LIKE 'INV-SRV-%')
      ORDER BY id ASC LIMIT 1
    `, [bId]);

    let billId = billRows[0]?.id || null;

    if (billId) {
      // Add each settled service as a line item to the main checkout bill
      for (const item of pending) {
        await conn.query(`
          INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
          VALUES (?, ?, ?, ?)
        `, [billId, `${item.service_name} (Availment settled at checkout)`, item.quantity, item.unit_price]);
      }

      // Update bill total amount
      const newTotal = Number(billRows[0].total_amount) + totalSettled;
      const newPaid = Number(billRows[0].paid_amount) + totalSettled;
      await conn.query(`
        UPDATE bills 
        SET total_amount = ?, paid_amount = ?, status = 'paid', updated_at = NOW()
        WHERE id = ?
      `, [newTotal, newPaid, billId]);
    }

    // Mark availments as settled_at_checkout
    const finalReceipt = receipt_number || (await getUniqueReceiptNumber(conn));
    await conn.query(`
      UPDATE guest_service_availments
      SET 
        payment_status = 'settled_at_checkout',
        settled_at = NOW(),
        receipt_number = ?,
        payment_method = ?,
        bill_id = COALESCE(?, bill_id)
      WHERE booking_id = ? AND payment_status = 'pending'
    `, [finalReceipt, payment_method, billId, bId]);

    await conn.commit();

    notifyStaffAndAdmin();

    res.json({
      message: `Successfully settled ${pending.length} pending service charges (₱${totalSettled.toLocaleString()}) at checkout.`,
      settled_count: pending.length,
      total_settled: totalSettled,
      receipt_number: finalReceipt,
    });
  } catch (err) {
    await conn.rollback();
    console.error('settleAtCheckout error:', err);
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

/**
 * DELETE /api/guest-services/:id
 * Staff / Admin cancels/voids a pending amenity charge (e.g., entered by mistake or guest cancelled).
 */
async function deleteAvailment(req, res) {
  try {
    await ensureGuestServicesTable();
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT * FROM guest_service_availments WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Availment not found.' });
    }

    const item = rows[0];
    if (item.payment_status === 'paid' && item.bill_id) {
      return res.status(400).json({ message: 'Cannot delete an already paid service charge directly. Please process a refund or credit.' });
    }

    await pool.query('DELETE FROM guest_service_availments WHERE id = ?', [id]);

    notifyStaffAndAdmin();

    res.json({ message: `Service charge "${item.service_name}" removed from running bill.` });
  } catch (err) {
    console.error('deleteAvailment error:', err);
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  ensureGuestServicesTable,
  availService,
  getRunningBill,
  getUnpaidCharges,
  settleAtCheckout,
  deleteAvailment,
};
