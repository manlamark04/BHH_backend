CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  rating INT NOT NULL CHECK(rating >= 1 AND rating <= 5),
  comment TEXT,
  is_published BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

DELIMITER //

DROP PROCEDURE IF EXISTS sp_create_review //
CREATE PROCEDURE sp_create_review(
    IN p_customer_id INT,
    IN p_rating INT,
    IN p_comment TEXT
)
BEGIN
    INSERT INTO reviews (customer_id, rating, comment)
    VALUES (p_customer_id, p_rating, p_comment);
    
    SELECT LAST_INSERT_ID() AS id;
END //

DROP PROCEDURE IF EXISTS sp_get_all_reviews //
CREATE PROCEDURE sp_get_all_reviews()
BEGIN
    SELECT r.id, r.customer_id, u.full_name as customer_name, u.profile_photo_url, r.rating, r.comment, r.is_published, r.created_at
    FROM reviews r
    JOIN users u ON r.customer_id = u.id
    ORDER BY r.created_at DESC;
END //

DROP PROCEDURE IF EXISTS sp_get_customer_reviews //
CREATE PROCEDURE sp_get_customer_reviews(IN p_customer_id INT)
BEGIN
    SELECT r.id, r.customer_id, u.full_name as customer_name, u.profile_photo_url, r.rating, r.comment, r.is_published, r.created_at
    FROM reviews r
    JOIN users u ON r.customer_id = u.id
    WHERE r.customer_id = p_customer_id
    ORDER BY r.created_at DESC;
END //

DROP PROCEDURE IF EXISTS sp_toggle_review_visibility //
CREATE PROCEDURE sp_toggle_review_visibility(IN p_review_id INT)
BEGIN
    UPDATE reviews
    SET is_published = NOT is_published
    WHERE id = p_review_id;
    
    SELECT id, is_published FROM reviews WHERE id = p_review_id;
END //

DELIMITER ;
