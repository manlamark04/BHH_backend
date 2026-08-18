const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/motorcycle.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');
const { validate }     = require('../middleware/validate');

// ─── RENTALS (Must be mounted before /:id) ───────────────────

// Create rental transaction (Customer for self, or Staff/Admin for guest)
router.post('/rentals',
  authenticate,
  [
    body('motor_id').notEmpty().withMessage('Motorcycle selection is required.'),
    body('start_datetime').notEmpty().withMessage('Start date/time is required.'),
    body('expected_return_datetime').notEmpty().withMessage('Expected return date/time is required.'),
  ],
  validate,
  svc.createMotorRental
);

// List rentals (Customers see own; Staff/Admin see all)
router.get('/rentals/all', authenticate, svc.getAllRentals);
router.get('/rentals/my', authenticate, svc.getAllRentals);
router.get('/rentals', authenticate, svc.getAllRentals);

// Get single rental details + audit
router.get('/rentals/:id', authenticate, svc.getRentalById);

// Staff/Admin: Process return
router.post('/rentals/:id/return',
  authenticate,
  requireRole('staff', 'admin'),
  svc.processMotorReturn
);

// Cancel rental
router.post('/rentals/:id/cancel',
  authenticate,
  svc.cancelMotorRental
);

// ─── FLEET MANAGEMENT ────────────────────────────────────────

// Public & Authenticated: List motorcycles (e.g. ?status=AVAILABLE)
router.get('/', svc.getMotorcycles);

// Admin: Add motorcycle to fleet
router.post('/',
  authenticate,
  requireRole('admin'),
  [
    body('brand').trim().notEmpty().withMessage('Brand is required.'),
    body('model').trim().notEmpty().withMessage('Model is required.'),
    body('type').trim().notEmpty().withMessage('Type is required.'),
    body('plate_number').trim().notEmpty().withMessage('Plate number is required.'),
    body('rental_rate').isFloat({ min: 1 }).withMessage('Valid rental rate is required.'),
  ],
  validate,
  svc.createMotorcycle
);

// Admin: Update motorcycle details
router.put('/:id',
  authenticate,
  requireRole('admin'),
  svc.updateMotorcycle
);

// Get single motorcycle (Keep last to avoid route collision)
router.get('/:id', svc.getMotorcycleById);

module.exports = router;
