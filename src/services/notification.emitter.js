const { getIo } = require('../config/socket');

function notifyStaffAndAdmin() {
  try {
    const io = getIo();
    // Emit to staff and admin rooms
    io.to('admin').emit('notification_update');
    io.to('staff').emit('notification_update');
  } catch (err) {
    console.error('Socket emit error:', err);
  }
}

function notifyUser(userId) {
  try {
    const io = getIo();
    io.to(`user_${userId}`).emit('notification_update');
  } catch (err) {
    console.error('Socket emit error:', err);
  }
}

module.exports = {
  notifyStaffAndAdmin,
  notifyUser
};
