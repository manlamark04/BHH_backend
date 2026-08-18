const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/booking.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');
const { validate }     = require('../middleware/validate');

// ── Static / Special Collections (Mount before :id) ───────

// GET /api/bookings/approval-queue — Staff/Admin: items in pending_approval
router.get('/approval-queue', authenticate, requireRole('staff', 'admin'), svc.getApprovalQueue);

// GET /api/bookings/awaiting-payment — Staff/Admin: items in pending_payment
router.get('/awaiting-payment', authenticate, requireRole('staff', 'admin'), svc.getAwaitingPayment);

// GET /api/bookings/my — Customer: own bookings
router.get('/my', authenticate, requireRole('customer'), svc.getMyBookings);

// ── Activity Rentals (Mount before /:id) ───────────────────
router.get('/rentals/schedule', authenticate, svc.getRentalsSchedule);
router.get('/rentals/my', authenticate, requireRole('customer'), svc.getMyRentals);
router.get('/rentals', authenticate, requireRole('staff', 'admin'), svc.getAllRentals);

router.post('/rentals',
  authenticate, requireRole('customer', 'staff', 'admin'),
  [
    body('activity_id').isInt(),
    body('start_time').notEmpty(),
    body('end_time').notEmpty(),
  ],
  validate, svc.createRental
);

router.patch('/rentals/:id/approve',
  authenticate, requireRole('staff', 'admin'),
  svc.approveRental
);

router.patch('/rentals/:id/reject',
  authenticate, requireRole('staff', 'admin'),
  [body('reason').trim().notEmpty().withMessage('Rejection reason is required.')],
  validate, svc.rejectRental
);

router.patch('/rentals/:id/status',
  authenticate, requireRole('staff', 'admin'),
  [body('status').notEmpty()],
  validate, svc.updateRentalStatus
);

// ── Room Bookings Master ──────────────────────────────────

// GET /api/bookings — Staff/Admin: all bookings
router.get('/', authenticate, requireRole('staff', 'admin'), svc.getAllBookings);

// POST /api/bookings — Customer or Staff/Admin on behalf
router.post('/',
  authenticate, requireRole('customer', 'staff', 'admin'),
  [
    body('room_id').notEmpty().withMessage('room_id is required.'),
    body('check_in').notEmpty().withMessage('check_in must be a valid date.'),
    body('check_out').notEmpty().withMessage('check_out must be a valid date.'),
  ],
  validate, svc.createBooking
);

// GET /api/bookings/:id/audit — State machine audit trail
router.get('/:id/audit', authenticate, requireRole('staff', 'admin'), svc.getBookingAuditTrail);

// PATCH /api/bookings/:id/approve — Staff/Admin: Approve booking
router.patch('/:id/approve',
  authenticate, requireRole('staff', 'admin'),
  svc.approveBooking
);

// PATCH /api/bookings/:id/reject — Staff/Admin: Reject booking
router.patch('/:id/reject',
  authenticate, requireRole('staff', 'admin'),
  [body('reason').trim().notEmpty().withMessage('Rejection reason is required.')],
  validate, svc.rejectBooking
);

// PATCH /api/bookings/:id/cancel — Customer/Staff: Cancel booking
router.patch('/:id/cancel',
  authenticate,
  svc.cancelBooking
);

// PUT /api/bookings/:id — Staff/Admin: Edit booking
router.put('/:id',
  authenticate, requireRole('staff', 'admin'),
  svc.editBooking
);

// PATCH /api/bookings/:id/status — Staff/Admin: Update status
router.patch('/:id/status',
  authenticate, requireRole('staff', 'admin'),
  [body('status').notEmpty()],
  validate, svc.updateBookingStatus
);

// POST /api/bookings/:id/payment — Staff/Admin: Record payment
router.post('/:id/payment',
  authenticate, requireRole('staff', 'admin'),
  [body('amount').isFloat({ min: 1 })],
  validate, svc.recordBookingPayment
);

module.exports = router;
