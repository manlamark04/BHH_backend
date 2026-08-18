require('dotenv').config();
const app  = require('./src/app');
const pool = require('./src/config/db');
const bcrypt = require('bcryptjs');
const db   = require('./src/db/procedures');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;

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
  const dir = path.join(__dirname, process.env.UPLOADS_DIR || 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');

    await ensureUploadsDir();
    await seedInitialAdmin();

    const { startScheduler } = require('./src/services/scheduler');
    startScheduler(60000); // 1 minute auto-cancel check

    app.listen(PORT, () => {
      console.log(`🚀 BHH Backend running on http://localhost:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
