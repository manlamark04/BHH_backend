const express = require('express');
const router = express.Router();
const svc = require('../services/reviews.service');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/reviews (Public - optionalAuth to check if staff/admin are viewing)
router.get('/', optionalAuthenticate, svc.getAllReviews);

// GET /api/reviews/me (Customer: get their own reviews)
router.get('/me', authenticate, requireRole('customer'), svc.getMyReviews);

// POST /api/reviews (Customer: submit a review)
router.post('/', authenticate, requireRole('customer'), svc.createReview);

// PATCH /api/reviews/:id/toggle (Admin: toggle visibility)
router.patch('/:id/toggle', authenticate, requireRole('admin', 'staff'), svc.toggleVisibility);

module.exports = router;
