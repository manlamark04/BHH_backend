const pool = require('../config/db');
const requestLifecycle = require('./request-lifecycle.service');

/**
 * No-Show fee has been removed per management directive.
 * Guests who fail to check in are still marked as No-Show (room is released),
 * but no penalty fee is charged to their account.
 */
function calculateNoShowFee() {
  return 0;
}

/**
 * Process a booking as No-Show
 * - Marks booking status as 'no_show'
 * - Releases the room back to 'available'
 * - Logs the audit trail
 * - No fee is charged
 * @param {number} bookingId 
 * @param {object} options { staffUser, triggerType, reason }
 */
async function processBookingNoShow(bookingId, { staffUser = null, triggerType = 'system_cutoff', reason = null } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [bRows] = await conn.query(`
      SELECT b.*, r.room_number, r.rate_per_night, r.room_type, u.full_name AS customer_name, u.email AS customer_email
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      JOIN users u ON u.id = b.customer_id
      WHERE b.id = ?
      FOR UPDATE
    `, [bookingId]);

    if (bRows.length === 0) {
      const err = new Error('Booking not found.');
      err.statusCode = 404;
      throw err;
    }

    const booking = bRows[0];
    const currentStatus = String(booking.status || '').toLowerCase();

    if (currentStatus === 'checked_in') {
      const err = new Error('Cannot mark booking as No-Show: guest has already checked in.');
      err.statusCode = 400;
      throw err;
    }

    if (currentStatus === 'no_show') {
      await conn.rollback();
      return { success: true, bookingId, message: 'Booking is already marked as No-Show.' };
    }

    if (['cancelled', 'rejected', 'checked_out'].includes(currentStatus)) {
      const err = new Error(`Cannot mark booking with status "${booking.status}" as No-Show.`);
      err.statusCode = 400;
      throw err;
    }

    const actionReason = reason || (triggerType === 'system_cutoff'
      ? 'Automated midnight cutoff: Guest failed to check in by scheduled check-in date.'
      : 'Staff manual override: Guest failed to arrive for scheduled reservation.');

    // 1. Update booking status to no_show (no fee charged)
    await conn.query(`
      UPDATE bookings 
      SET status = 'no_show',
          no_show_fee = 0,
          no_show_at = NOW(),
          rejection_reason = ?,
          updated_at = NOW()
      WHERE id = ?
    `, [actionReason, bookingId]);

    // 2. Release room immediately back to 'available'
    await conn.query("UPDATE rooms SET status = 'available', updated_at = NOW() WHERE id = ?", [booking.room_id]);

    // 3. Update associated bill status (mark as cancelled / void since no fee owed)
    const [billRows] = await conn.query('SELECT * FROM bills WHERE booking_id = ? ORDER BY id DESC LIMIT 1', [bookingId]);

    if (billRows.length > 0) {
      const bill = billRows[0];

      // Check payments received
      const [paidRows] = await conn.query(
        "SELECT SUM(amount) AS total_paid FROM payments WHERE bill_id = ? AND (notes IS NULL OR notes NOT LIKE '%[REFUNDED%')",
        [bill.id]
      );
      const totalPaid = Number(paidRows[0]?.total_paid || 0);

      // No fee charged — if guest already paid, full amount is refundable
      await conn.query(
        "UPDATE bills SET cancellation_fee = 0, status = 'cancelled', updated_at = NOW() WHERE id = ?",
        [bill.id]
      );
    }

    // 4. Audit Log Entry
    const performerId = staffUser ? staffUser.id : null;
    const performerName = staffUser ? (staffUser.full_name || staffUser.username) : 'System Midnight Cutoff';

    await requestLifecycle.logAudit(conn, {
      entityType: 'booking',
      entityId: bookingId,
      fromStatus: booking.status,
      toStatus: 'no_show',
      performedBy: performerId,
      performedByName: performerName,
      triggerType: triggerType === 'system_cutoff' ? 'system' : 'manual',
      reason: actionReason,
      metadata: {
        noShowFee: 0,
        roomNumber: booking.room_number,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        roomReleasedTo: 'available',
      },
    });

    // 5. Guest Notification
    console.log(`📨 [Guest Notification] No-Show alert generated for ${booking.customer_name} <${booking.customer_email}>: Reservation #${bookingId} marked as No-Show. No fee charged. Room ${booking.room_number} returned to Available.`);

    await conn.commit();

    return {
      success: true,
      bookingId,
      status: 'no_show',
      room_number: booking.room_number,
      room_status: 'available',
      no_show_fee: 0,
      remaining_balance: 0,
      refund_pending: 0,
      message: `Booking #${bookingId} marked as No-Show. Room ${booking.room_number} automatically reverted to Available. No fee charged.`,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Sweep and detect unclaimed confirmed bookings past their scheduled check-in cutoff
 */
async function sweepExpiredCheckIns() {
  try {
    const [expiredBookings] = await pool.query(`
      SELECT b.id, b.room_id, b.check_in, b.check_out, b.booking_type, b.duration_hours, b.check_in_time
      FROM bookings b
      WHERE b.status IN ('confirmed', 'approved')
        AND (
          -- For standard overnight stays: check-in date is strictly in the past (past 11:59:59 PM of check-in date)
          (b.booking_type != 'short_time' AND DATE(b.check_in) < CURDATE())
          OR
          -- For short-time stays: check-in datetime + duration has passed
          (b.booking_type = 'short_time' AND DATE_ADD(b.check_in, INTERVAL COALESCE(b.duration_hours, 3) HOUR) < NOW())
        )
    `);

    let processedCount = 0;
    for (const b of expiredBookings) {
      try {
        await processBookingNoShow(b.id, { triggerType: 'system_cutoff' });
        processedCount++;
      } catch (err) {
        console.error(`Failed to auto-process no-show for booking #${b.id}:`, err.message);
      }
    }

    if (processedCount > 0) {
      console.log(`⏰ No-Show Sweeper: Processed ${processedCount} expired reservation(s) as No-Show (no fee charged).`);
    }

    return processedCount;
  } catch (err) {
    console.error('Error in sweepExpiredCheckIns:', err.message);
    return 0;
  }
}

module.exports = {
  calculateNoShowFee,
  processBookingNoShow,
  sweepExpiredCheckIns,
};
