-- POS and Inventory Tables Migration

CREATE TABLE IF NOT EXISTS pos_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  sku VARCHAR(50) UNIQUE,
  barcode VARCHAR(100) UNIQUE,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  stock_quantity INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 5,
  image_url VARCHAR(255),
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES pos_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pos_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(50) NOT NULL UNIQUE,
  cashier_id INT NOT NULL,
  customer_id INT NULL,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  payment_method ENUM('cash', 'card', 'e-wallet', 'room_charge') DEFAULT 'cash',
  status ENUM('completed', 'refunded', 'cancelled') DEFAULT 'completed',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (cashier_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pos_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES pos_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES pos_products(id)
);

-- Seed some default categories
INSERT IGNORE INTO pos_categories (name, description) VALUES 
('Beverages', 'Cold and hot drinks'),
('Snacks', 'Chips, biscuits, and quick bites'),
('Toiletries', 'Essential hygiene products'),
('Merchandise', 'Hostel branded items and souvenirs');
