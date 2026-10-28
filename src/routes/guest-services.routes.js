const express = require('express');
const router = express.Router();
const svc = require('../services/guest-services.service');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// Record a new service availed by guest (with Pay Now vs Charge to Room option)
router.post('/avail', authenticate, requireRole('staff', 'admin'), svc.availService);

// Get complete Running Bill (Statement of Account) for a booking
router.get('/running-bill/:bookingId', authenticate, svc.getRunningBill);

// Get only unpaid / pending charges for a booking
router.get('/unpaid/:bookingId', authenticate, requireRole('staff', 'admin'), svc.getUnpaidCharges);

// Settle pending service charges at checkout
router.post('/settle/:bookingId', authenticate, requireRole('staff', 'admin'), svc.settleAtCheckout);

// Delete/Void a pending charge
router.delete('/:id', authenticate, requireRole('staff', 'admin'), svc.deleteAvailment);

module.exports = router;
