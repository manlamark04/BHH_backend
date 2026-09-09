const express = require('express');
const router  = express.Router();
const svc     = require('../services/audit.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');

// GET /api/audit — Admin & Staff: Unified Audit Trail
router.get('/', authenticate, requireRole('admin', 'staff'), svc.getAuditTrail);

module.exports = router;
