const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const svc = require('../services/lostAndFound.service');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { validate } = require('../middleware/validate');

// GET /api/lost-and-found
router.get('/', authenticate, requireRole('staff', 'admin'), svc.getItems);

// POST /api/lost-and-found
router.post('/',
  authenticate, requireRole('staff', 'admin'),
  [
    body('item_name').trim().notEmpty().withMessage('Item name is required.'),
    body('found_location').trim().notEmpty().withMessage('Location is required.'),
    body('found_date').isDate().withMessage('Valid date is required.'),
  ],
  validate, svc.reportItem
);

// PUT /api/lost-and-found/:id
router.put('/:id',
  authenticate, requireRole('staff', 'admin'),
  [
    body('item_name').trim().notEmpty().withMessage('Item name is required.'),
    body('found_location').trim().notEmpty().withMessage('Location is required.'),
    body('found_date').isDate().withMessage('Valid date is required.'),
  ],
  validate, svc.updateItem
);

// POST /api/lost-and-found/:id/status
router.post('/:id/status',
  authenticate, requireRole('staff', 'admin'),
  [
    body('status').isIn(['Found', 'Claimed', 'Discarded']).withMessage('Invalid status.'),
  ],
  validate, svc.updateStatus
);

module.exports = router;
