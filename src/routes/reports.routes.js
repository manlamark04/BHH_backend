const express = require('express');
const router  = express.Router();
const svc     = require('../services/report.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');

// GET /api/reports/monthly?year=&month=
router.get('/monthly', authenticate, requireRole('admin'), svc.getMonthlyReport);

// GET /api/reports/yearly?year=
router.get('/yearly', authenticate, requireRole('admin'), svc.getYearlyReport);

// GET /api/dashboard/staff
router.get('/dashboard/staff', authenticate, requireRole('staff', 'admin'), svc.getStaffDashboard);

// GET /api/dashboard/admin
router.get('/dashboard/admin', authenticate, requireRole('admin'), svc.getAdminDashboard);

module.exports = router;
