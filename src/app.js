const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const path     = require('path');

const authRoutes      = require('./routes/auth.routes');
const userRoutes      = require('./routes/users.routes');
const roomRoutes      = require('./routes/rooms.routes');
const serviceRoutes   = require('./routes/services.routes');
const activityRoutes  = require('./routes/activities.routes');
const bookingRoutes   = require('./routes/bookings.routes');
const billingRoutes   = require('./routes/billing.routes');
const reportRoutes      = require('./routes/reports.routes');
const motorcycleRoutes  = require('./routes/motorcycle.routes');
const courtRoutes       = require('./routes/courts.routes');
const auditRoutes       = require('./routes/audit.routes');
const notificationRoutes = require('./routes/notifications.routes');
const inquiryRoutes     = require('./routes/inquiries.routes');

const app = express();

// ── Security & Parsing ─────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Static uploads folder ──────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', process.env.UPLOADS_DIR || 'uploads')));

// ── Routes ─────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/rooms',         roomRoutes);
app.use('/api/services',      serviceRoutes);
app.use('/api/activities',    activityRoutes);
app.use('/api/motorcycles',   motorcycleRoutes);
app.use('/api/courts',        courtRoutes);
app.use('/api/bookings',      bookingRoutes);
app.use('/api/bills',         billingRoutes);
app.use('/api/reports',       reportRoutes);
app.use('/api/audit',         auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inquiries',     inquiryRoutes);



const pool = require('./config/db');

// ── Health & Status Dashboard ──────────────────────────────
app.get('/', async (req, res) => {
  let dbStatus = 'DISCONNECTED';
  let dbDetails = { name: process.env.DB_NAME || 'bhh', host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 3306, version: 'Unknown', tableCount: 0 };
  let dbError = null;

  try {
    const [rows] = await pool.query(
      "SELECT DATABASE() AS db, VERSION() AS version, (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ?) AS tableCount",
      [process.env.DB_NAME || 'bhh']
    );
    if (rows && rows.length > 0) {
      dbStatus = 'CONNECTED';
      dbDetails.name = rows[0].db || process.env.DB_NAME || 'bhh';
      dbDetails.version = rows[0].version;
      dbDetails.tableCount = rows[0].tableCount || 0;
    }
  } catch (err) {
    dbError = err.message;
  }

  const uptimeSeconds = Math.floor(process.uptime());
  const formatUptime = (sec) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${hrs > 0 ? hrs + 'h ' : ''}${mins}m ${s}s`;
  };

  if (req.accepts('html', 'json') === 'json') {
    return res.json({
      status: 'online',
      message: 'BHH Backend API is running',
      database: { status: dbStatus, ...dbDetails, error: dbError },
      uptime: formatUptime(uptimeSeconds),
      environment: process.env.NODE_ENV || 'development'
    });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BHH Backend API Status | 21st Dev Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --emerald: #10b981;
      --emerald-glow: rgba(16, 185, 129, 0.3);
      --rose: #f43f5e;
      --cyan: #06b6d4;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(99, 102, 241, 0.12) 0%, transparent 45%),
        radial-gradient(circle at 85% 85%, rgba(16, 185, 129, 0.1) 0%, transparent 45%);
      background-attachment: fixed;
    }
    .container {
      width: 100%;
      max-width: 880px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .logo-group {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .logo-icon {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, #6366f1, #06b6d4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.25rem;
      box-shadow: 0 8px 20px rgba(99, 102, 241, 0.35);
    }
    .title {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-radius: 9999px;
      font-size: 0.8125rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      backdrop-filter: blur(10px);
    }
    .badge-success {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      box-shadow: 0 0 15px var(--emerald-glow);
    }
    .badge-error {
      background: rgba(244, 63, 94, 0.12);
      border: 1px solid rgba(244, 63, 94, 0.3);
      color: #fb7185;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: currentColor;
      box-shadow: 0 0 8px currentColor;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem 1.5rem;
      backdrop-filter: blur(12px);
      transition: all 0.2s ease;
    }
    .card:hover {
      border-color: rgba(255, 255, 255, 0.18);
      transform: translateY(-2px);
    }
    .card-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    .card-value {
      font-size: 1.25rem;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      color: #fff;
    }
    .card-value.highlight {
      color: var(--cyan);
    }
    .status-banner {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 1.75rem;
      margin-bottom: 2rem;
      backdrop-filter: blur(12px);
      position: relative;
      overflow: hidden;
    }
    .status-banner::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg, var(--emerald), var(--cyan), var(--accent));
    }
    .banner-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .db-badge-large {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      border-radius: 12px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.05);
      margin-top: 0.75rem;
    }
    .endpoints-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: #fff;
    }
    .endpoints-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 0.875rem;
    }
    .endpoint-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.875rem 1.125rem;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      text-decoration: none;
      color: var(--text);
      transition: all 0.2s ease;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
    }
    .endpoint-item:hover {
      background: rgba(30, 41, 59, 0.8);
      border-color: var(--accent);
      transform: translateX(4px);
    }
    .method {
      font-weight: 700;
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      background: rgba(99, 102, 241, 0.2);
      color: #a5b4fc;
    }
    .footer {
      text-align: center;
      margin-top: 2.5rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="logo-group">
        <div class="logo-icon">BHH</div>
        <div>
          <h1 class="title">BHH Backend API</h1>
          <p class="subtitle">Batuan Hammock Hostel Core Service</p>
        </div>
      </div>
      <div class="badge ${dbStatus === 'CONNECTED' ? 'badge-success' : 'badge-error'}">
        <span class="pulse-dot"></span>
        DB ${dbStatus === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED'}
      </div>
    </header>

    <section class="status-banner">
      <div class="banner-title">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${dbStatus === 'CONNECTED' ? '#10b981' : '#f43f5e'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
        </svg>
        Database Connection Status
      </div>
      <div class="db-badge-large">
        <span class="pulse-dot" style="background-color: ${dbStatus === 'CONNECTED' ? '#10b981' : '#f43f5e'}; color: ${dbStatus === 'CONNECTED' ? '#10b981' : '#f43f5e'};"></span>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-family: 'JetBrains Mono', monospace;">
            MySQL Instance: <span style="color: var(--cyan);">${dbDetails.name}</span> @ ${dbDetails.host}:${dbDetails.port}
          </div>
          <div style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
            ${dbStatus === 'CONNECTED' 
              ? `Active & responding cleanly. MySQL ${dbDetails.version} • ${dbDetails.tableCount} tables in schema.` 
              : `Connection error: ${dbError || 'Unable to connect to MySQL database.'}`}
          </div>
        </div>
      </div>
    </section>

    <div class="grid">
      <div class="card">
        <div class="card-label">Server Uptime</div>
        <div class="card-value highlight">${formatUptime(uptimeSeconds)}</div>
      </div>
      <div class="card">
        <div class="card-label">Environment</div>
        <div class="card-value">${process.env.NODE_ENV || 'development'}</div>
      </div>
      <div class="card">
        <div class="card-label">Database Target</div>
        <div class="card-value" style="color: var(--emerald);">${dbDetails.name}</div>
      </div>
      <div class="card">
        <div class="card-label">API Version</div>
        <div class="card-value">v1.0.0</div>
      </div>
    </div>

    <section>
      <h2 class="endpoints-title">Quick Endpoint Explorer</h2>
      <div class="endpoints-grid">
        <a href="/api/health" target="_blank" class="endpoint-item">
          <span>/api/health</span>
          <span class="method">GET</span>
        </a>
        <a href="/api/rooms/catalog" target="_blank" class="endpoint-item">
          <span>/api/rooms/catalog</span>
          <span class="method">GET</span>
        </a>
        <a href="/api/services" target="_blank" class="endpoint-item">
          <span>/api/services</span>
          <span class="method">GET</span>
        </a>
        <a href="/api/activities" target="_blank" class="endpoint-item">
          <span>/api/activities</span>
          <span class="method">GET</span>
        </a>
      </div>
    </section>

    <footer class="footer">
      Batuan Hammock Hostel System • 21st Dev Architecture
    </footer>
  </div>
</body>
</html>`;

  res.send(html);
});

// ── Health check ────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch (err) {
    dbOk = false;
  }

  res.json({
    status: 'ok',
    database: dbOk ? 'connected' : 'disconnected',
    targetDatabase: process.env.DB_NAME || 'bhh',
    timestamp: new Date().toISOString()
  });
});

// ── 404 handler ─────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));

// ── Global error handler ────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error.', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

module.exports = app;
