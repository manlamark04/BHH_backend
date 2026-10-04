const jwt = require('jsonwebtoken');
require('dotenv').config();

const token = jwt.sign(
  { id: 1, role: 'staff', username: 'admin' },
  process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this',
  { expiresIn: '1h' }
);
console.log("TOKEN:", token);
