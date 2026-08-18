const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/booking.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');
const { validate }     = require('../middleware/validate');

// GET /api/bookings — Staff/Admin: all bookings
router.get('/', authenticate, requireRole('staff', 'admin'), svc.getAllBookings);

// GET /api/bookings/my — Customer: own bookings
router.get('/my', authenticate, requireRole('customer'), svc.getMyBookings);

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

// PUT /api/bookings/:id — Staff/Admin: Edit booking
router.put('/:id',
  authenticate, requireRole('staff', 'admin'),
  svc.editBooking
);

// PATCH /api/bookings/:id/status — Staff/Admin: Update status (check-in, check-out, cancel)
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

// ── Activity Rentals ──────────────────────────────────────

// GET /api/bookings/rentals — Staff/Admin
router.get('/rentals', authenticate, requireRole('staff', 'admin'), svc.getAllRentals);

// GET /api/bookings/rentals/my — Customer
router.get('/rentals/my', authenticate, requireRole('customer'), svc.getMyRentals);

// POST /api/bookings/rentals — Customer or Staff
router.post('/rentals',
  authenticate, requireRole('customer', 'staff', 'admin'),
  [
    body('activity_id').isInt(),
    body('start_time').isISO8601(),
    body('end_time').isISO8601(),
  ],
  validate, svc.createRental
);

// PATCH /api/bookings/rentals/:id/status — Staff/Admin
router.patch('/rentals/:id/status',
  authenticate, requireRole('staff', 'admin'),
  [body('status').notEmpty()],
  validate, svc.updateRentalStatus
);

module.exports = router;
