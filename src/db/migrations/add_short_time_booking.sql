-- ================================================================
-- Migration: Add Short Time booking support to bookings table
-- Run against your MySQL database before deploying the updated code.
-- ================================================================

-- 1. Add booking_type discriminator (default 'per_night' preserves all existing records)
ALTER TABLE bookings
  ADD COLUMN booking_type VARCHAR(20) NOT NULL DEFAULT 'per_night' AFTER room_id;

-- 2. Add check_in_time for short-time bookings (TIME only, e.g. '14:00:00')
ALTER TABLE bookings
  ADD COLUMN check_in_time TIME DEFAULT NULL AFTER check_out;

-- 3. Add duration_hours for short-time bookings (1, 2, or 3 max)
ALTER TABLE bookings
  ADD COLUMN duration_hours TINYINT UNSIGNED DEFAULT NULL AFTER check_in_time;

-- 4. Index for efficient lookups by booking type
ALTER TABLE bookings
  ADD INDEX idx_bookings_type (booking_type);

-- Verify
-- SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
-- FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_NAME = 'bookings'
-- ORDER BY ORDINAL_POSITION;
