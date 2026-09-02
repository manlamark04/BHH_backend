const express = require('express');
const router = express.Router();
const svc = require('../services/notification.service');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/notifications/summary (Staff and Admin only)
router.get('/summary',
  authenticate,
  requireRole('staff', 'admin'),
  svc.getNotificationSummary
);

module.exports = router;
