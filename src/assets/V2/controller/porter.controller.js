import pools from "../../db/index.js";
import PorterService from "../../services/porter.service.js";
import NotificationService from "../../services/notification.service.js";

const getPorterService = (tenantId) => {
  const apiKey = process.env[`PORTER_API_KEY_${tenantId}`] || process.env.PORTER_API_KEY;
  if (!apiKey) {
    throw new Error("Porter API key not configured");
  }
  return new PorterService(apiKey);
};

const handlePorterWebhook = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const webhookData = req.body;

  try {
    const porterService = getPorterService(tenantId);
    const parsedData = porterService.parseWebhookEvent(webhookData);

    const [orderRows] = await pool.execute(
      `SELECT id, order_status, shop_id, user_id FROM orders WHERE porter_order_id = ? OR order_number = ?`,
      [parsedData.order_number, parsedData.order_number]
    );

    if (!orderRows || orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const order = orderRows[0];
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const updateData = {
        order_status: parsedData.status,
        porter_rider_name: parsedData.rider_details?.name || null,
        porter_rider_phone: parsedData.rider_details?.phone || null,
        porter_rider_lat: parsedData.rider_details?.latitude || null,
        porter_rider_lng: parsedData.rider_details?.longitude || null,
      };

      if (parsedData.estimated_pickup_time) {
        updateData.estimated_pickup_time = parsedData.estimated_pickup_time;
      }
      if (parsedData.estimated_drop_time) {
        updateData.estimated_delivery_time = parsedData.estimated_drop_time;
      }
      if (parsedData.actual_pickup_time) {
        updateData.pickup_time = parsedData.actual_pickup_time;
      }
      if (parsedData.actual_drop_time) {
        updateData.actual_delivery_time = parsedData.actual_drop_time;
        updateData.delivery_date = parsedData.actual_drop_time;
      }

      const setClause = Object.keys(updateData)
        .map((key) => `${key} = ?`)
        .join(", ");
      const values = Object.values(updateData);

      await connection.execute(
        `UPDATE orders SET ${setClause}, updated_at = NOW() WHERE id = ?`,
        [...values, order.id]
      );

      await connection.execute(
        `INSERT INTO order_status_history (order_id, status, description, latitude, longitude, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          order.id,
          parsedData.status,
          `Porter webhook update: ${webhookData.status}`,
          parsedData.rider_details?.latitude || null,
          parsedData.rider_details?.longitude || null,
        ]
      );

      const statusHistory = JSON.stringify({
        status: parsedData.status,
        timestamp: new Date(),
        porter_status: webhookData.status,
        rider_name: parsedData.rider_details?.name,
      });

      await connection.execute(
        `UPDATE orders
         SET status_history = JSON_ARRAY_APPEND(
           COALESCE(status_history, JSON_ARRAY()),
           '$',
           ?
         )
         WHERE id = ?`,
        [statusHistory, order.id]
      );

      await connection.commit();

      await NotificationService.notifyOrderStatus(
        tenantId,
        order.id,
        parsedData.status,
        {
          rider_name: parsedData.rider_details?.name,
          rider_phone: parsedData.rider_details?.phone,
          estimated_delivery: parsedData.estimated_drop_time,
        }
      );

      return res.status(200).json({
        success: true,
        message: "Webhook processed successfully",
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Porter Webhook Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process webhook",
    });
  }
};

const getOrderTracking = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { order_number } = req.params;
  const { id: user_id } = req.user;

  try {
    const [orderRows] = await pool.execute(
      `SELECT
        o.id, o.order_number, o.order_status, o.porter_order_id,
        o.porter_tracking_url, o.porter_rider_name, o.porter_rider_phone,
        o.porter_rider_lat, o.porter_rider_lng,
        o.delivery_latitude, o.delivery_longitude,
        o.pickup_time, o.estimated_delivery_time, o.actual_delivery_time,
        o.delivery_address, o.delivery_city, o.delivery_state,
        s.name as shop_name, s.address_id as shop_address_id
      FROM orders o
      JOIN shops s ON o.shop_id = s.id
      WHERE o.order_number = ? AND o.user_id = ?`,
      [order_number, user_id]
    );

    if (!orderRows || orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const order = orderRows[0];

    let liveTracking = null;
    if (order.porter_order_id) {
      const porterService = getPorterService(tenantId);
      const trackingResult = await porterService.getDeliveryPartnerLocation(
        order.porter_order_id
      );

      if (trackingResult.success) {
        liveTracking = trackingResult.data;
      }
    }

    const [statusHistory] = await pool.execute(
      `SELECT status, description, latitude, longitude, created_at
       FROM order_status_history
       WHERE order_id = ?
       ORDER BY created_at ASC`,
      [order.id]
    );

    return res.status(200).json({
      success: true,
      data: {
        order_number: order.order_number,
        status: order.order_status,
        tracking_url: order.porter_tracking_url,
        rider: {
          name: order.porter_rider_name,
          phone: order.porter_rider_phone,
          current_location: {
            latitude: liveTracking?.latitude || order.porter_rider_lat,
            longitude: liveTracking?.longitude || order.porter_rider_lng,
          },
        },
        destination: {
          address: order.delivery_address,
          city: order.delivery_city,
          state: order.delivery_state,
          coordinates: {
            latitude: order.delivery_latitude,
            longitude: order.delivery_longitude,
          },
        },
        timeline: {
          pickup_time: order.pickup_time,
          estimated_delivery: order.estimated_delivery_time,
          actual_delivery: order.actual_delivery_time,
        },
        status_history: statusHistory,
        live_tracking: liveTracking,
      },
    });
  } catch (error) {
    console.error("Tracking Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch tracking information",
    });
  }
};

const getLiveLocation = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { order_number } = req.params;
  const { id: user_id } = req.user;

  try {
    const [orderRows] = await pool.execute(
      `SELECT porter_order_id, porter_rider_lat, porter_rider_lng
       FROM orders
       WHERE order_number = ? AND user_id = ?`,
      [order_number, user_id]
    );

    if (!orderRows || orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const order = orderRows[0];

    if (!order.porter_order_id) {
      return res.status(200).json({
        success: true,
        data: {
          latitude: order.porter_rider_lat,
          longitude: order.porter_rider_lng,
          message: "Last known location",
        },
      });
    }

    const porterService = getPorterService(tenantId);
    const locationResult = await porterService.getDeliveryPartnerLocation(
      order.porter_order_id
    );

    if (!locationResult.success) {
      return res.status(200).json({
        success: true,
        data: {
          latitude: order.porter_rider_lat,
          longitude: order.porter_rider_lng,
          message: "Last known location",
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        latitude: locationResult.data.latitude,
        longitude: locationResult.data.longitude,
        timestamp: locationResult.data.timestamp || new Date(),
        message: "Live location",
      },
    });
  } catch (error) {
    console.error("Live Location Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch live location",
    });
  }
};

const getNotifications = async (req, res) => {
  const tenantId = req.tenantId;
  const { id: user_id, user_type } = req.user;
  const { page, limit, unread_only } = req.query;

  try {
    const result = await NotificationService.getNotifications(
      tenantId,
      user_id,
      user_type,
      {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        unreadOnly: unread_only === "true",
      }
    );

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(200).json({
      success: true,
      message: "Notifications fetched successfully",
      ...result,
    });
  } catch (error) {
    console.error("Get Notifications Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch notifications",
    });
  }
};

const markNotificationRead = async (req, res) => {
  const tenantId = req.tenantId;
  const { id: user_id } = req.user;
  const { notification_id } = req.params;

  try {
    const result = await NotificationService.markAsRead(
      tenantId,
      notification_id,
      user_id
    );

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Mark Read Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to mark notification as read",
    });
  }
};

const markAllNotificationsRead = async (req, res) => {
  const tenantId = req.tenantId;
  const { id: user_id, user_type } = req.user;

  try {
    const result = await NotificationService.markAllAsRead(
      tenantId,
      user_id,
      user_type
    );

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark All Read Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to mark all notifications as read",
    });
  }
};

export {
  handlePorterWebhook,
  getOrderTracking,
  getLiveLocation,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
