const { config } = require('./src/config/env');
const app        = require('./src/app');
const pool       = require('./src/config/db');
const bcrypt     = require('bcryptjs');
const db         = require('./src/db/procedures');
const fs         = require('fs');
const path       = require('path');
const http       = require('http');
const socketConfig = require('./src/config/socket');

const PORT = config.port;

async function seedInitialAdmin() {
  try {
    const existing = await db.users.getAll('admin');
    if (existing.length === 0) {
      const hash = await bcrypt.hash('user123', 12);
      await db.users.create('admin', 'System Admin', 'admin@bhh.com', null, 'admin', hash, null, null);
      // Auto-approve the first admin
      const adminUser = await db.auth.login('admin');
      if (adminUser) {
        // Directly update status since no admin exists yet to approve
        await pool.query("UPDATE users SET status = 'active' WHERE username = 'admin'");
        console.log('✅ Initial admin seeded: admin@bhh.com / user123 (CHANGE ON FIRST LOGIN)');
      }
    }
  } catch (err) {
    console.warn('Admin seed skipped (may already exist):', err.message);
  }
}

async function ensureUploadsDir() {
  if (process.env.VERCEL) return;
  try {
    const dir = path.join(__dirname, config.uploadsDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // Ignore on read-only filesystems
  }
}

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');

    await ensureUploadsDir();
    await seedInitialAdmin();

    const { startScheduler } = require('./src/services/scheduler');
    startScheduler(60000); // 1 minute auto-cancel check

    const server = http.createServer(app);
    socketConfig.init(server);

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 BHH Backend running on port ${PORT}`);
      console.log(`   Environment: ${config.env}`);
    });

    // Graceful shutdown (Render sends SIGTERM on redeploy)
    const shutdown = (signal) => {
      console.log(`${signal} received, shutting down...`);
      server.close(async () => {
        try { await pool.end(); } catch (_) { /* ignore */ }
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module && !process.env.VERCEL) {
  start();
}

module.exports = app;
