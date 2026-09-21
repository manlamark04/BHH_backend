const axios = require('axios');

async function testCheckout() {
  try {
    const res = await axios.post('http://localhost:5000/api/pos/checkout', {
      items: [
        { product_id: 1, quantity: 1 }
      ],
      payment_method: 'cash'
    }, {
      headers: {
        'Authorization': 'Bearer test-token-admin' // wait, I don't have a token. I'll test directly on db.
      }
    });
    console.log(res.data);
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}
testCheckout();
