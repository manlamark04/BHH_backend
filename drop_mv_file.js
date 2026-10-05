require('dotenv').config();
const mysql = require('mysql2/promise');
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'bhh',
  user: process.env.DB_USER || 'bhh',
  password: process.env.DB_PASSWORD || 'bhh',
};
async function alter() {
  const connection = await mysql.createConnection(DB_CONFIG);
  try {
    await connection.query('ALTER TABLE motorcycles DROP COLUMN mv_file_number');
    console.log('Column mv_file_number dropped successfully');
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}
alter();
