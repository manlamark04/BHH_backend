-- ============================================================
-- Batuan Hammock Hostel (BHH) — Full Database Schema
-- MySQL 8.0+ — Tables, ENUMs (inlined), Stored Procedures
-- All backend controllers must use stored procedures ONLY.
-- Migrated from PostgreSQL (BHH_schema.sql)
-- ============================================================

-- ============================================================
-- 0. DATABASE / CHARACTER SET
-- ============================================================
CREATE DATABASE IF NOT EXISTS bhh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bhh;

-- ============================================================
-- 1. TABLES
--    ENUMs are inlined directly into column definitions.
--    SERIAL   → INT AUTO_INCREMENT
--    TIMESTAMPTZ → DATETIME (stored in UTC at app layer)
--    TEXT[]   → JSON (default '[]')
--    JSONB    → JSON
-- ============================================================

-- 2.1 Users
CREATE TABLE IF NOT EXISTS users (
  id                   INT           AUTO_INCREMENT PRIMARY KEY,
  unique_id            VARCHAR(20)   UNIQUE NOT NULL,
  role                 ENUM('customer','staff','admin') NOT NULL,
  full_name            VARCHAR(255)  NOT NULL,
  email                VARCHAR(255)  UNIQUE NOT NULL,
  phone                VARCHAR(30),
  username             VARCHAR(100)  UNIQUE NOT NULL,
  password_hash        TEXT          NOT NULL,
  must_change_password BOOLEAN       NOT NULL DEFAULT TRUE,
  status               ENUM('pending','active','disabled','rejected') NOT NULL DEFAULT 'pending',
  valid_id_path        TEXT,
  created_by           INT           REFERENCES users(id) ON DELETE SET NULL,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_users_unique_id (unique_id),
  INDEX idx_users_email     (email),
  INDEX idx_users_status    (status),
  INDEX idx_users_role      (role)
) ENGINE=InnoDB;

-- 2.2 Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id             INT           AUTO_INCREMENT PRIMARY KEY,
  room_number    VARCHAR(20)   UNIQUE NOT NULL,
  room_type      VARCHAR(100)  NOT NULL,
  capacity       INT           NOT NULL DEFAULT 1,
  rate_per_night DECIMAL(10,2) NOT NULL,
  status         ENUM('available','occupied','maintenance') NOT NULL DEFAULT 'available',
  description    TEXT,
  image_urls     JSON          DEFAULT NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2.3 Services
CREATE TABLE IF NOT EXISTS services (
  id          INT           AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150)  NOT NULL,
  description TEXT,
  price       DECIMAL(10,2),
  icon_url    TEXT,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2.4 Activities
CREATE TABLE IF NOT EXISTS activities (
  id              INT           AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150)  NOT NULL,
  activity_type   VARCHAR(100),
  price_per_unit  DECIMAL(10,2) NOT NULL,
  unit            VARCHAR(30)   NOT NULL DEFAULT 'hour',
  inventory_count INT           NOT NULL DEFAULT 1,
  description     TEXT,
  image_url       TEXT,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2.5 Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id          INT           AUTO_INCREMENT PRIMARY KEY,
  customer_id INT           NOT NULL,
  room_id     INT           NOT NULL,
  check_in    DATE          NOT NULL,
  check_out   DATE          NOT NULL,
  status      ENUM('requested','confirmed','checked_in','checked_out','cancelled') NOT NULL DEFAULT 'requested',
  notes       TEXT,
  created_by  INT,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT chk_booking_dates CHECK (check_out > check_in),
  CONSTRAINT fk_bookings_customer  FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_bookings_room      FOREIGN KEY (room_id)     REFERENCES rooms(id),
  CONSTRAINT fk_bookings_createdby FOREIGN KEY (created_by)  REFERENCES users(id),

  INDEX idx_bookings_customer (customer_id),
  INDEX idx_bookings_room     (room_id),
  INDEX idx_bookings_dates    (check_in, check_out)
) ENGINE=InnoDB;

-- 2.6 Activity Rentals
CREATE TABLE IF NOT EXISTS activity_rentals (
  id          INT      AUTO_INCREMENT PRIMARY KEY,
  customer_id INT      NOT NULL,
  activity_id INT      NOT NULL,
  start_time  DATETIME NOT NULL,
  end_time    DATETIME NOT NULL,
  status      ENUM('requested','confirmed','active','completed','cancelled') NOT NULL DEFAULT 'requested',
  notes       TEXT,
  created_by  INT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT chk_rental_times       CHECK (end_time > start_time),
  CONSTRAINT fk_rentals_customer    FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_rentals_activity    FOREIGN KEY (activity_id) REFERENCES activities(id),
  CONSTRAINT fk_rentals_createdby   FOREIGN KEY (created_by)  REFERENCES users(id),

  INDEX idx_rentals_customer (customer_id),
  INDEX idx_rentals_activity (activity_id)
) ENGINE=InnoDB;

-- 2.7 Bills
CREATE TABLE IF NOT EXISTS bills (
  id                 INT           AUTO_INCREMENT PRIMARY KEY,
  bill_number        VARCHAR(50)   UNIQUE NOT NULL,
  customer_id        INT           NOT NULL,
  booking_id         INT,
  activity_rental_id INT,
  total_amount       DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  status             ENUM('unpaid','partially_paid','paid') NOT NULL DEFAULT 'unpaid',
  issued_by          INT           NOT NULL,
  issued_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT chk_bill_source CHECK (booking_id IS NOT NULL OR activity_rental_id IS NOT NULL),
  CONSTRAINT fk_bills_customer   FOREIGN KEY (customer_id)        REFERENCES users(id),
  CONSTRAINT fk_bills_booking    FOREIGN KEY (booking_id)         REFERENCES bookings(id),
  CONSTRAINT fk_bills_rental     FOREIGN KEY (activity_rental_id) REFERENCES activity_rentals(id),
  CONSTRAINT fk_bills_issued_by  FOREIGN KEY (issued_by)          REFERENCES users(id),

  INDEX idx_bills_customer (customer_id),
  INDEX idx_bills_status   (status)
) ENGINE=InnoDB;

