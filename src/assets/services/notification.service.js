import pools from "../db/index.js";

class NotificationService {
  static async createNotification(tenantId, notificationData) {
    const pool = pools[tenantId];
    const {
      recipient_id,
      recipient_type,
      type,
      title,
      message,
      order_id,
      metadata,
    } = notificationData;

    try {
      const [result] = await pool.execute(
        `INSERT INTO notifications (
          recipient_id, recipient_type, type, title, message, order_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          recipient_id,
          recipient_type,
          type,
          title,
          message,
          order_id || null,
          JSON.stringify(metadata || {}),
        ]
      );

      return {
        success: true,
        notification_id: result.insertId,
      };
    } catch (error) {
      console.error("Notification Creation Error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  static async notifyOrderStatus(tenantId, orderId, status, additionalData = {}) {
    const pool = pools[tenantId];

    try {
      const [orderData] = await pool.execute(
        `SELECT
          o.id, o.order_number, o.user_id, o.shop_id,
          o.porter_order_id, o.porter_tracking_url,
          u.full_name as customer_name, u.phone as customer_phone,
          s.user_id as vendor_user_id, s.name as shop_name
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN shops s ON o.shop_id = s.id
        WHERE o.id = ?`,
        [orderId]
      );

      if (!orderData || orderData.length === 0) {
        return { success: false, error: "Order not found" };
      }

      const order = orderData[0];
      const statusMessages = {
        pending: {
          title: "Order Placed",
          message: `Your order #${order.order_number} has been placed successfully.`,
        },
        order_placed: {
          title: "Order Accepted",
          message: `Your order #${order.order_number} has been accepted by ${order.shop_name}.`,
        },
        shipped: {
          title: "Order Picked Up",
          message: `Your order #${order.order_number} has been picked up and is on the way!`,
        },
        delivered: {
          title: "Order Delivered",
          message: `Your order #${order.order_number} has been delivered successfully.`,
        },
        cancelled: {
          title: "Order Cancelled",
          message: `Your order #${order.order_number} has been cancelled.`,
        },
      };

      const notification = statusMessages[status] || {
        title: "Order Update",
        message: `Your order #${order.order_number} status has been updated.`,
      };

      await this.createNotification(tenantId, {
        recipient_id: order.user_id,
        recipient_type: "CUSTOMER",
        type: `ORDER_${status.toUpperCase()}`,
        title: notification.title,
        message: notification.message,
        order_id: orderId,
        metadata: {
          order_number: order.order_number,
          status,
          tracking_url: order.porter_tracking_url,
          ...additionalData,
        },
      });

      await this.createNotification(tenantId, {
        recipient_id: order.vendor_user_id,
        recipient_type: "VENDOR",
        type: `ORDER_${status.toUpperCase()}`,
        title: `Order Update: ${order.order_number}`,
        message: `Order #${order.order_number} status changed to ${status}.`,
        order_id: orderId,
        metadata: {
          order_number: order.order_number,
          status,
          customer_name: order.customer_name,
          ...additionalData,
        },
      });

      return { success: true };
    } catch (error) {
      console.error("Notification Error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  static async getNotifications(tenantId, userId, userType, options = {}) {
    const pool = pools[tenantId];
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const offset = (page - 1) * limit;

    try {
      let query = `
        SELECT * FROM notifications
        WHERE recipient_id = ? AND recipient_type = ?
      `;
      const params = [userId, userType];

      if (unreadOnly) {
        query += ` AND is_read = 0`;
      }

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const [notifications] = await pool.execute(query, params);

      const [countResult] = await pool.execute(
        `SELECT COUNT(*) as total FROM notifications
         WHERE recipient_id = ? AND recipient_type = ?${
           unreadOnly ? " AND is_read = 0" : ""
         }`,
        [userId, userType]
      );

      return {
        success: true,
        data: notifications.map((n) => ({
          ...n,
          metadata: typeof n.metadata === "string" ? JSON.parse(n.metadata) : n.metadata,
        })),
        pagination: {
          total: countResult[0].total,
          page,
          limit,
          totalPages: Math.ceil(countResult[0].total / limit),
        },
      };
    } catch (error) {
      console.error("Get Notifications Error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  static async markAsRead(tenantId, notificationId, userId) {
    const pool = pools[tenantId];

    try {
      await pool.execute(
        `UPDATE notifications SET is_read = 1, read_at = NOW()
         WHERE id = ? AND recipient_id = ?`,
        [notificationId, userId]
      );

      return { success: true };
    } catch (error) {
      console.error("Mark Read Error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  static async markAllAsRead(tenantId, userId, userType) {
    const pool = pools[tenantId];

    try {
      await pool.execute(
        `UPDATE notifications SET is_read = 1, read_at = NOW()
         WHERE recipient_id = ? AND recipient_type = ? AND is_read = 0`,
        [userId, userType]
      );

      return { success: true };
    } catch (error) {
      console.error("Mark All Read Error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

export default NotificationService;
