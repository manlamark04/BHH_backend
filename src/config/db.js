const mysql = require('mysql2/promise');
const { config } = require('./env');

// Enable TLS for managed/remote MySQL providers (set DB_SSL=true)
const useSsl = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';
const ssl = useSsl
  ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false' }
  : undefined;

const pool = mysql.createPool({
  host:               config.db.host,
  port:               config.db.port,
  database:           config.db.name,
  user:               config.db.user,
  password:           config.db.password,
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,
  ...(ssl ? { ssl } : {}),
});

module.exports = pool;