-- 2.8 Bill Line Items
--   subtotal is a generated column (MySQL 5.7.6+)
CREATE TABLE IF NOT EXISTS bill_line_items (
  id          INT           AUTO_INCREMENT PRIMARY KEY,
  bill_id     INT           NOT NULL,
  description VARCHAR(255)  NOT NULL,
  quantity    DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price  DECIMAL(10,2) NOT NULL,
  subtotal    DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_lineitems_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 2.9 Payments
CREATE TABLE IF NOT EXISTS payments (
  id          INT           AUTO_INCREMENT PRIMARY KEY,
  bill_id     INT           NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  method      ENUM('cash','card','ewallet') NOT NULL,
  received_by INT           NOT NULL,
  notes       TEXT,
  paid_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_payment_positive  CHECK (amount > 0),
  CONSTRAINT fk_payments_bill       FOREIGN KEY (bill_id)      REFERENCES bills(id),
  CONSTRAINT fk_payments_receivedby FOREIGN KEY (received_by)  REFERENCES users(id),

  INDEX idx_payments_bill (bill_id)
) ENGINE=InnoDB;

-- 2.10 Approval Logs
CREATE TABLE IF NOT EXISTS approval_logs (
  id       INT      AUTO_INCREMENT PRIMARY KEY,
  user_id  INT      NOT NULL,
  action   ENUM('approved','rejected','enabled','disabled') NOT NULL,
  acted_by INT      NOT NULL,
  reason   TEXT,
  acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_applogs_user    FOREIGN KEY (user_id)  REFERENCES users(id),
  CONSTRAINT fk_applogs_actedby FOREIGN KEY (acted_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ============================================================
-- 3. STORED PROCEDURES & FUNCTIONS
-- ============================================================

DROP PROCEDURE IF EXISTS sp_generate_user_id;
DROP PROCEDURE IF EXISTS sp_create_user;
DROP PROCEDURE IF EXISTS sp_login;
DROP PROCEDURE IF EXISTS sp_get_user_by_id;
DROP PROCEDURE IF EXISTS sp_change_password;
DROP PROCEDURE IF EXISTS sp_approve_user;
DROP PROCEDURE IF EXISTS sp_reject_user;
DROP PROCEDURE IF EXISTS sp_toggle_user_status;
DROP PROCEDURE IF EXISTS sp_get_all_users;
DROP PROCEDURE IF EXISTS sp_get_pending_users;
DROP PROCEDURE IF EXISTS sp_update_user_profile;
DROP PROCEDURE IF EXISTS sp_get_room_catalog;
DROP PROCEDURE IF EXISTS sp_get_available_rooms;
DROP PROCEDURE IF EXISTS sp_upsert_room;
DROP PROCEDURE IF EXISTS sp_upsert_service;
DROP PROCEDURE IF EXISTS sp_upsert_activity;
DROP PROCEDURE IF EXISTS sp_create_booking;
DROP PROCEDURE IF EXISTS sp_update_booking_status;
DROP PROCEDURE IF EXISTS sp_get_customer_bookings;
DROP PROCEDURE IF EXISTS sp_get_all_bookings;
DROP PROCEDURE IF EXISTS sp_create_activity_rental;
DROP PROCEDURE IF EXISTS sp_update_rental_status;
DROP PROCEDURE IF EXISTS sp_get_customer_activity_history;
DROP PROCEDURE IF EXISTS sp_get_all_rentals;
DROP FUNCTION  IF EXISTS sp_generate_bill_number;
DROP PROCEDURE IF EXISTS sp_generate_bill;
DROP PROCEDURE IF EXISTS sp_record_payment;
DROP PROCEDURE IF EXISTS sp_get_bills_for_customer;
DROP PROCEDURE IF EXISTS sp_get_all_bills;
DROP PROCEDURE IF EXISTS sp_get_bill_line_items;
DROP PROCEDURE IF EXISTS sp_get_payments_for_bill;
DROP PROCEDURE IF EXISTS sp_get_monthly_report;
DROP PROCEDURE IF EXISTS sp_get_yearly_report;
DROP PROCEDURE IF EXISTS sp_get_services;
DROP PROCEDURE IF EXISTS sp_get_activities;
DROP PROCEDURE IF EXISTS sp_get_staff_dashboard;
DROP PROCEDURE IF EXISTS sp_get_admin_dashboard;
DROP PROCEDURE IF EXISTS sp_search_customers;

DELIMITER //

-- ─────────────────────────────────────────────
-- 4.1 sp_generate_user_id
-- Generates a collision-free BHH-XX-XXXXXX unique ID for a given role.
-- Returns the unique ID via OUT parameter.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_generate_user_id(
  IN  p_role    VARCHAR(20),
  OUT p_out_uid VARCHAR(20)
)
BEGIN
  DECLARE v_prefix VARCHAR(2);
  DECLARE v_chars  VARCHAR(32) DEFAULT 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  DECLARE v_suffix VARCHAR(6)  DEFAULT '';
  DECLARE v_uid    VARCHAR(20) DEFAULT '';
  DECLARE v_exists INT         DEFAULT 0;
  DECLARE v_i      INT         DEFAULT 1;

  SET v_prefix = CASE p_role
    WHEN 'customer' THEN 'CU'
    WHEN 'staff'    THEN 'ST'
    WHEN 'admin'    THEN 'AD'
    ELSE 'XX'
  END;

  uid_loop: LOOP
    SET v_suffix = '';
    SET v_i = 1;
    WHILE v_i <= 6 DO
      SET v_suffix = CONCAT(v_suffix, SUBSTRING(v_chars, FLOOR(1 + RAND() * 32), 1));
      SET v_i = v_i + 1;
    END WHILE;

    SET v_uid = CONCAT('BHH-', v_prefix, '-', v_suffix);

    SELECT COUNT(*) INTO v_exists FROM users WHERE unique_id = v_uid;
    IF v_exists = 0 THEN
      LEAVE uid_loop;
    END IF;
  END LOOP;

  SET p_out_uid = v_uid;
END //

-- ─────────────────────────────────────────────
-- 4.2 sp_create_user
-- Creates a new user (customer, staff, or admin).
-- Returns the created user row.
-- Note: MySQL SPs cannot have parameter defaults.
--       Pass NULL explicitly for optional params.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_create_user(
  IN p_role          VARCHAR(20),
  IN p_full_name     VARCHAR(255),
  IN p_email         VARCHAR(255),
  IN p_phone         VARCHAR(30),
  IN p_username      VARCHAR(100),
  IN p_password_hash TEXT,
  IN p_created_by    INT,        -- pass NULL if not applicable
  IN p_valid_id_path TEXT        -- pass NULL if not applicable
)
BEGIN
  DECLARE v_uid VARCHAR(20);

  CALL sp_generate_user_id(p_role, v_uid);

  INSERT INTO users (
    unique_id, role, full_name, email, phone,
    username, password_hash, must_change_password,
    status, created_by, valid_id_path
  )
  VALUES (
    v_uid, p_role, p_full_name, p_email, p_phone,
    p_username, p_password_hash, TRUE,
    'pending', p_created_by, p_valid_id_path
  );

  SELECT * FROM users WHERE id = LAST_INSERT_ID();
END //

-- ─────────────────────────────────────────────
-- 4.3 sp_login
-- Returns the user record matching email or username for auth checking.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_login(IN p_identifier VARCHAR(255))
BEGIN
  SELECT * FROM users
  WHERE (email = p_identifier OR username = p_identifier)
  LIMIT 1;
END //

-- ─────────────────────────────────────────────
-- 4.4 sp_get_user_by_id
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_user_by_id(IN p_id INT)
BEGIN
  SELECT * FROM users WHERE id = p_id LIMIT 1;
END //

-- ─────────────────────────────────────────────
-- 4.5 sp_change_password
-- Updates password hash and clears must_change_password flag.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_change_password(
  IN p_user_id  INT,
  IN p_new_hash TEXT
)
BEGIN
  UPDATE users
  SET password_hash        = p_new_hash,
      must_change_password = FALSE,
      updated_at           = CURRENT_TIMESTAMP
  WHERE id = p_user_id;
END //

-- ─────────────────────────────────────────────
-- 4.6 sp_approve_user
-- Admin approves a pending user. Logs the action.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_approve_user(
  IN p_user_id  INT,
  IN p_admin_id INT
)
BEGIN
  UPDATE users
  SET status     = 'active',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_user_id AND status = 'pending';

  INSERT INTO approval_logs (user_id, action, acted_by)
  VALUES (p_user_id, 'approved', p_admin_id);

  SELECT * FROM users WHERE id = p_user_id;
END //

-- ─────────────────────────────────────────────
-- 4.7 sp_reject_user
-- Admin rejects a pending user. Logs the action with reason.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_reject_user(
  IN p_user_id  INT,
  IN p_admin_id INT,
  IN p_reason   TEXT  -- pass NULL if no reason
)
BEGIN
  UPDATE users
  SET status     = 'rejected',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_user_id AND status = 'pending';

  INSERT INTO approval_logs (user_id, action, acted_by, reason)
  VALUES (p_user_id, 'rejected', p_admin_id, p_reason);

  SELECT * FROM users WHERE id = p_user_id;
END //

-- ─────────────────────────────────────────────
-- 4.8 sp_toggle_user_status
-- Admin enables/disables an active or disabled account.
-- Prevents disabling the last remaining admin.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_toggle_user_status(
  IN p_user_id  INT,
  IN p_admin_id INT
)
BEGIN
  DECLARE v_current_status VARCHAR(20);
  DECLARE v_role           VARCHAR(20);
  DECLARE v_admin_count    INT;
  DECLARE v_new_status     VARCHAR(20);
  DECLARE v_action         VARCHAR(20);

  SELECT status, role INTO v_current_status, v_role
  FROM users WHERE id = p_user_id;

  -- Guard: cannot disable the last admin
  IF v_role = 'admin' AND v_current_status = 'active' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM users WHERE role = 'admin' AND status = 'active';

    IF v_admin_count <= 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Cannot disable the last active admin account.';
    END IF;
  END IF;

  IF v_current_status = 'active' THEN
    SET v_new_status = 'disabled';
    SET v_action     = 'disabled';
  ELSE
    SET v_new_status = 'active';
    SET v_action     = 'enabled';
  END IF;

  UPDATE users
  SET status     = v_new_status,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_user_id;

  INSERT INTO approval_logs (user_id, action, acted_by)
  VALUES (p_user_id, v_action, p_admin_id);

  SELECT * FROM users WHERE id = p_user_id;
END //

-- ─────────────────────────────────────────────
-- 4.9 sp_get_all_users
-- Returns all users, optionally filtered by role.
-- Pass NULL to p_role to return all roles.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_all_users(IN p_role VARCHAR(20))
BEGIN
  SELECT
    id, unique_id, role, full_name, email, phone,
    username, must_change_password, status, created_at, updated_at
  FROM users
  WHERE (p_role IS NULL OR role = p_role)
  ORDER BY created_at DESC;
END //

-- ─────────────────────────────────────────────
-- 4.10 sp_get_pending_users
-- Returns all pending accounts for admin approval queue.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_pending_users()
BEGIN
  SELECT
    u.id, u.unique_id, u.role, u.full_name, u.email, u.phone, u.username,
    u.created_at, u.created_by, c.full_name AS creator_name
  FROM users u
  LEFT JOIN users c ON u.created_by = c.id
  WHERE u.status = 'pending'
  ORDER BY u.created_at ASC;
END //

-- ─────────────────────────────────────────────
-- 4.11 sp_update_user_profile
-- Update user's own profile info (name, phone).
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_update_user_profile(
  IN p_user_id   INT,
  IN p_full_name VARCHAR(255),
  IN p_phone     VARCHAR(30)
)
BEGIN
  UPDATE users
  SET full_name  = p_full_name,
      phone      = p_phone,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_user_id;

  SELECT * FROM users WHERE id = p_user_id;
END //

-- ─────────────────────────────────────────────
-- 4.12 sp_get_room_catalog
-- Returns all rooms (optionally only available ones).
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_room_catalog(IN p_available_only BOOLEAN)
BEGIN
  SELECT * FROM rooms
  WHERE (p_available_only = FALSE OR status = 'available')
  ORDER BY room_number;
END //

-- ─────────────────────────────────────────────
-- 4.13 sp_get_available_rooms
-- Returns rooms not double-booked in the requested date range.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_available_rooms(
  IN p_check_in  DATE,
  IN p_check_out DATE
)
BEGIN
  SELECT r.* FROM rooms r
  WHERE r.status = 'available'
    AND r.id NOT IN (
      SELECT b.room_id FROM bookings b
      WHERE b.status NOT IN ('cancelled', 'checked_out')
        AND b.check_in  < p_check_out
        AND b.check_out > p_check_in
    )
  ORDER BY r.room_number;
END //

-- ─────────────────────────────────────────────
-- 4.14 sp_upsert_room
-- Admin create or update a room.
-- Pass p_id = NULL to INSERT; pass existing id to UPDATE.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_upsert_room(
  IN p_id              INT,
  IN p_room_number     VARCHAR(20),
  IN p_room_type       VARCHAR(100),
  IN p_capacity        INT,
  IN p_rate_per_night  DECIMAL(10,2),
  IN p_status          VARCHAR(20),
  IN p_description     TEXT,
  IN p_image_urls      JSON
)
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO rooms (room_number, room_type, capacity, rate_per_night, status, description, image_urls)
    VALUES (p_room_number, p_room_type, p_capacity, p_rate_per_night, p_status, p_description, p_image_urls);

    SELECT * FROM rooms WHERE id = LAST_INSERT_ID();
  ELSE
    UPDATE rooms SET
      room_number    = COALESCE(p_room_number,    room_number),
      room_type      = COALESCE(p_room_type,      room_type),
      capacity       = COALESCE(p_capacity,       capacity),
      rate_per_night = COALESCE(p_rate_per_night, rate_per_night),
      status         = COALESCE(p_status,         status),
      description    = COALESCE(p_description,    description),
      image_urls     = COALESCE(p_image_urls,     image_urls),
      updated_at     = CURRENT_TIMESTAMP
    WHERE id = p_id;

    SELECT * FROM rooms WHERE id = p_id;
  END IF;
END //

-- ─────────────────────────────────────────────
-- 4.15 sp_upsert_service
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_upsert_service(
  IN p_id          INT,
  IN p_name        VARCHAR(150),
  IN p_description TEXT,
  IN p_price       DECIMAL(10,2),
  IN p_icon_url    TEXT,
  IN p_is_active   BOOLEAN
)
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO services (name, description, price, icon_url, is_active)
    VALUES (p_name, p_description, p_price, p_icon_url, p_is_active);

    SELECT * FROM services WHERE id = LAST_INSERT_ID();
  ELSE
    UPDATE services SET
      name        = COALESCE(p_name,        name),
      description = COALESCE(p_description, description),
      price       = p_price,               -- allow explicit NULL (free)
      icon_url    = COALESCE(p_icon_url,   icon_url),
      is_active   = COALESCE(p_is_active,  is_active),
      updated_at  = CURRENT_TIMESTAMP
    WHERE id = p_id;

    SELECT * FROM services WHERE id = p_id;
  END IF;
END //

-- ─────────────────────────────────────────────
-- 4.16 sp_upsert_activity
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_upsert_activity(
  IN p_id              INT,
  IN p_name            VARCHAR(150),
  IN p_activity_type   VARCHAR(100),
  IN p_price_per_unit  DECIMAL(10,2),
  IN p_unit            VARCHAR(30),
  IN p_inventory_count INT,
  IN p_description     TEXT,
  IN p_image_url       TEXT,
  IN p_is_active       BOOLEAN
)
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO activities (name, activity_type, price_per_unit, unit, inventory_count, description, image_url, is_active)
    VALUES (p_name, p_activity_type, p_price_per_unit, p_unit, p_inventory_count, p_description, p_image_url, p_is_active);

    SELECT * FROM activities WHERE id = LAST_INSERT_ID();
  ELSE
    UPDATE activities SET
      name            = COALESCE(p_name,            name),
      activity_type   = COALESCE(p_activity_type,   activity_type),
      price_per_unit  = COALESCE(p_price_per_unit,  price_per_unit),
      unit            = COALESCE(p_unit,            unit),
      inventory_count = COALESCE(p_inventory_count, inventory_count),
      description     = COALESCE(p_description,     description),
      image_url       = COALESCE(p_image_url,       image_url),
      is_active       = COALESCE(p_is_active,       is_active),
      updated_at      = CURRENT_TIMESTAMP
    WHERE id = p_id;

    SELECT * FROM activities WHERE id = p_id;
  END IF;
END //

-- ─────────────────────────────────────────────
-- 4.17 sp_create_booking
-- Creates a booking with double-booking prevention.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_create_booking(
  IN p_customer_id INT,
  IN p_room_id     INT,
  IN p_check_in    DATE,
  IN p_check_out   DATE,
  IN p_notes       TEXT,
  IN p_created_by  INT  -- pass NULL if customer self-books
)
BEGIN
  DECLARE v_conflict INT DEFAULT 0;

  -- Check double-booking
  SELECT COUNT(*) INTO v_conflict
  FROM bookings
  WHERE room_id   = p_room_id
    AND status NOT IN ('cancelled', 'checked_out')
    AND check_in  < p_check_out
    AND check_out > p_check_in;

  IF v_conflict > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Room is not available for the selected dates.';
  END IF;

  INSERT INTO bookings (customer_id, room_id, check_in, check_out, notes, created_by)
  VALUES (p_customer_id, p_room_id, p_check_in, p_check_out, p_notes, p_created_by);

  SELECT * FROM bookings WHERE id = LAST_INSERT_ID();
END //

-- ─────────────────────────────────────────────
-- 4.18 sp_update_booking_status
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_update_booking_status(
  IN p_booking_id INT,
  IN p_status     VARCHAR(20)
)
BEGIN
  UPDATE bookings
  SET status     = p_status,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_booking_id;

  SELECT * FROM bookings WHERE id = p_booking_id;
END //

-- ─────────────────────────────────────────────
-- 4.19 sp_get_customer_bookings
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_customer_bookings(IN p_customer_id INT)
BEGIN
  SELECT
    b.id, b.customer_id, b.room_id, r.room_number, r.room_type,
    b.check_in, b.check_out, b.status, b.notes, b.created_at
  FROM bookings b
  JOIN rooms r ON r.id = b.room_id
  WHERE b.customer_id = p_customer_id
  ORDER BY b.created_at DESC;
END //

-- ─────────────────────────────────────────────
-- 4.20 sp_get_all_bookings
-- Returns all bookings with customer and room info (Staff/Admin view).
-- Pass NULL to p_status to return all statuses.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_all_bookings(IN p_status VARCHAR(20))
BEGIN
  SELECT
    b.id, b.customer_id, u.full_name AS customer_name, u.unique_id,
    b.room_id, r.room_number, r.room_type,
    b.check_in, b.check_out, b.status, b.notes, b.created_at
  FROM bookings b
  JOIN users u ON u.id = b.customer_id
  JOIN rooms r ON r.id = b.room_id
  WHERE (p_status IS NULL OR b.status = p_status)
  ORDER BY b.created_at DESC;
END //

-- ─────────────────────────────────────────────
-- 4.21 sp_create_activity_rental
-- Creates an activity rental with availability check.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_create_activity_rental(
  IN p_customer_id INT,
  IN p_activity_id INT,
  IN p_start_time  DATETIME,
  IN p_end_time    DATETIME,
  IN p_notes       TEXT,
  IN p_created_by  INT   -- pass NULL if customer self-books
)
BEGIN
  DECLARE v_inventory    INT DEFAULT 0;
  DECLARE v_active_count INT DEFAULT 0;

  SELECT inventory_count INTO v_inventory FROM activities WHERE id = p_activity_id;

  SELECT COUNT(*) INTO v_active_count
  FROM activity_rentals
  WHERE activity_id = p_activity_id
    AND status NOT IN ('cancelled', 'completed')
    AND start_time < p_end_time
    AND end_time   > p_start_time;

  IF v_active_count >= v_inventory THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Activity resource not available for the selected time slot.';
  END IF;

  INSERT INTO activity_rentals (customer_id, activity_id, start_time, end_time, notes, created_by)
  VALUES (p_customer_id, p_activity_id, p_start_time, p_end_time, p_notes, p_created_by);

  SELECT * FROM activity_rentals WHERE id = LAST_INSERT_ID();
END //

-- ─────────────────────────────────────────────
-- 4.22 sp_update_rental_status
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_update_rental_status(
  IN p_rental_id INT,
  IN p_status    VARCHAR(20)
)
BEGIN
  UPDATE activity_rentals
  SET status     = p_status,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_rental_id;

  SELECT * FROM activity_rentals WHERE id = p_rental_id;
END //

-- ─────────────────────────────────────────────
-- 4.23 sp_get_customer_activity_history
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_customer_activity_history(IN p_customer_id INT)
BEGIN
  SELECT
    ar.id, ar.activity_id, a.name AS activity_name,
    ar.start_time, ar.end_time, ar.status, ar.created_at
  FROM activity_rentals ar
  JOIN activities a ON a.id = ar.activity_id
  WHERE ar.customer_id = p_customer_id
  ORDER BY ar.created_at DESC;
END //

-- ─────────────────────────────────────────────
-- 4.24 sp_get_all_rentals
-- Staff/Admin view of all activity rentals.
-- Pass NULL to p_status to return all.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_all_rentals(IN p_status VARCHAR(20))
BEGIN
  SELECT
    ar.id, ar.customer_id, u.full_name AS customer_name, u.unique_id,
    ar.activity_id, a.name AS activity_name,
    ar.start_time, ar.end_time, ar.status, ar.created_at
  FROM activity_rentals ar
  JOIN users      u ON u.id = ar.customer_id
  JOIN activities a ON a.id = ar.activity_id
  WHERE (p_status IS NULL OR ar.status = p_status)
  ORDER BY ar.created_at DESC;
END //

-- ─────────────────────────────────────────────
-- 4.25 sp_generate_bill_number  (scalar FUNCTION)
-- Generates a unique bill number: BHH-CU-XXXXXX-B####
-- ─────────────────────────────────────────────
CREATE FUNCTION sp_generate_bill_number(p_customer_id INT)
RETURNS VARCHAR(50)
READS SQL DATA
BEGIN
  DECLARE v_unique_id  VARCHAR(20);
  DECLARE v_count      INT;

  SELECT unique_id INTO v_unique_id FROM users WHERE id = p_customer_id;
  SELECT COUNT(*) + 1 INTO v_count FROM bills WHERE customer_id = p_customer_id;

  RETURN CONCAT(v_unique_id, '-B', LPAD(v_count, 4, '0'));
END //

-- ─────────────────────────────────────────────
-- 4.26 sp_generate_bill
-- Staff generates a bill from a confirmed booking or activity rental.
-- p_line_items: JSON array [{"description":"...","quantity":1,"unit_price":100}]
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_generate_bill(
  IN p_customer_id        INT,
  IN p_booking_id         INT,   -- pass NULL if activity rental bill
  IN p_activity_rental_id INT,   -- pass NULL if room booking bill
  IN p_line_items         JSON,
  IN p_staff_id           INT
)
BEGIN
  DECLARE v_bill_number VARCHAR(50);
  DECLARE v_total       DECIMAL(10,2) DEFAULT 0;
  DECLARE v_bill_id     INT;
  DECLARE v_i           INT DEFAULT 0;
  DECLARE v_len         INT DEFAULT 0;
  DECLARE v_qty         DECIMAL(10,2);
  DECLARE v_price       DECIMAL(10,2);
  DECLARE v_desc        VARCHAR(255);

  IF p_booking_id IS NULL AND p_activity_rental_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Bill must reference a booking or an activity rental.';
  END IF;

  -- Calculate total by iterating the JSON array manually
  SET v_len   = JSON_LENGTH(p_line_items);
  SET v_total = 0;
  SET v_i     = 0;
  WHILE v_i < v_len DO
    SET v_qty   = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_line_items, CONCAT('$[', v_i, '].quantity')))   AS DECIMAL(10,2));
    SET v_price = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_line_items, CONCAT('$[', v_i, '].unit_price'))) AS DECIMAL(10,2));
    SET v_total = v_total + (v_qty * v_price);
    SET v_i     = v_i + 1;
  END WHILE;

  SET v_bill_number = sp_generate_bill_number(p_customer_id);

  INSERT INTO bills (bill_number, customer_id, booking_id, activity_rental_id, total_amount, issued_by)
  VALUES (v_bill_number, p_customer_id, p_booking_id, p_activity_rental_id, v_total, p_staff_id);

  SET v_bill_id = LAST_INSERT_ID();

  -- Insert line items one by one from the JSON array
  SET v_i = 0;
  WHILE v_i < v_len DO
    SET v_desc  = JSON_UNQUOTE(JSON_EXTRACT(p_line_items, CONCAT('$[', v_i, '].description')));
    SET v_qty   = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_line_items, CONCAT('$[', v_i, '].quantity')))   AS DECIMAL(10,2));
    SET v_price = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_line_items, CONCAT('$[', v_i, '].unit_price'))) AS DECIMAL(10,2));
    INSERT INTO bill_line_items (bill_id, description, quantity, unit_price)
    VALUES (v_bill_id, v_desc, v_qty, v_price);
    SET v_i = v_i + 1;
  END WHILE;

  SELECT * FROM bills WHERE id = v_bill_id;
