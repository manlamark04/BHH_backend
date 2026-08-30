const express = require('express');
const { body }  = require('express-validator');
const router    = express.Router();
const svc       = require('../services/auth.service');
const { authenticate } = require('../middleware/auth');
const { validate }     = require('../middleware/validate');

// POST /api/auth/register
router.post('/register',
  [
    body('first_name').optional().trim(),
    body('last_name').optional().trim(),
    body('middle_name').optional().trim(),
    body('full_name').optional().trim(),
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('username').optional().trim(),
    body('phone')
      .trim()
      .notEmpty().withMessage('Phone number is required.')
      .custom((val) => {
        const digits = String(val).replace(/\D/g, '');
        if (!/^09\d{9}$/.test(digits)) {
          throw new Error('Phone number must be an 11-digit Philippine mobile number starting with 09 (e.g. 09171234567).');
        }
        return true;
      }),
    body('address').optional().trim(),
    body('dob').optional().trim(),
    body('gender').optional().trim(),
    body('civil_status').optional().trim(),
  ],
  validate, svc.register
);

// POST /api/auth/login
router.post('/login',
  [
    body('identifier').trim().notEmpty().withMessage('Email or username is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  validate, svc.login
);

// GET /api/auth/me
router.get('/me', authenticate, svc.getMe);

// PUT /api/auth/profile
router.put('/profile',
  authenticate,
  [
    body('first_name').optional().trim(),
    body('middle_name').optional().trim(),
    body('last_name').optional().trim(),
    body('full_name').optional().trim(),
    body('phone').optional().trim(),
    body('gender').optional().trim(),
    body('address').optional().trim(),
    body('civil_status').optional().trim(),
    body('dob').optional().trim(),
  ],
  validate, svc.updateProfile
);

// POST /api/auth/change-password
router.post('/change-password',
  authenticate,
  [
    body('current_password').notEmpty().withMessage('Current password is required.'),
    body('new_password').notEmpty().withMessage('New password is required.'),
  ],
  validate, svc.changePassword
);

module.exports = router;
