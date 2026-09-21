const pool = require('./src/config/db');

async function checkout() {
  const conn = await pool.getConnection();
  try {
    const items = [{ product_id: 1, quantity: 1 }];
    
    await conn.beginTransaction();

    for (const item of items) {
      const [prodRows] = await conn.query('SELECT price, stock_quantity, name, has_variants FROM pos_products WHERE id = ? FOR UPDATE', [item.product_id]);
      if (prodRows.length === 0) throw new Error(`Product ID ${item.product_id} not found.`);
      
      const product = prodRows[0];
      console.log('Product:', product);
      if (product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Only ${product.stock_quantity} left.`);
      }
    }
    await conn.rollback();
    console.log('Success');
  } catch (err) {
    await conn.rollback();
    console.error('Error:', err.message);
  } finally {
    conn.release();
    process.exit();
  }
}
checkout();