END //

-- ─────────────────────────────────────────────
-- 4.27 sp_record_payment
-- Records a payment against an existing unpaid/partially_paid bill.
-- Enforces bill-must-exist guardrail and overpayment guard.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_record_payment(
  IN p_bill_id  INT,
  IN p_amount   DECIMAL(10,2),
  IN p_method   VARCHAR(20),
  IN p_staff_id INT,
  IN p_notes    TEXT   -- pass NULL if no notes
)
BEGIN
  DECLARE v_bill_status VARCHAR(20);
  DECLARE v_total       DECIMAL(10,2);
  DECLARE v_paid        DECIMAL(10,2);
  DECLARE v_remaining   DECIMAL(10,2);
  DECLARE v_new_paid    DECIMAL(10,2);
  DECLARE v_new_status  VARCHAR(20);
  DECLARE v_payment_id  INT;
  DECLARE v_msg         VARCHAR(255);

  SELECT status, total_amount, paid_amount
  INTO v_bill_status, v_total, v_paid
  FROM bills WHERE id = p_bill_id
  FOR UPDATE;

  IF v_bill_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Bill not found.';
  END IF;

  IF v_bill_status = 'paid' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Bill is already fully paid.';
  END IF;

  SET v_remaining = v_total - v_paid;

  IF p_amount > v_remaining THEN
    SET v_msg = CONCAT('Payment amount exceeds remaining balance of ', v_remaining, '.');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  INSERT INTO payments (bill_id, amount, method, received_by, notes)
  VALUES (p_bill_id, p_amount, p_method, p_staff_id, p_notes);

  SET v_payment_id = LAST_INSERT_ID();
  SET v_new_paid   = v_paid + p_amount;

  IF v_new_paid >= v_total THEN
    SET v_new_status = 'paid';
  ELSE
    SET v_new_status = 'partially_paid';
  END IF;

  UPDATE bills
  SET paid_amount = v_new_paid,
      status      = v_new_status,
      updated_at  = CURRENT_TIMESTAMP
  WHERE id = p_bill_id;

  SELECT * FROM payments WHERE id = v_payment_id;
