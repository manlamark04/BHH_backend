const express = require('express');
const router = express.Router();
const svc = require('../services/inquiries.service');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// POST /api/inquiries (Public: guest inquiry submission)
router.post('/', svc.createInquiry);

// GET /api/inquiries (Staff/Admin: view inquiries)
router.get('/', authenticate, requireRole('staff', 'admin'), svc.getInquiries);

// PATCH /api/inquiries/:id/status (Staff/Admin: update status)
router.patch('/:id/status', authenticate, requireRole('staff', 'admin'), svc.updateInquiryStatus);

module.exports = router;
