const pool = require('../../src/config/db');

async function migrateLostAndFound() {
  console.log('--- STARTING LOST & FOUND MIGRATION ---');

  try {
    console.log('Creating lost_and_found table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lost_and_found (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_name VARCHAR(255) NOT NULL,
        description TEXT,
        found_location VARCHAR(255) NOT NULL,
        found_date DATE NOT NULL,
        status ENUM('Found', 'Claimed', 'Discarded') DEFAULT 'Found',
        image_url VARCHAR(500),
        logged_by INT,
        claimed_by_name VARCHAR(255),
        claimed_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (logged_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    console.log('Creating sp_upsert_lost_item...');
    await pool.query('DROP PROCEDURE IF EXISTS sp_upsert_lost_item');
    await pool.query(`
      CREATE PROCEDURE sp_upsert_lost_item(
        IN p_id INT,
        IN p_item_name VARCHAR(255),
        IN p_description TEXT,
        IN p_found_location VARCHAR(255),
        IN p_found_date DATE,
        IN p_image_url VARCHAR(500),
        IN p_logged_by INT
      )
      BEGIN
        IF p_id IS NULL THEN
          INSERT INTO lost_and_found (item_name, description, found_location, found_date, image_url, logged_by, status)
          VALUES (p_item_name, p_description, p_found_location, p_found_date, p_image_url, p_logged_by, 'Found');
          SELECT LAST_INSERT_ID() AS id;
        ELSE
          UPDATE lost_and_found
          SET 
            item_name = COALESCE(p_item_name, item_name),
            description = COALESCE(p_description, description),
            found_location = COALESCE(p_found_location, found_location),
            found_date = COALESCE(p_found_date, found_date),
            image_url = COALESCE(p_image_url, image_url)
          WHERE id = p_id;
          SELECT p_id AS id;
        END IF;
      END
    `);

    console.log('Creating sp_update_lost_item_status...');
    await pool.query('DROP PROCEDURE IF EXISTS sp_update_lost_item_status');
    await pool.query(`
      CREATE PROCEDURE sp_update_lost_item_status(
        IN p_id INT,
        IN p_status ENUM('Found', 'Claimed', 'Discarded'),
        IN p_claimed_by_name VARCHAR(255)
      )
      BEGIN
        UPDATE lost_and_found
        SET 
          status = p_status,
          claimed_by_name = IF(p_status = 'Claimed', p_claimed_by_name, claimed_by_name),
          claimed_date = IF(p_status = 'Claimed', CURDATE(), claimed_date)
        WHERE id = p_id;
      END
    `);

    console.log('Creating sp_get_lost_items...');
    await pool.query('DROP PROCEDURE IF EXISTS sp_get_lost_items');
    await pool.query(`
      CREATE PROCEDURE sp_get_lost_items(
        IN p_status ENUM('Found', 'Claimed', 'Discarded')
      )
      BEGIN
        SELECT 
          lf.id, lf.item_name, lf.description, lf.found_location, lf.found_date, 
          lf.status, lf.image_url, lf.claimed_by_name, lf.claimed_date, lf.created_at,
          u.full_name as logged_by_name
        FROM lost_and_found lf
        LEFT JOIN users u ON u.id = lf.logged_by
        WHERE (p_status IS NULL OR lf.status = p_status)
        ORDER BY lf.created_at DESC;
      END
    `);

    console.log('--- LOST & FOUND MIGRATION COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrateLostAndFound();
