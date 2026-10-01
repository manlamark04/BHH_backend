const axios = require('axios');
const pool = require('./src/config/db');

async function test() {
  try {
    const [users] = await pool.query('SELECT id FROM users WHERE role IN ("admin", "staff") LIMIT 1');
    const userId = users[0].id;
    
    // Create a token (we need to know how auth works)
    // Actually, I can just require the auth service or manually sign a JWT
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: userId, role: 'staff' }, process.env.JWT_SECRET || 'secret');
    
    const res = await axios.post('http://localhost:5000/api/pos/checkout', {
      items: [ { product_id: 1, quantity: 1 } ],
      payment_method: 'cash'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Success:', res.data);
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  } finally {
    process.exit();
  }
}
test();
