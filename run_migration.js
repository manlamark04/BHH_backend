const pool = require('./src/config/db');
const fs = require('fs');
const path = require('path');

async function migrate() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrate_approvals.sql'), 'utf-8');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      console.log(`Executing: ${stmt}`);
      const [res] = await pool.query(stmt);
      console.log(`Affected rows: ${res.affectedRows}`);
    }
    console.log('Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

migrate();
