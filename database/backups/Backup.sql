/*
SQLyog Ultimate v9.62 
MySQL - 5.7.43-log : Database - bhh
*********************************************************************
*/

/*!40101 SET NAMES utf8 */;

/*!40101 SET SQL_MODE=''*/;

/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
CREATE DATABASE /*!32312 IF NOT EXISTS*/`bhh` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;

USE `bhh`;

/*Table structure for table `activities` */

DROP TABLE IF EXISTS `activities`;

CREATE TABLE `activities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activity_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `price_per_unit` decimal(10,2) NOT NULL,
  `unit` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'hour',
  `inventory_count` int(11) NOT NULL DEFAULT '1',
  `description` text COLLATE utf8mb4_unicode_ci,
  `image_url` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `activities` */

/*Table structure for table `activity_rentals` */

DROP TABLE IF EXISTS `activity_rentals`;

CREATE TABLE `activity_rentals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customer_id` int(11) NOT NULL,
  `activity_id` int(11) NOT NULL,
  `start_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `end_time` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  `status` enum('requested','confirmed','active','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'requested',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_rental_creator` (`created_by`),
  KEY `idx_rentals_customer` (`customer_id`),
  KEY `idx_rentals_activity` (`activity_id`),
  CONSTRAINT `fk_rental_activity` FOREIGN KEY (`activity_id`) REFERENCES `activities` (`id`),
  CONSTRAINT `fk_rental_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rental_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `activity_rentals` */

/*Table structure for table `approval_logs` */

DROP TABLE IF EXISTS `approval_logs`;

CREATE TABLE `approval_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `action` enum('approved','rejected','enabled','disabled') COLLATE utf8mb4_unicode_ci NOT NULL,
  `acted_by` int(11) NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `acted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_approval_user` (`user_id`),
  KEY `fk_approval_admin` (`acted_by`),
  CONSTRAINT `fk_approval_admin` FOREIGN KEY (`acted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_approval_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `approval_logs` */

insert  into `approval_logs`(`id`,`user_id`,`action`,`acted_by`,`reason`,`acted_at`) values (1,3,'approved',1,NULL,'2026-08-05 09:27:47');

/*Table structure for table `bill_line_items` */

DROP TABLE IF EXISTS `bill_line_items`;

CREATE TABLE `bill_line_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bill_id` int(11) NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT '1.00',
  `unit_price` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) GENERATED ALWAYS AS ((`quantity` * `unit_price`)) STORED,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_bill_item` (`bill_id`),
  CONSTRAINT `fk_bill_item` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `bill_line_items` */

/*Table structure for table `bills` */

DROP TABLE IF EXISTS `bills`;

CREATE TABLE `bills` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bill_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int(11) NOT NULL,
  `booking_id` int(11) DEFAULT NULL,
  `activity_rental_id` int(11) DEFAULT NULL,
  `total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `paid_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` enum('unpaid','partially_paid','paid') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unpaid',
  `issued_by` int(11) NOT NULL,
  `issued_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bill_number` (`bill_number`),
  KEY `fk_bill_booking` (`booking_id`),
  KEY `fk_bill_rental` (`activity_rental_id`),
  KEY `fk_bill_staff` (`issued_by`),
  KEY `idx_bills_customer` (`customer_id`),
  KEY `idx_bills_status` (`status`),
  CONSTRAINT `fk_bill_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`),
  CONSTRAINT `fk_bill_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_bill_rental` FOREIGN KEY (`activity_rental_id`) REFERENCES `activity_rentals` (`id`),
  CONSTRAINT `fk_bill_staff` FOREIGN KEY (`issued_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `bills` */

/*Table structure for table `bookings` */

DROP TABLE IF EXISTS `bookings`;

CREATE TABLE `bookings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customer_id` int(11) NOT NULL,
  `room_id` int(11) NOT NULL,
  `check_in` date NOT NULL,
  `check_out` date NOT NULL,
  `status` enum('requested','confirmed','checked_in','checked_out','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'requested',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_booking_creator` (`created_by`),
  KEY `idx_bookings_customer` (`customer_id`),
  KEY `idx_bookings_room` (`room_id`),
  KEY `idx_bookings_dates` (`check_in`,`check_out`),
  CONSTRAINT `fk_booking_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_booking_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_booking_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `bookings` */

/*Table structure for table `payments` */

DROP TABLE IF EXISTS `payments`;

CREATE TABLE `payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bill_id` int(11) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `method` enum('cash','card','ewallet') COLLATE utf8mb4_unicode_ci NOT NULL,
  `received_by` int(11) NOT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `paid_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_payment_staff` (`received_by`),
  KEY `idx_payments_bill` (`bill_id`),
  CONSTRAINT `fk_payment_bill` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`),
  CONSTRAINT `fk_payment_staff` FOREIGN KEY (`received_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `payments` */

/*Table structure for table `rooms` */

DROP TABLE IF EXISTS `rooms`;

CREATE TABLE `rooms` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `room_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `room_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `capacity` int(11) NOT NULL DEFAULT '1',
  `rate_per_night` decimal(10,2) NOT NULL,
  `status` enum('available','occupied','maintenance') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'available',
  `description` text COLLATE utf8mb4_unicode_ci,
  `image_urls` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `room_number` (`room_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `rooms` */

/*Table structure for table `services` */

DROP TABLE IF EXISTS `services`;

CREATE TABLE `services` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `price` decimal(10,2) DEFAULT NULL,
  `icon_url` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `services` */

/*Table structure for table `users` */

DROP TABLE IF EXISTS `users`;

CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `unique_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('customer','staff','admin') COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `username` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `must_change_password` tinyint(1) NOT NULL DEFAULT '1',
  `status` enum('pending','active','disabled','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `valid_id_path` text COLLATE utf8mb4_unicode_ci,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_id` (`unique_id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `username` (`username`),
  KEY `fk_users_creator` (`created_by`),
  KEY `idx_users_unique_id` (`unique_id`),
  KEY `idx_users_email` (`email`),
  KEY `idx_users_status` (`status`),
  KEY `idx_users_role` (`role`),
  CONSTRAINT `fk_users_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*Data for the table `users` */

insert  into `users`(`id`,`unique_id`,`role`,`full_name`,`email`,`phone`,`username`,`password_hash`,`must_change_password`,`status`,`valid_id_path`,`created_by`,`created_at`,`updated_at`) values (1,'BHH-AD-HGGQV2','admin','System Admin','admin@bhh.com','09223415564','admin','$2b$12$upH8rVrLwe4FukFF3vda2OC/VsjnkouD1nw965tE5Kq23tF8XdzoW',0,'active',NULL,NULL,'2026-08-04 23:52:08','2026-08-05 01:22:09'),(2,'BHH-CU-GJXU76','customer','Kevin Esto','marijuane23@gmail.com','09332417787','marijuane23','$2b$12$uROvPDz1d1Ct10.XZqqcpeY/Efs8qd33yk26bzSBgzCNzrNsfbSD.',0,'active',NULL,NULL,'2026-08-05 00:28:12','2026-08-05 00:32:28'),(3,'BHH-CU-W5MJGH','customer','James Ronolo','james@gmail.com','09223416765','james123','$2b$12$yW9NUGBZKq.a/7WYf0OjNefezdRF1Ubo/QunJUHDzuwwQzRAKTY/G',1,'active',NULL,NULL,'2026-08-05 01:16:13','2026-08-05 09:27:47'),(4,'BHH-ST-53PYHE','staff','Jeffrey Bayot','jepp@gmail.com','09537628989','jepp23','$2b$12$Mh8u7lqJj9bVjgBIbSh9yeSwStOMIsxiP622H/pj.E/7jxtHIQhMC',0,'active',NULL,1,'2026-08-05 01:17:28','2026-08-05 01:19:02');

/* Function  structure for function  `sp_generate_bill_number` */

/*!50003 DROP FUNCTION IF EXISTS `sp_generate_bill_number` */;
DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` FUNCTION `sp_generate_bill_number`(p_customer_id INT) RETURNS varchar(50) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci
    READS SQL DATA
BEGIN
  DECLARE v_unique_id  VARCHAR(20);
  DECLARE v_count      INT;
  SELECT unique_id INTO v_unique_id FROM users WHERE id = p_customer_id;
  SELECT COUNT(*) + 1 INTO v_count FROM bills WHERE customer_id = p_customer_id;
  RETURN CONCAT(v_unique_id, '-B', LPAD(v_count, 4, '0'));
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_approve_user` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_approve_user` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_approve_user`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_change_password` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_change_password` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_change_password`(
  IN p_user_id  INT,
  IN p_new_hash TEXT
)
BEGIN
  UPDATE users
  SET password_hash        = p_new_hash,
      must_change_password = FALSE,
      updated_at           = CURRENT_TIMESTAMP
  WHERE id = p_user_id;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_create_activity_rental` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_create_activity_rental` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_create_activity_rental`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_create_booking` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_create_booking` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_create_booking`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_create_user` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_create_user` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_create_user`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_generate_bill` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_generate_bill` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_generate_bill`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_generate_user_id` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_generate_user_id` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_generate_user_id`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_activities` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_activities` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_activities`(IN p_active_only BOOLEAN)
BEGIN
  SELECT * FROM activities
  WHERE (p_active_only = FALSE OR is_active = TRUE)
  ORDER BY name;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_admin_dashboard` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_admin_dashboard` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_admin_dashboard`()
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_all_bills` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_all_bills` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_all_bills`(IN p_status VARCHAR(20))
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_all_bookings` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_all_bookings` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_all_bookings`(IN p_status VARCHAR(20))
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_all_rentals` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_all_rentals` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_all_rentals`(IN p_status VARCHAR(20))
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_all_users` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_all_users` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_all_users`(IN p_role VARCHAR(20))
BEGIN
  SELECT
    id, unique_id, role, full_name, email, phone,
    username, must_change_password, status, created_at, updated_at
  FROM users
  WHERE (p_role IS NULL OR role = p_role)
  ORDER BY created_at DESC;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_available_rooms` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_available_rooms` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_available_rooms`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_bills_for_customer` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_bills_for_customer` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_bills_for_customer`(IN p_customer_id INT)
BEGIN
  SELECT
    b.id, b.bill_number, b.customer_id, b.booking_id, b.activity_rental_id,
    b.total_amount, b.paid_amount, b.status, b.issued_at
  FROM bills b
  WHERE b.customer_id = p_customer_id
  ORDER BY b.issued_at DESC;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_bill_line_items` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_bill_line_items` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_bill_line_items`(IN p_bill_id INT)
BEGIN
  SELECT * FROM bill_line_items WHERE bill_id = p_bill_id ORDER BY id;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_customer_activity_history` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_customer_activity_history` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_customer_activity_history`(IN p_customer_id INT)
BEGIN
  SELECT
    ar.id, ar.activity_id, a.name AS activity_name,
    ar.start_time, ar.end_time, ar.status, ar.created_at
  FROM activity_rentals ar
  JOIN activities a ON a.id = ar.activity_id
  WHERE ar.customer_id = p_customer_id
  ORDER BY ar.created_at DESC;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_customer_bookings` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_customer_bookings` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_customer_bookings`(IN p_customer_id INT)
BEGIN
  SELECT
    b.id, b.customer_id, b.room_id, r.room_number, r.room_type,
    b.check_in, b.check_out, b.status, b.notes, b.created_at
  FROM bookings b
  JOIN rooms r ON r.id = b.room_id
  WHERE b.customer_id = p_customer_id
  ORDER BY b.created_at DESC;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_monthly_report` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_monthly_report` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_monthly_report`(IN p_year INT, IN p_month INT)
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_payments_for_bill` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_payments_for_bill` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_payments_for_bill`(IN p_bill_id INT)
BEGIN
  SELECT
    p.id, p.bill_id, p.amount, p.method,
    p.received_by, u.full_name AS staff_name, p.notes, p.paid_at
  FROM payments p
  JOIN users u ON u.id = p.received_by
  WHERE p.bill_id = p_bill_id
  ORDER BY p.paid_at;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_pending_users` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_pending_users` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_pending_users`()
BEGIN
  SELECT
    u.id, u.unique_id, u.role, u.full_name, u.email, u.phone, u.username,
    u.created_at, u.created_by, c.full_name AS creator_name
  FROM users u
  LEFT JOIN users c ON u.created_by = c.id
  WHERE u.status = 'pending'
  ORDER BY u.created_at ASC;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_room_catalog` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_room_catalog` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_room_catalog`(IN p_available_only BOOLEAN)
BEGIN
  SELECT * FROM rooms
  WHERE (p_available_only = FALSE OR status = 'available')
  ORDER BY room_number;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_services` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_services` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_services`(IN p_active_only BOOLEAN)
BEGIN
  SELECT * FROM services
  WHERE (p_active_only = FALSE OR is_active = TRUE)
  ORDER BY name;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_staff_dashboard` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_staff_dashboard` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_staff_dashboard`()
BEGIN
  SELECT
    (SELECT COUNT(*) FROM bookings WHERE check_in  = CURDATE() AND status = 'confirmed')    AS todays_arrivals,
    (SELECT COUNT(*) FROM bookings WHERE check_out = CURDATE() AND status = 'checked_in')   AS todays_checkouts,
    (SELECT COUNT(*) FROM bookings WHERE status = 'requested')                               AS pending_bookings,
    (SELECT COUNT(*) FROM bills   WHERE status IN ('unpaid', 'partially_paid'))             AS unpaid_bills,
    (SELECT COUNT(*) FROM rooms   WHERE status = 'available')                               AS available_rooms,
    (SELECT COUNT(*) FROM rooms   WHERE status = 'occupied')                                AS occupied_rooms;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_user_by_id` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_user_by_id` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_user_by_id`(IN p_id INT)
BEGIN
  SELECT * FROM users WHERE id = p_id LIMIT 1;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_get_yearly_report` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_get_yearly_report` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_get_yearly_report`(IN p_year INT)
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_login` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_login` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_login`(IN p_identifier VARCHAR(255))
BEGIN
  SELECT * FROM users
  WHERE (email = p_identifier OR username = p_identifier)
  LIMIT 1;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_record_payment` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_record_payment` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_record_payment`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_reject_user` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_reject_user` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_reject_user`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_search_customers` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_search_customers` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_search_customers`(IN p_query VARCHAR(255))
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_toggle_user_status` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_toggle_user_status` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_toggle_user_status`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_update_booking_status` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_update_booking_status` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_update_booking_status`(
  IN p_booking_id INT,
  IN p_status     VARCHAR(20)
)
BEGIN
  UPDATE bookings
  SET status     = p_status,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_booking_id;
  SELECT * FROM bookings WHERE id = p_booking_id;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_update_rental_status` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_update_rental_status` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_update_rental_status`(
  IN p_rental_id INT,
  IN p_status    VARCHAR(20)
)
BEGIN
  UPDATE activity_rentals
  SET status     = p_status,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_rental_id;
  SELECT * FROM activity_rentals WHERE id = p_rental_id;
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_update_user_profile` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_update_user_profile` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_update_user_profile`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_upsert_activity` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_upsert_activity` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_upsert_activity`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_upsert_room` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_upsert_room` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_upsert_room`(
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
END */$$
DELIMITER ;

/* Procedure structure for procedure `sp_upsert_service` */

/*!50003 DROP PROCEDURE IF EXISTS  `sp_upsert_service` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`bhh`@`localhost` PROCEDURE `sp_upsert_service`(
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
END */$$
DELIMITER ;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
