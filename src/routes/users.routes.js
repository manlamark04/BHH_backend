const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/user.service');
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/roles');
const { validate }      = require('../middleware/validate');

// ─── WALK-IN & CUSTOMER MANAGEMENT ────────────────────────────

// Staff & Admin: Register Walk-In Customer
router.post('/walkin',
  authenticate,
  requireRole('staff', 'admin'),
  [
    body('first_name').trim().notEmpty().withMessage('First Name is required.'),
    body('middle_name').optional({ checkFalsy: true }).trim(),
    body('last_name').trim().notEmpty().withMessage('Last Name is required.'),
    body('phone')
      .trim()
      .notEmpty().withMessage('Contact Number is required.')
      .custom((val) => {
        const digits = String(val).replace(/\D/g, '');
        if (!/^09\d{9}$/.test(digits)) {
          throw new Error('Contact Number must be an 11-digit Philippine mobile number starting with 09 (e.g. 09171234567).');
        }
        return true;
      }),
    body('email').isEmail().normalizeEmail().withMessage('Valid Email Address is required.'),
    body('address').trim().notEmpty().withMessage('Home Address is required.'),
    body('dob').trim().notEmpty().withMessage('Date of Birth is required.'),
    body('gender').trim().notEmpty().withMessage('Gender is required.'),
    body('civil_status').trim().notEmpty().withMessage('Civil Status is required.'),
  ],
  validate,
  svc.registerWalkInCustomer
);

// Alias: /customers POST also maps to registerWalkInCustomer
router.post('/customers',
  authenticate,
  requireRole('staff', 'admin'),
  [
    body('first_name').optional().trim(),
    body('last_name').optional().trim(),
    body('email').isEmail().normalizeEmail().withMessage('Valid Email Address is required.'),
  ],
  validate,
  svc.registerWalkInCustomer
);

// Staff & Admin: List & Search customers (sorted created_at DESC)
router.get('/customers', authenticate, requireRole('staff', 'admin'), svc.getAllCustomers);
router.get('/customers/search', authenticate, requireRole('staff', 'admin'), svc.searchCustomers);

// Staff, Admin, or Customer self: Get single customer profile & audit logs
router.get('/customers/:id', authenticate, svc.getCustomerById);
router.get('/customers/:id/audit', authenticate, requireRole('staff', 'admin'), svc.getCustomerAuditHistory);

// Admin Only: Customer Account Approval Actions
router.post('/customers/:id/approve', authenticate, requireRole('admin'), svc.approveCustomer);
router.post('/customers/:id/reject', authenticate, requireRole('admin'), svc.rejectCustomer);
router.post('/customers/:id/suspend', authenticate, requireRole('admin'), svc.suspendCustomer);
router.post('/customers/:id/reactivate', authenticate, requireRole('admin'), svc.reactivateCustomer);

// ─── GENERAL USER MANAGEMENT (Admin) ──────────────────────────

// Admin: get all users (optionally filter by role)
router.get('/', authenticate, requireRole('admin'), svc.getAllUsers);

// Admin: approval queue (pending users)
router.get('/pending', authenticate, requireRole('admin'), svc.getPendingUsers);

// Admin: approve user
router.post('/approve/:id', authenticate, requireRole('admin'), svc.approveUser);

// Admin: approve customer with account credentials
router.post('/approve-customer/:id', authenticate, requireRole('admin'), svc.approveCustomerAccount);

// Admin: reject user
router.post('/reject/:id',
  authenticate, requireRole('admin'),
  [body('reason').optional().trim()],
  validate, svc.rejectUser
);

// Admin: toggle enable/disable
router.post('/toggle/:id', authenticate, requireRole('admin'), svc.toggleUserStatus);

// Admin: create staff account
router.post('/staff',
  authenticate, requireRole('admin'),
  [
    body('first_name').optional().trim(),
    body('middle_name').optional().trim(),
    body('last_name').optional().trim(),
    body('full_name').optional().trim(),
    body('email').isEmail().normalizeEmail(),
    body('username').trim().isLength({ min: 3 }),
    body('phone').optional().trim(),
    body('address').optional().trim(),
    body('dob').optional().trim(),
    body('gender').optional().trim(),
    body('civil_status').optional().trim(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
  ],
  validate, svc.createStaff
);

module.exports = router;
