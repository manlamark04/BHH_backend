const pool = require('../../src/config/db');

async function migrateExpenses() {
  console.log('--- STARTING EXPENSES MIGRATION ---');

  try {
    // 1. Create expenses table
    console.log('Creating expenses table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        amount DECIMAL(10, 2) NOT NULL,
        category VARCHAR(50) NOT NULL,
        description TEXT,
        logged_by INT,
        expense_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (logged_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // 2. Create SP for inserting an expense
    console.log('Creating sp_add_expense...');
    await pool.query('DROP PROCEDURE IF EXISTS sp_add_expense');
    await pool.query(`
      CREATE PROCEDURE sp_add_expense(
        IN p_amount DECIMAL(10, 2),
        IN p_category VARCHAR(50),
        IN p_description TEXT,
        IN p_logged_by INT,
        IN p_expense_date DATE
      )
      BEGIN
        INSERT INTO expenses (amount, category, description, logged_by, expense_date)
        VALUES (p_amount, p_category, p_description, p_logged_by, COALESCE(p_expense_date, CURDATE()));
        
        SELECT LAST_INSERT_ID() as id;
      END
    `);

    // 3. Create SP for getting expenses by date range
    console.log('Creating sp_get_expenses...');
    await pool.query('DROP PROCEDURE IF EXISTS sp_get_expenses');
    await pool.query(`
      CREATE PROCEDURE sp_get_expenses(
        IN p_start_date DATE,
        IN p_end_date DATE
      )
      BEGIN
        SELECT 
          e.id, e.amount, e.category, e.description, e.expense_date, e.created_at,
          u.full_name as logged_by_name
        FROM expenses e
        LEFT JOIN users u ON u.id = e.logged_by
        WHERE (p_start_date IS NULL OR e.expense_date >= p_start_date)
          AND (p_end_date IS NULL OR e.expense_date <= p_end_date)
        ORDER BY e.created_at DESC;
      END
    `);

    console.log('--- EXPENSES MIGRATION COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrateExpenses();
