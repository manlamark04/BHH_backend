const express  = require('express');
const { body } = require('express-validator');
const router   = express.Router();
const svc      = require('../services/room.service');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roles');
const { validate }     = require('../middleware/validate');

// Public/Customer/Admin: get room catalog
router.get('/', svc.getRooms);

// Customer: get available rooms for date range
router.get('/available', svc.getAvailableRooms);

// Admin: create room
router.post('/',
  authenticate, requireRole('admin'),
  [
    body('room_number').trim().notEmpty().withMessage('Room number is required.'),
    body('room_type').trim().notEmpty().withMessage('Room type is required.'),
    body('rate_per_night').isFloat({ min: 0 }).withMessage('Valid rate per night is required.'),
  ],
  validate, svc.createRoom
);

// Admin: update room
router.put('/:id',
  authenticate, requireRole('admin'),
  svc.updateRoom
);

// Admin: update room status
router.patch('/:id/status',
  authenticate, requireRole('staff', 'admin'),
  svc.updateRoomStatus
);

// Admin: delete or deactivate room
router.delete('/:id',
  authenticate, requireRole('admin'),
  svc.deleteRoom
);

module.exports = router;
