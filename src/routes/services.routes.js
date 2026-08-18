const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/catalog.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');
const { validate }     = require('../middleware/validate');

// GET /api/services — public
router.get('/', svc.getServices);

// POST /api/services — Admin
router.post('/',
  authenticate, requireRole('admin'),
  [body('name').trim().notEmpty()],
  validate, svc.createService
);

// PUT /api/services/:id — Admin
router.put('/:id', authenticate, requireRole('admin'), validate, svc.updateService);

module.exports = router;
