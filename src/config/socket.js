const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db  = require('../db/procedures');

let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);
          const allowed = (process.env.FRONTEND_URL || 'http://localhost:5173')
            .split(',')
            .map(s => s.trim().replace(/\/+$/, ''));
          if (allowed.includes(origin) || process.env.NODE_ENV === 'development') {
            return callback(null, true);
          }
          return callback(new Error(`CORS origin not allowed: ${origin}`));
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
      }
    });

    // ── Authentication Middleware ──────────────────────────────
    // Strict authentication: reject any connection without a valid JWT token
    io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
          socket.handshake.query?.token;

        if (!token) {
          return next(new Error('Authentication error: Token required.'));
        }

        const secret = process.env.JWT_SECRET;
        let decoded;
        try {
          decoded = jwt.verify(token, secret);
        } catch (err) {
          return next(new Error('Authentication error: Invalid or expired token.'));
        }

        const user = await db.auth.getUserById(decoded.id);
        if (!user) {
          return next(new Error('Authentication error: User not found.'));
        }
        if (user.status !== 'active') {
          return next(new Error('Authentication error: Account is not active.'));
        }

        // Attach validated user to socket instance
        socket.user = user;
        next();
      } catch (err) {
        return next(new Error('Authentication error: Authentication verification failed.'));
      }
    });

    // ── Authenticated Connection Handler ────────────────────────
    io.on('connection', (socket) => {
      const user = socket.user;

      // 1. Automatically join the authenticated user's private channel
      socket.join(`user_${user.id}`);

      // 2. Automatically join role-specific room based ONLY on verified JWT role
      if (['admin', 'staff', 'customer'].includes(user.role)) {
        socket.join(user.role);
      }
      // Admins are permitted to receive staff operational notifications
      if (user.role === 'admin') {
        socket.join('staff');
      }

      // 3. Prevent role spoofing if client attempts to emit 'join_role'
      socket.on('join_role', (requestedRole) => {
        if (requestedRole === user.role || (user.role === 'admin' && requestedRole === 'staff')) {
          socket.join(requestedRole);
        } else {
          console.warn(`[Security Alert] Socket ${socket.id} (User ID ${user.id}, Role ${user.role}) attempted unauthorized join to role: ${requestedRole}`);
        }
      });

      // 4. Prevent user channel spoofing
      socket.on('join_user', (targetUserId) => {
        if (String(targetUserId) === String(user.id) || user.role === 'admin') {
          socket.join(`user_${targetUserId}`);
        } else {
          console.warn(`[Security Alert] Socket ${socket.id} (User ID ${user.id}) attempted unauthorized join to user channel: user_${targetUserId}`);
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

