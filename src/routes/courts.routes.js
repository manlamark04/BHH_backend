const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/court.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');
const { validate }     = require('../middleware/validate');

// GET /api/courts — Public/Authenticated: List all courts
router.get('/', svc.getCourts);

// GET /api/courts/:id — Get single court
router.get('/:id', svc.getCourtById);

// POST /api/courts — Admin: Add new court entity
router.post('/',
  authenticate, requireRole('admin'),
  [
    body('name').trim().notEmpty().withMessage('Court name is required.'),
    body('hourly_rate').optional().isFloat({ min: 0 }).withMessage('Hourly rate must be a valid positive number.'),
  ],
  validate, svc.createCourt
);

// PUT /api/courts/:id — Admin: Edit court details
router.put('/:id',
  authenticate, requireRole('admin'),
  [
    body('name').optional().trim().notEmpty().withMessage('Court name cannot be empty.'),
    body('hourly_rate').optional().isFloat({ min: 0 }).withMessage('Hourly rate must be a valid positive number.'),
  ],
  validate, svc.updateCourt
);

// PATCH /api/courts/:id/status — Staff/Admin: Update court status (e.g. Maintenance)
router.patch('/:id/status',
  authenticate, requireRole('staff', 'admin'),
  [
    body('status').notEmpty().withMessage('Status is required.'),
  ],
  validate, svc.updateCourtStatus
);

module.exports = router;