END //

-- ─────────────────────────────────────────────
-- 4.28 sp_get_bills_for_customer
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_bills_for_customer(IN p_customer_id INT)
BEGIN
  SELECT
    b.id, b.bill_number, b.customer_id, b.booking_id, b.activity_rental_id,
    b.total_amount, b.paid_amount, b.status, b.issued_at
  FROM bills b
  WHERE b.customer_id = p_customer_id
  ORDER BY b.issued_at DESC;
END //

-- ─────────────────────────────────────────────
-- 4.29 sp_get_all_bills
-- Staff/Admin view of all bills.
-- Pass NULL to p_status for all.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_all_bills(IN p_status VARCHAR(20))
BEGIN
  SELECT
    b.id, b.bill_number, b.customer_id, u.full_name AS customer_name, u.unique_id,
    b.booking_id, b.activity_rental_id,
    b.total_amount, b.paid_amount, b.status,
    b.issued_by, s.full_name AS staff_name, b.issued_at
  FROM bills b
  JOIN users u ON u.id = b.customer_id
  JOIN users s ON s.id = b.issued_by
  WHERE (p_status IS NULL OR b.status = p_status)
  ORDER BY b.issued_at DESC;
END //

-- ─────────────────────────────────────────────
-- 4.30 sp_get_bill_line_items
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_bill_line_items(IN p_bill_id INT)
BEGIN
  SELECT * FROM bill_line_items WHERE bill_id = p_bill_id ORDER BY id;
