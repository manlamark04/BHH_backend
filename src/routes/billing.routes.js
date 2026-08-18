const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/billing.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');
const { validate }     = require('../middleware/validate');

// GET /api/bills — Staff/Admin
router.get('/', authenticate, requireRole('staff', 'admin'), svc.getAllBills);

// GET /api/bills/my — Customer: own bills/history
router.get('/my', authenticate, requireRole('customer'), svc.getMyBills);

// GET /api/bills/:id/items — line items
router.get('/:id/items', authenticate, requireRole('staff', 'admin', 'customer'), svc.getBillLineItems);

// GET /api/bills/:id/payments — payment history
router.get('/:id/payments', authenticate, requireRole('staff', 'admin'), svc.getBillPayments);

// POST /api/bills — Staff/Admin: generate bill
router.post('/',
  authenticate, requireRole('staff', 'admin'),
  [
    body('customer_id').isInt(),
    body('line_items').isArray({ min: 1 }).withMessage('At least one line item is required.'),
    body('line_items.*.description').trim().notEmpty(),
    body('line_items.*.quantity').isFloat({ min: 0.01 }),
    body('line_items.*.unit_price').isFloat({ min: 0 }),
  ],
  validate, svc.generateBill
);

// POST /api/bills/payments (or /api/payments) — Staff/Admin: record payment
router.post('/payments',
  authenticate, requireRole('staff', 'admin'),
  [
    body('amount').isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than 0.'),
  ],
  validate, svc.recordPayment
);

// POST /api/bills/payments/:id/refund — Admin: refund payment
router.post('/payments/:id/refund',
  authenticate, requireRole('admin'),
  [
    body('reason').trim().notEmpty().withMessage('Refund reason is required.'),
  ],
  validate, svc.refundPayment
);

// POST /api/bills/:id/cancel — Staff/Admin: cancel an unpaid bill
router.post('/:id/cancel',
  authenticate, requireRole('staff', 'admin'),
  svc.cancelBill
);

module.exports = router;
