/**
 * Convert a local MySQL/SQLyog dump into a Hostinger-compatible SQL file,
 * and (optionally) import it into the database configured in .env.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const input = process.argv[2];
const doImport = process.argv.includes('--import');
if (!input) {
  console.error('Usage: node scripts/hostinger-db-import.js "<input.sql>" [--import]');
  process.exit(1);
}

// ── 1. Convert ─────────────────────────────────────────────
function convert(sql) {
  let out = sql
    // Remove database creation / selection (Hostinger DB already exists)
    .replace(/^CREATE DATABASE\b.*?;\s*$/gim, '')
    .replace(/^USE\s+`[^`]+`\s*;\s*$/gim, '')
    // Strip DEFINER clauses (procedures, functions, views, triggers, events)
    .replace(/DEFINER\s*=\s*`[^`]*`\s*@\s*`[^`]*`\s*/gi, '')
    .replace(/DEFINER\s*=\s*CURRENT_USER(\(\))?\s*/gi, '')
    // Use utf8mb4 for the import session
    .replace(/SET NAMES utf8\b(?!mb4)/gi, 'SET NAMES utf8mb4');

  const header =
    '-- Converted for Hostinger (MariaDB/MySQL shared hosting)\n' +
    `-- Source: ${path.basename(input)}  |  Generated: ${new Date().toISOString()}\n` +
    '-- Import via hPanel > Databases > phpMyAdmin > select your DB > Import\n\n';
  return header + out;
}

// ── 2. Split into statements ──────────────────────────────
function parseSqlStatements(sql) {
  const lines = sql.split(/\r?\n/);
  const statements = [];
  let inRoutine = false;
  let routineLines = [];
  let standardBuf = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip DELIMITER commands since mysql2 runs statements individually
    if (/^DELIMITER\s+/i.test(trimmed)) {
      continue;
    }

    // Check for routine start
    if (!inRoutine && /CREATE\s+(PROCEDURE|FUNCTION)\s+/i.test(trimmed)) {
      // Flush any standard buffer
      if (standardBuf.length > 0) {
        const chunk = standardBuf.join('\n').trim();
        if (chunk) statements.push(chunk);
        standardBuf = [];
      }
      inRoutine = true;
      routineLines = [rawLine];
      continue;
    }

    if (inRoutine) {
      // Check for routine end marker ($$)
      if (/\$\$\s*$/.test(trimmed) || /\bend\s*\*\/\$\$/i.test(trimmed)) {
        const cleanedEnd = rawLine.replace(/\*\/\$\$.*$/, '*/').replace(/\$\$.*$/, '');
        routineLines.push(cleanedEnd);
        const routineStmt = routineLines.join('\n').trim();
        if (routineStmt) statements.push(routineStmt);
        inRoutine = false;
        routineLines = [];
      } else {
        routineLines.push(rawLine);
      }
      continue;
    }

    // Standard DDL / DML ending with ;
    standardBuf.push(rawLine);
    if (trimmed.endsWith(';')) {
      const stmt = standardBuf.join('\n').trim();
      if (stmt) statements.push(stmt);
      standardBuf = [];
    }
  }

  if (standardBuf.length > 0) {
    const remainder = standardBuf.join('\n').trim();
    if (remainder) statements.push(remainder);
  }

  return statements;
}

// ── 3. Import ──────────────────────────────────────────────
async function runImport(sql) {
  const mysql = require('mysql2/promise');
  const useSsl = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    connectTimeout: 20000,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  console.log(`Connected to ${process.env.DB_USER}@${process.env.DB_HOST}/${process.env.DB_NAME}`);
  const statements = parseSqlStatements(sql);
  console.log(`Executing ${statements.length} statements...`);

  let ok = 0;
  const failures = [];
  for (let idx = 0; idx < statements.length; idx++) {
    const stmt = statements[idx];
    try {
      await conn.query(stmt);
      ok++;
    } catch (err) {
      failures.push({ idx, err: `${err.code}: ${err.message}`, preview: stmt.slice(0, 160).replace(/\s+/g, ' ') });
    }
    if ((idx + 1) % 25 === 0 || idx === statements.length - 1) {
      process.stdout.write(`  ${idx + 1}/${statements.length} statements processed\r`);
    }
  }

  console.log(`\nDone: ${ok} succeeded, ${failures.length} failed.`);
  failures.forEach(f => console.log(`  ✗ #${f.idx} ${f.err}\n      ${f.preview}`));

  const [tables] = await conn.query(
    'SELECT table_name AS t, table_rows AS r FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name'
  );
  const [[routines]] = await conn.query(
    'SELECT COUNT(*) AS c FROM information_schema.routines WHERE routine_schema = DATABASE()'
  );
  console.log(`\nFinal state in Hostinger DB:`);
  console.log(`  Tables: ${tables.length}`);
  console.log(`  Stored Procedures & Functions: ${routines.c}`);
  await conn.end();
  return failures.length;
}

(async () => {
  const src = fs.readFileSync(input, 'utf8');
  const converted = convert(src);
  const parsed = path.parse(input);
  const outFile = path.join(parsed.dir, `${parsed.name.replace(/\s+/g, '_')}_hostinger${parsed.ext}`);
  fs.writeFileSync(outFile, converted, 'utf8');
  console.log(`Converted file written: ${outFile}`);

  if (doImport) {
    const failed = await runImport(converted);
    process.exit(failed ? 1 : 0);
  }
})().catch(err => {
  console.error('ERROR:', err.code || '', err.message);
  process.exit(1);
});