END //

-- ─────────────────────────────────────────────
-- 4.31 sp_get_payments_for_bill
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_payments_for_bill(IN p_bill_id INT)
BEGIN
  SELECT
    p.id, p.bill_id, p.amount, p.method,
    p.received_by, u.full_name AS staff_name, p.notes, p.paid_at
  FROM payments p
  JOIN users u ON u.id = p.received_by
  WHERE p.bill_id = p_bill_id
  ORDER BY p.paid_at;
END //

-- ─────────────────────────────────────────────
-- 4.32 sp_get_monthly_report
-- Admin monthly report: occupancy, bookings, revenue breakdown.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_monthly_report(IN p_year INT, IN p_month INT)
BEGIN
  SELECT
    (SELECT COUNT(*) FROM bookings
     WHERE YEAR(created_at) = p_year AND MONTH(created_at) = p_month)
      AS total_bookings,

    (SELECT COUNT(*) FROM bookings
     WHERE YEAR(created_at) = p_year AND MONTH(created_at) = p_month AND status = 'confirmed')
      AS confirmed_bookings,

    (SELECT COUNT(*) FROM bookings
     WHERE YEAR(created_at) = p_year AND MONTH(created_at) = p_month AND status = 'cancelled')
      AS cancelled_bookings,

    (SELECT COUNT(*) FROM activity_rentals
     WHERE YEAR(created_at) = p_year AND MONTH(created_at) = p_month)
      AS total_activity_rentals,

    (SELECT COALESCE(SUM(p.amount), 0)
     FROM payments p
     JOIN bills b ON b.id = p.bill_id
     WHERE b.booking_id IS NOT NULL
       AND YEAR(p.paid_at) = p_year AND MONTH(p.paid_at) = p_month)
      AS room_revenue,

    (SELECT COALESCE(SUM(p.amount), 0)
     FROM payments p
     JOIN bills b ON b.id = p.bill_id
     WHERE b.activity_rental_id IS NOT NULL
       AND YEAR(p.paid_at) = p_year AND MONTH(p.paid_at) = p_month)
      AS activity_revenue,

    (SELECT COALESCE(SUM(amount), 0)
     FROM payments
     WHERE YEAR(paid_at) = p_year AND MONTH(paid_at) = p_month)
      AS total_revenue,

    (SELECT COUNT(*) FROM rooms)
      AS total_rooms,

    (SELECT COUNT(DISTINCT room_id) FROM bookings
     WHERE status = 'checked_in'
       AND YEAR(created_at) = p_year AND MONTH(created_at) = p_month)
      AS occupied_rooms,

    ROUND(
      (SELECT COUNT(DISTINCT room_id) FROM bookings
       WHERE status = 'checked_in'
         AND YEAR(created_at) = p_year AND MONTH(created_at) = p_month)
      / NULLIF((SELECT COUNT(*) FROM rooms), 0) * 100
    , 2) AS occupancy_rate;
