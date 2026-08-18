const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/catalog.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');
const { validate }     = require('../middleware/validate');

// GET /api/activities — public
router.get('/', svc.getActivities);

// POST /api/activities — Admin
router.post('/',
  authenticate, requireRole('admin'),
  [
    body('name').trim().notEmpty(),
    body('price_per_unit').isFloat({ min: 0 }),
    body('inventory_count').isInt({ min: 1 }),
  ],
  validate, svc.createActivity
);

// PUT /api/activities/:id — Admin
router.put('/:id', authenticate, requireRole('admin'), validate, svc.updateActivity);

module.exports = router;
