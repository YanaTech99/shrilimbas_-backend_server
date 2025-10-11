-- Migration: Add Porter API Integration and Real-time Tracking Support
-- Description: This migration adds fields to support Porter API integration for real-time delivery tracking
--
-- Changes:
-- 1. Orders table: Add Porter tracking fields and rider information
-- 2. Order status history: Enhanced tracking with location data
-- 3. Notifications table: Already exists, no changes needed
--
-- Features Added:
-- - Porter order ID and tracking URL storage
-- - Real-time rider location (latitude/longitude)
-- - Rider contact information (name, phone)
-- - Enhanced timeline tracking (pickup, estimated delivery, actual delivery)

-- Add Porter-related fields to orders table
ALTER TABLE `orders`
ADD COLUMN IF NOT EXISTS `porter_order_id` VARCHAR(255) DEFAULT NULL COMMENT 'Porter API order ID',
ADD COLUMN IF NOT EXISTS `porter_tracking_url` VARCHAR(512) DEFAULT NULL COMMENT 'Porter tracking URL for customers',
ADD COLUMN IF NOT EXISTS `porter_rider_name` VARCHAR(255) DEFAULT NULL COMMENT 'Assigned rider name from Porter',
ADD COLUMN IF NOT EXISTS `porter_rider_phone` VARCHAR(20) DEFAULT NULL COMMENT 'Assigned rider phone number',
ADD COLUMN IF NOT EXISTS `porter_rider_lat` DECIMAL(10,7) DEFAULT NULL COMMENT 'Real-time rider latitude',
ADD COLUMN IF NOT EXISTS `porter_rider_lng` DECIMAL(10,7) DEFAULT NULL COMMENT 'Real-time rider longitude',
ADD COLUMN IF NOT EXISTS `porter_status` VARCHAR(50) DEFAULT NULL COMMENT 'Porter delivery status',
ADD COLUMN IF NOT EXISTS `porter_webhook_data` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`porter_webhook_data`)) COMMENT 'Raw Porter webhook data',
ADD INDEX IF NOT EXISTS `idx_porter_order_id` (`porter_order_id`),
ADD INDEX IF NOT EXISTS `idx_porter_status` (`porter_status`);

-- Update existing indexes for better performance
ALTER TABLE `orders`
ADD INDEX IF NOT EXISTS `idx_order_status_date` (`order_status`, `order_date`),
ADD INDEX IF NOT EXISTS `idx_customer_orders` (`user_id`, `order_date`);

-- Add index to order_status_history for better query performance
ALTER TABLE `order_status_history`
ADD INDEX IF NOT EXISTS `idx_order_status` (`order_id`, `status`, `created_at`);

-- Add index to notifications for better performance
ALTER TABLE `notifications`
ADD INDEX IF NOT EXISTS `idx_notification_read` (`recipient_id`, `is_read`, `created_at`);

-- Create table for Porter webhook logs (for debugging and audit)
CREATE TABLE IF NOT EXISTS `porter_webhook_logs` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) DEFAULT (uuid()),
  `order_id` INT(11) DEFAULT NULL,
  `porter_order_id` VARCHAR(255) DEFAULT NULL,
  `webhook_type` VARCHAR(50) DEFAULT NULL COMMENT 'Type of webhook event',
  `status` VARCHAR(50) DEFAULT NULL COMMENT 'Porter status from webhook',
  `payload` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload`)) COMMENT 'Complete webhook payload',
  `processed` TINYINT(1) DEFAULT 0 COMMENT 'Whether webhook was processed successfully',
  `error_message` TEXT DEFAULT NULL COMMENT 'Error message if processing failed',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_porter_order_id` (`porter_order_id`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_webhook_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Porter webhook event logs for debugging and audit trail';

-- Add Porter API configuration to app_settings
ALTER TABLE `app_settings`
ADD COLUMN IF NOT EXISTS `porter_api_key` VARCHAR(255) DEFAULT NULL COMMENT 'Porter API key',
ADD COLUMN IF NOT EXISTS `porter_environment` ENUM('test','production') DEFAULT 'test' COMMENT 'Porter API environment',
ADD COLUMN IF NOT EXISTS `porter_webhook_url` VARCHAR(512) DEFAULT NULL COMMENT 'Webhook URL for Porter callbacks',
ADD COLUMN IF NOT EXISTS `enable_porter_tracking` TINYINT(1) DEFAULT 1 COMMENT 'Enable Porter integration';

-- Update order status enum to include more granular statuses (if not exists)
-- Note: This uses a safer approach by checking if the column needs modification
SET @dbname = DATABASE();
SET @tablename = 'orders';
SET @columnname = 'order_status';
SET @check_enum = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = @columnname
    AND COLUMN_TYPE LIKE '%out_for_delivery%'
);

-- Add 'out_for_delivery' status if it doesn't exist
SET @sql = IF(
  @check_enum = 0,
  CONCAT('ALTER TABLE ', @tablename, ' MODIFY COLUMN ', @columnname,
    ' ENUM(''pending'',''order_placed'',''shipped'',''out_for_delivery'',''delivered'',''cancelled'') DEFAULT ''pending'''),
  'SELECT ''Status already updated'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Insert default Porter configuration if app_settings exists
INSERT IGNORE INTO `app_settings` (user_id, enable_porter_tracking, porter_environment)
SELECT 1, 1, 'test'
WHERE NOT EXISTS (SELECT 1 FROM `app_settings` LIMIT 1);

-- Migration completed successfully
SELECT 'Porter tracking integration migration completed successfully' AS status;