END //

-- ─────────────────────────────────────────────
-- 4.33 sp_get_yearly_report
-- Admin yearly report: monthly breakdown.
-- Uses a recursive CTE to generate months 1–12.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_yearly_report(IN p_year INT)
BEGIN
  DECLARE v_m INT DEFAULT 1;

  -- Temp table to accumulate monthly rows
  DROP TEMPORARY TABLE IF EXISTS tmp_yearly_report;
  CREATE TEMPORARY TABLE tmp_yearly_report (
    month                  INT,
    month_name             VARCHAR(20),
    total_bookings         BIGINT,
    total_activity_rentals BIGINT,
    room_revenue           DECIMAL(14,2),
    activity_revenue       DECIMAL(14,2),
    total_revenue          DECIMAL(14,2)
  );

  WHILE v_m <= 12 DO
    INSERT INTO tmp_yearly_report
    SELECT
      v_m,
      DATE_FORMAT(STR_TO_DATE(v_m, '%m'), '%M'),
      (SELECT COUNT(*) FROM bookings
       WHERE YEAR(created_at) = p_year AND MONTH(created_at) = v_m),
      (SELECT COUNT(*) FROM activity_rentals
       WHERE YEAR(created_at) = p_year AND MONTH(created_at) = v_m),
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
       JOIN bills b ON b.id = p.bill_id
       WHERE b.booking_id IS NOT NULL
         AND YEAR(p.paid_at) = p_year AND MONTH(p.paid_at) = v_m),
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
       JOIN bills b ON b.id = p.bill_id
       WHERE b.activity_rental_id IS NOT NULL
         AND YEAR(p.paid_at) = p_year AND MONTH(p.paid_at) = v_m),
      (SELECT COALESCE(SUM(amount), 0) FROM payments
       WHERE YEAR(paid_at) = p_year AND MONTH(paid_at) = v_m);
    SET v_m = v_m + 1;
  END WHILE;

  SELECT * FROM tmp_yearly_report ORDER BY month;
  DROP TEMPORARY TABLE IF EXISTS tmp_yearly_report;
