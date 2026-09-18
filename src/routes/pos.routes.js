const express = require('express');
const router = express.Router();
const svc = require('../services/pos.service');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const upload = require('../middleware/upload');

// Admin/Staff only for all POS routes unless specified
router.use(authenticate);

// Categories (Allow customers to view)
router.get('/categories', requireRole('admin', 'staff', 'customer'), svc.getCategories);
router.post('/categories', authenticate, requireRole('admin'), svc.createCategory); // Only admin creates categories

// Products (Allow customers to view)
router.get('/products', requireRole('admin', 'staff', 'customer'), svc.getProducts);
router.post('/products', requireRole('admin'), upload.single('image'), svc.createProduct); // Only admin creates products
router.put('/products/:id', requireRole('admin'), upload.single('image'), svc.updateProduct);
router.patch('/products/:id/stock', requireRole('admin', 'staff'), svc.updateStock); // Staff can restock? Or just admin. We'll allow staff to restock.

// POS Checkout
router.post('/checkout', requireRole('admin', 'staff'), svc.checkout);

// Guest Receipts
router.get('/orders/me', requireRole('customer'), svc.getMyOrders);

// Reporting
router.get('/orders', requireRole('admin'), svc.getOrders);
router.get('/orders/:id/items', requireRole('admin'), svc.getOrderItems);

module.exports = router;
