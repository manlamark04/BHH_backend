const pool = require('../config/db');

// Categories
async function getCategories(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM pos_categories ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

async function createCategory(req, res) {
  try {
    const { name, description } = req.body;
    const [result] = await pool.query(
      'INSERT INTO pos_categories (name, description) VALUES (?, ?)',
      [name, description || null]
    );
    res.status(201).json({ id: result.insertId, name, description });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// Products
async function getProducts(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, c.name as category_name 
      FROM pos_products p 
      LEFT JOIN pos_categories c ON p.category_id = c.id
      ORDER BY p.name ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

async function createProduct(req, res) {
  try {
    const { category_id, name, sku, barcode, description, price, stock_quantity, reorder_level } = req.body;
    let has_variants = req.body.has_variants;
    if (typeof has_variants === 'string') has_variants = has_variants === 'true' || has_variants === '1';
    else has_variants = !!has_variants;
    let image_url = req.body.image_url || null;
    if (req.file) {
      image_url = `/uploads/${req.file.filename}`;
    }
    const [result] = await pool.query(
      `INSERT INTO pos_products (category_id, name, sku, barcode, description, price, stock_quantity, reorder_level, image_url, has_variants)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [category_id, name, sku || null, barcode || null, description || null, price || 0, stock_quantity || 0, reorder_level || 5, image_url, has_variants]
    );
    res.status(201).json({ message: 'Product created successfully', id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { category_id, name, sku, barcode, description, price, stock_quantity, reorder_level, status } = req.body;
    let has_variants = req.body.has_variants;
    if (typeof has_variants === 'string') has_variants = has_variants === 'true' || has_variants === '1';
    else if (has_variants === undefined) has_variants = false;
    else has_variants = !!has_variants;
    
    let image_url = req.body.image_url || null;
    if (req.file) {
      image_url = `/uploads/${req.file.filename}`;
    }
    
    await pool.query(
      `UPDATE pos_products 
       SET category_id=?, name=?, sku=?, barcode=?, description=?, price=?, stock_quantity=?, reorder_level=?, status=?, has_variants=? ${req.file ? ', image_url=?' : ''}
       WHERE id=?`,
      req.file 
        ? [category_id, name, sku || null, barcode || null, description || null, price, stock_quantity, reorder_level, status || 'active', has_variants, image_url, id]
        : [category_id, name, sku || null, barcode || null, description || null, price, stock_quantity, reorder_level, status || 'active', has_variants, id]
    );
    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM pos_products WHERE id = ?', [id]);
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

async function updateStock(req, res) {
  try {
    const { id } = req.params;
    const { adjustment } = req.body; // e.g. +5 or -2
    
    if (typeof adjustment !== 'number') {
      return res.status(400).json({ message: 'Adjustment must be a number' });
    }
    
    await pool.query(
      `UPDATE pos_products SET stock_quantity = stock_quantity + ? WHERE id = ?`,
      [adjustment, id]
    );
    res.json({ message: 'Stock updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POS Checkout
async function checkout(req, res) {
  const conn = await pool.getConnection();
  try {
    const { items, payment_method, customer_id, notes } = req.body;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    await conn.beginTransaction();

    // 1. Generate Order Number
    const orderNumber = `POS-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
    let totalAmount = 0;

    // 2. Validate items & calculate total
    for (const item of items) {
      // Check stock and price
      const [prodRows] = await conn.query('SELECT price, stock_quantity, name FROM pos_products WHERE id = ? FOR UPDATE', [item.product_id]);
      if (prodRows.length === 0) throw new Error(`Product ID ${item.product_id} not found.`);
      
      const product = prodRows[0];
      if (product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Only ${product.stock_quantity} left.`);
      }
      
      const subtotal = product.price * item.quantity;
      totalAmount += subtotal;
      
      // We attach the validated price for insertion later
      item.validated_price = product.price;
      item.validated_subtotal = subtotal;
    }

    // 3. Create Order
    const [orderRes] = await conn.query(
      `INSERT INTO pos_orders (order_number, cashier_id, customer_id, total_amount, payment_method, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderNumber, req.user.id, customer_id || null, totalAmount, payment_method || 'cash', notes || null]
    );
    const orderId = orderRes.insertId;

    // 4. Create Order Items & Deduct Stock
    for (const item of items) {
      await conn.query(
        `INSERT INTO pos_order_items (order_id, product_id, quantity, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.quantity, item.validated_price, item.validated_subtotal]
      );
      
      await conn.query(
        `UPDATE pos_products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
        [item.quantity, item.product_id]
      );
    }

    await conn.commit();
    res.status(201).json({ message: 'Checkout successful', order_id: orderId, order_number: orderNumber });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
}

// Reporting
async function getOrders(req, res) {
  try {
    const { date } = req.query; // YYYY-MM-DD
    let sql = `
      SELECT o.*, u.full_name as cashier_name, c.full_name as customer_name
      FROM pos_orders o
      LEFT JOIN users u ON o.cashier_id = u.id
      LEFT JOIN users c ON o.customer_id = c.id
    `;
    const params = [];
    
    if (date) {
      sql += ` WHERE DATE(o.created_at) = ?`;
      params.push(date);
    }
    
    sql += ` ORDER BY o.created_at DESC`;
    
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

async function getOrderItems(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT oi.*, p.name as product_name
       FROM pos_order_items oi
       JOIN pos_products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

async function getMyOrders(req, res) {
  try {
    const customerId = req.user.id;
    // Get orders
    const [orders] = await pool.query(
      `SELECT o.*, 
              c.full_name as cashier_name
       FROM pos_orders o
       LEFT JOIN users c ON o.cashier_id = c.id
       WHERE o.customer_id = ?
       ORDER BY o.created_at DESC`,
      [customerId]
    );

    if (orders.length === 0) {
      return res.json([]);
    }

    const orderIds = orders.map(o => o.id);
    const [items] = await pool.query(
      `SELECT oi.*, p.name as product_name
       FROM pos_order_items oi
       JOIN pos_products p ON oi.product_id = p.id
       WHERE oi.order_id IN (?)`,
      [orderIds]
    );

    // Group items by order
    const itemsByOrder = items.reduce((acc, item) => {
      if (!acc[item.order_id]) acc[item.order_id] = [];
      acc[item.order_id].push(item);
      return acc;
    }, {});

    const enrichedOrders = orders.map(order => ({
      ...order,
      items: itemsByOrder[order.id] || []
    }));

    res.json(enrichedOrders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getCategories,
  createCategory,
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  updateStock,
  checkout,
  getOrders,
  getOrderItems,
  getMyOrders
};