END //

-- ─────────────────────────────────────────────
-- 4.34 sp_get_services
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_services(IN p_active_only BOOLEAN)
BEGIN
  SELECT * FROM services
  WHERE (p_active_only = FALSE OR is_active = TRUE)
  ORDER BY name;
END //

-- ─────────────────────────────────────────────
-- 4.35 sp_get_activities
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_activities(IN p_active_only BOOLEAN)
BEGIN
  SELECT * FROM activities
  WHERE (p_active_only = FALSE OR is_active = TRUE)
  ORDER BY name;
END //

-- ─────────────────────────────────────────────
-- 4.36 sp_get_staff_dashboard
-- Returns today's arrivals, pending bills count, room status overview.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_staff_dashboard()
BEGIN
  SELECT
    (SELECT COUNT(*) FROM bookings WHERE check_in  = CURDATE() AND status = 'confirmed')    AS todays_arrivals,
    (SELECT COUNT(*) FROM bookings WHERE check_out = CURDATE() AND status = 'checked_in')   AS todays_checkouts,
    (SELECT COUNT(*) FROM bookings WHERE status = 'requested')                               AS pending_bookings,
    (SELECT COUNT(*) FROM bills   WHERE status IN ('unpaid', 'partially_paid'))             AS unpaid_bills,
    (SELECT COUNT(*) FROM rooms   WHERE status = 'available')                               AS available_rooms,
    (SELECT COUNT(*) FROM rooms   WHERE status = 'occupied')                                AS occupied_rooms;
