const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { config } = require('../config/env');

async function runMigration() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    multipleStatements: true // This is crucial for DELIMITER and multiple queries
  });

  try {
    const sqlPath = path.join(__dirname, 'migrations', 'add_reviews_table.sql');
    let sql = fs.readFileSync(sqlPath, 'utf8');

    // MySQL2 doesn't understand DELIMITER. We need to strip it out and manually split or just run the whole thing without DELIMITER.
    // Let's rewrite the SQL to remove DELIMITER // since mysql2 with multipleStatements: true can handle multiple stored procedures if they are separated by normal delimiters like ;
    // Wait, multipleStatements: true just uses ;
    // Let's use the raw statements separated by ;
    
    // Instead of parsing, we can just rewrite the SQL file in memory for mysql2
    sql = sql.replace(/DELIMITER \/\//g, '')
             .replace(/\/\//g, ';')
             .replace(/DELIMITER ;/g, '');

    console.log('Running migration...');
    await connection.query(sql);
    console.log('Migration successful!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await connection.end();
  }
}

runMigration();
