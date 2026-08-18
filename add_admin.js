require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'bhh',
  user: process.env.DB_USER || 'bhh',
  password: process.env.DB_PASSWORD || 'bhh',
};

// Arguments or defaults
const args = process.argv.slice(2);
const username = args[0] || 'admin';
const password = args[1] || 'Admin@123';
const email = args[2] || 'admin@bhh.com';
const fullName = args[3] || 'System Administrator';

async function createOrUpdateAdmin() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Connected to database:', DB_CONFIG.database);

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Check if user with username or email already exists
    const [existing] = await connection.query(
      'SELECT id, unique_id, role, username, email FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existing && existing.length > 0) {
      const user = existing[0];
      await connection.query(
        `UPDATE users 
         SET password_hash = ?, 
             role = 'admin', 
             status = 'active', 
             must_change_password = FALSE,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [passwordHash, user.id]
      );

      console.log('\n========================================');
      console.log('🎉 Existing account updated to ADMIN!');
      console.log('========================================');
      console.log(`🆔 User ID  : ${user.unique_id || user.id}`);
      console.log(`👤 Username : ${username}`);
      console.log(`📧 Email    : ${email}`);
      console.log(`🔑 Password : ${password}`);
      console.log(`🛡️ Role     : admin`);
      console.log(`✅ Status   : active`);
      console.log('========================================\n');
    } else {
      // Generate unique ID
      let uniqueId = `ADM-${new Date().getFullYear()}-0001`;
      try {
        const [rows] = await connection.query("CALL sp_generate_user_id('admin', @uid)");
        const [res] = await connection.query('SELECT @uid as uid');
        if (res && res[0] && res[0].uid) {
          uniqueId = res[0].uid;
        }
      } catch (e) {
        // Fallback to manual ID if SP is not available
        const [countRow] = await connection.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
        const count = countRow[0].count + 1;
        uniqueId = `ADM-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;
      }

      const [result] = await connection.query(
        `INSERT INTO users (
          unique_id, role, full_name, email, phone, 
          username, password_hash, must_change_password, status
        ) VALUES (?, 'admin', ?, ?, '+63 917 000 0000', ?, ?, FALSE, 'active')`,
        [uniqueId, fullName, email, username, passwordHash]
      );

      console.log('\n========================================');
      console.log('🎉 New ADMIN account created successfully!');
      console.log('========================================');
      console.log(`🆔 User ID  : ${uniqueId}`);
      console.log(`👤 Username : ${username}`);
      console.log(`📧 Email    : ${email}`);
      console.log(`🔑 Password : ${password}`);
      console.log(`🛡️ Role     : admin`);
      console.log(`✅ Status   : active`);
      console.log('========================================\n');
    }
  } catch (err) {
    console.error('❌ Error creating admin user:', err.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

createOrUpdateAdmin();