END //

-- ─────────────────────────────────────────────
-- 4.37 sp_get_admin_dashboard
-- KPI snapshot for admin.
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_get_admin_dashboard()
BEGIN
  SELECT
    (SELECT COUNT(*) FROM users WHERE status != 'rejected')  AS total_users,
    (SELECT COUNT(*) FROM users WHERE status = 'pending')    AS pending_users,
    (SELECT COUNT(*) FROM rooms)                             AS total_rooms,
    (SELECT COUNT(*) FROM rooms WHERE status = 'available')  AS available_rooms,

    (SELECT COALESCE(SUM(amount), 0) FROM payments
     WHERE YEAR(paid_at) = YEAR(NOW()) AND MONTH(paid_at) = MONTH(NOW()))
      AS this_month_rev,

    (SELECT COUNT(*) FROM bookings
     WHERE YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW()))
      AS total_bookings;
END //

-- ─────────────────────────────────────────────
-- 4.38 sp_search_customers (Staff)
-- ─────────────────────────────────────────────
CREATE PROCEDURE sp_search_customers(IN p_query VARCHAR(255))  -- pass NULL for all customers
BEGIN
  SELECT
    u.id, u.unique_id, u.full_name, u.email, u.phone,
    u.username, u.status, u.created_at
  FROM users u
  WHERE u.role = 'customer'
    AND (
      p_query IS NULL
      OR u.full_name  LIKE CONCAT('%', p_query, '%')
      OR u.email      LIKE CONCAT('%', p_query, '%')
      OR u.unique_id  LIKE CONCAT('%', p_query, '%')
    )
  ORDER BY u.created_at DESC;
END //

DELIMITER ;

-- ============================================================
-- 5. SEED DATA — Initial Admin Account
-- ============================================================
-- Password: user123 (bcrypt hash — must be replaced with real hash on first run)
-- The application will hash "user123" and call sp_create_user at startup if no admin exists.
-- This is a placeholder reference.

-- ============================================================
-- END OF SCHEMA
-- ============================================================
