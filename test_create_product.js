const pool = require('./src/config/db');

async function test() {
  try {
    const [result] = await pool.query(
      `INSERT INTO pos_products (category_id, name, sku, barcode, description, price, stock_quantity, reorder_level, image_url, has_variants)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [1, 'Test Product', null, null, null, 100, 0, 5, null, 1]
    );
    console.log('Success:', result);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit();
  }
}

test();
