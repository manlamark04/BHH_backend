const { Server } = require('socket.io');

let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
      }
    });
    
    io.on('connection', (socket) => {
      // Allow clients to join rooms based on their roles for targeted notifications
      socket.on('join_role', (role) => {
        if (['admin', 'staff', 'customer'].includes(role)) {
          socket.join(role);
        }
      });
      
      socket.on('join_user', (userId) => {
        if (userId) {
          socket.join(`user_${userId}`);
        }
      });
    });
    
    return io;
  },
  getIo: () => {
    if (!io) {
      console.warn('Socket.io not initialized, returning mock to prevent crashes');
      return { to: () => ({ emit: () => {} }), emit: () => {} };
    }
    return io;
  }
};
