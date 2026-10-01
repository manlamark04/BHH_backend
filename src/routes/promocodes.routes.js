const express = require('express');
const router = express.Router();
const svc = require('../services/promocodes.service');

// Public route to validate a promo code during checkout
router.post('/validate', svc.validatePromo);

// Admin routes (should ideally have authMiddleware and authorizeRoles('admin', 'staff'))
router.get('/', svc.getAllPromos);
router.post('/', svc.createPromo);
router.put('/:id/status', svc.updatePromoStatus);
router.delete('/:id', svc.deletePromo);

module.exports = router;
