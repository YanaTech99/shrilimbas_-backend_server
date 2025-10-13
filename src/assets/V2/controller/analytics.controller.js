// src/assets/V2/controller/analytics.controller.js
import pools from "../../db/index.js";

/**
 * Get comprehensive dashboard analytics
 */
const getDashboardAnalytics = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  try {
    let shop_id = null;

    // Get shop_id if user is a vendor
    if (user_type === "VENDOR") {
      const [shopRows] = await pool.execute(
        `SELECT id FROM shops WHERE user_id = ? AND is_active = 1 LIMIT 1`,
        [user_id]
      );

      if (!shopRows || shopRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Shop not found for this vendor",
        });
      }

      shop_id = shopRows[0].id;
    } else if (user_type !== "ADMIN") {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Only vendors and admins can access analytics",
      });
    }

    // Build WHERE clause based on user type
    const orderWhereClause = shop_id ? `WHERE o.shop_id = ${shop_id}` : "";
    const productWhereClause = shop_id
      ? `WHERE p.shop_id = ${shop_id} AND p.is_deleted = 0`
      : "WHERE p.is_deleted = 0";

    // Execute all queries in parallel for better performance
    const [
      totalOrdersResult,
      todayOrdersResult,
      totalCustomersResult,
      todayCustomersResult,
      activeOrdersResult,
      totalProductsResult,
      recentOrdersResult,
      ordersByStatusResult,
      revenueStatsResult,
      topProductsResult,
    ] = await Promise.all([
      // Total Orders
      pool.query(
        `SELECT COUNT(*) as total FROM orders o ${orderWhereClause}`
      ),

      // Today's Orders
      pool.query(
        `SELECT COUNT(*) as total 
         FROM orders o 
         ${orderWhereClause}
         ${orderWhereClause ? "AND" : "WHERE"} DATE(o.created_at) = CURDATE()`
      ),

      // Total Customers (who have ordered from this shop)
      pool.query(
        shop_id
          ? `SELECT COUNT(DISTINCT o.user_id) as total 
             FROM orders o
             WHERE o.shop_id = ${shop_id}`
          : `SELECT COUNT(DISTINCT c.id) as total 
             FROM customers c
             JOIN users u ON c.user_id = u.id
             WHERE u.is_active = 1 AND u.is_deleted = 0`
      ),

      // Today's Customers (who ordered today from this shop)
      pool.query(
        shop_id
          ? `SELECT COUNT(DISTINCT o.user_id) as total 
             FROM orders o
             WHERE o.shop_id = ${shop_id}
             AND DATE(o.created_at) = CURDATE()`
          : `SELECT COUNT(DISTINCT c.id) as total 
             FROM customers c
             JOIN users u ON c.user_id = u.id
             WHERE u.is_active = 1 
             AND u.is_deleted = 0
             AND DATE(c.created_at) = CURDATE()`
      ),

      // Active Orders (pending, order_placed, shipped)
      pool.query(
        `SELECT COUNT(*) as total 
         FROM orders o 
         ${orderWhereClause}
         ${orderWhereClause ? "AND" : "WHERE"} o.order_status IN ('pending', 'order_placed', 'shipped')`
      ),

      // Total Products
      pool.query(
        `SELECT COUNT(*) as total FROM products p ${productWhereClause}`
      ),

      // Recent Orders (last 5)
      pool.query(
        `SELECT 
          o.id,
          o.order_number,
          o.order_status,
          o.total_amount,
          o.order_date,
          o.payment_status,
          u.full_name as customer_name,
          u.phone as customer_phone
         FROM orders o
         JOIN users u ON o.user_id = u.id
         ${orderWhereClause}
         ORDER BY o.created_at DESC
         LIMIT 5`
      ),

      // Orders by Status
      pool.query(
        `SELECT 
          o.order_status,
          COUNT(*) as count,
          SUM(o.total_amount) as total_revenue
         FROM orders o
         ${orderWhereClause}
         GROUP BY o.order_status`
      ),

      // Revenue Statistics
      pool.query(
        `SELECT 
          COUNT(*) as total_orders,
          SUM(o.total_amount) as total_revenue,
          AVG(o.total_amount) as avg_order_value,
          SUM(CASE WHEN DATE(o.created_at) = CURDATE() THEN o.total_amount ELSE 0 END) as today_revenue,
          SUM(CASE WHEN DATE(o.created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN o.total_amount ELSE 0 END) as week_revenue,
          SUM(CASE WHEN MONTH(o.created_at) = MONTH(CURDATE()) AND YEAR(o.created_at) = YEAR(CURDATE()) THEN o.total_amount ELSE 0 END) as month_revenue
         FROM orders o
         ${orderWhereClause}
         ${orderWhereClause ? "AND" : "WHERE"} o.payment_status = 'paid'`
      ),

      // Top Products (by quantity sold)
      pool.query(
        `SELECT 
          p.id,
          p.product_name,
          SUM(oi.quantity) as total_sold,
          SUM(oi.total_price) as total_revenue,
          COUNT(DISTINCT oi.order_id) as order_count
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         JOIN orders o ON oi.order_id = o.id
         ${orderWhereClause}
         GROUP BY p.id, p.product_name
         ORDER BY total_sold DESC
         LIMIT 5`
      ),
    ]);

    // Extract data from query results
    const totalOrders = totalOrdersResult[0][0].total;
    const todayOrders = todayOrdersResult[0][0].total;
    const totalCustomers = totalCustomersResult[0][0].total;
    const todayCustomers = todayCustomersResult[0][0].total;
    const activeOrders = activeOrdersResult[0][0].total;
    const totalProducts = totalProductsResult[0][0].total;
    const recentOrders = recentOrdersResult[0];
    const ordersByStatus = ordersByStatusResult[0];
    const revenueStats = revenueStatsResult[0][0];
    const topProducts = topProductsResult[0];

    // Calculate growth percentages
    let orderGrowth = 0;
    let customerGrowth = 0;

    // Get yesterday's counts for growth calculation
    const [yesterdayOrders] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM orders o 
       ${orderWhereClause}
       ${orderWhereClause ? "AND" : "WHERE"} DATE(o.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`
    );

    const [yesterdayCustomers] = await pool.query(
      shop_id
        ? `SELECT COUNT(DISTINCT o.user_id) as total 
           FROM orders o
           WHERE o.shop_id = ${shop_id}
           AND DATE(o.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`
        : `SELECT COUNT(DISTINCT c.id) as total 
           FROM customers c
           JOIN users u ON c.user_id = u.id
           WHERE u.is_active = 1 
           AND u.is_deleted = 0
           AND DATE(c.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`
    );

    if (yesterdayOrders[0].total > 0) {
      orderGrowth =
        ((todayOrders - yesterdayOrders[0].total) / yesterdayOrders[0].total) *
        100;
    } else if (todayOrders > 0) {
      orderGrowth = 100;
    }

    if (yesterdayCustomers[0].total > 0) {
      customerGrowth =
        ((todayCustomers - yesterdayCustomers[0].total) /
          yesterdayCustomers[0].total) *
        100;
    } else if (todayCustomers > 0) {
      customerGrowth = 100;
    }

    // Format response
    const analytics = {
      // Main KPIs
      overview: {
        total_orders: {
          count: totalOrders,
          today: todayOrders,
          growth_percentage: parseFloat(orderGrowth.toFixed(2)),
        },
        total_customers: {
          count: totalCustomers,
          today: todayCustomers,
          growth_percentage: parseFloat(customerGrowth.toFixed(2)),
        },
        active_orders: {
          count: activeOrders,
          percentage:
            totalOrders > 0
              ? parseFloat(((activeOrders / totalOrders) * 100).toFixed(2))
              : 0,
        },
        total_products: {
          count: totalProducts,
        },
      },

      // Revenue Statistics
      revenue: {
        total: parseFloat(revenueStats.total_revenue || 0).toFixed(2),
        today: parseFloat(revenueStats.today_revenue || 0).toFixed(2),
        this_week: parseFloat(revenueStats.week_revenue || 0).toFixed(2),
        this_month: parseFloat(revenueStats.month_revenue || 0).toFixed(2),
        average_order_value: parseFloat(
          revenueStats.avg_order_value || 0
        ).toFixed(2),
      },

      // Orders by Status
      orders_by_status: ordersByStatus.map((item) => ({
        status: item.order_status,
        count: item.count,
        revenue: parseFloat(item.total_revenue || 0).toFixed(2),
      })),

      // Recent Orders
      recent_orders: recentOrders.map((order) => ({
        id: order.id,
        order_number: order.order_number,
        status: order.order_status,
        amount: parseFloat(order.total_amount).toFixed(2),
        date: order.order_date,
        payment_status: order.payment_status,
        customer: {
          name: order.customer_name || "N/A",
          phone: order.customer_phone || "N/A",
        },
      })),

      // Top Products
      top_products: topProducts.map((product) => ({
        id: product.id,
        name: product.product_name,
        thumbnail: product.thumbnail,
        quantity_sold: product.total_sold,
        revenue: parseFloat(product.total_revenue || 0).toFixed(2),
        order_count: product.order_count,
      })),
    };

    return res.status(200).json({
      success: true,
      message: "Dashboard analytics fetched successfully",
      data: analytics,
    });
  } catch (error) {
    console.error("Dashboard Analytics Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard analytics",
    });
  }
};

/**
 * Get order statistics by date range
 */
const getOrderStatistics = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;
  const { start_date, end_date, group_by = "day" } = req.query;

  try {
    let shop_id = null;

    if (user_type === "VENDOR") {
      const [shopRows] = await pool.execute(
        `SELECT id FROM shops WHERE user_id = ? AND is_active = 1 LIMIT 1`,
        [user_id]
      );

      if (!shopRows || shopRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Shop not found",
        });
      }

      shop_id = shopRows[0].id;
    } else if (user_type !== "ADMIN") {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access",
      });
    }

    // Default to last 30 days if no date range provided
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end_date || new Date().toISOString().split('T')[0];

    // Determine grouping format
    let dateFormat;
    switch (group_by) {
      case "hour":
        dateFormat = "%Y-%m-%d %H:00:00";
        break;
      case "week":
        dateFormat = "%Y-%u";
        break;
      case "month":
        dateFormat = "%Y-%m";
        break;
      case "year":
        dateFormat = "%Y";
        break;
      default:
        dateFormat = "%Y-%m-%d";
    }

    const whereClause = shop_id
      ? `WHERE o.shop_id = ${shop_id} AND DATE(o.created_at) BETWEEN '${startDate}' AND '${endDate}'`
      : `WHERE DATE(o.created_at) BETWEEN '${startDate}' AND '${endDate}'`;

    const [statistics] = await pool.query(
      `SELECT 
        DATE_FORMAT(o.created_at, ?) as period,
        COUNT(*) as order_count,
        SUM(o.total_amount) as total_revenue,
        AVG(o.total_amount) as avg_order_value,
        SUM(CASE WHEN o.order_status = 'delivered' THEN 1 ELSE 0 END) as delivered_count,
        SUM(CASE WHEN o.order_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
       FROM orders o
       ${whereClause}
       GROUP BY period
       ORDER BY period ASC`,
      [dateFormat]
    );

    return res.status(200).json({
      success: true,
      message: "Order statistics fetched successfully",
      data: {
        start_date: startDate,
        end_date: endDate,
        group_by,
        statistics: statistics.map((stat) => ({
          period: stat.period,
          orders: stat.order_count,
          revenue: parseFloat(stat.total_revenue || 0).toFixed(2),
          average_value: parseFloat(stat.avg_order_value || 0).toFixed(2),
          delivered: stat.delivered_count,
          cancelled: stat.cancelled_count,
        })),
      },
    });
  } catch (error) {
    console.error("Order Statistics Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch order statistics",
    });
  }
};

/**
 * Get customer analytics
 */
const getCustomerAnalytics = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  try {
    let shop_id = null;

    if (user_type === "VENDOR") {
      const [shopRows] = await pool.execute(
        `SELECT id FROM shops WHERE user_id = ? AND is_active = 1 LIMIT 1`,
        [user_id]
      );

      if (!shopRows || shopRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Shop not found",
        });
      }

      shop_id = shopRows[0].id;
    } else if (user_type !== "ADMIN") {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access",
      });
    }

    const orderWhereClause = shop_id ? `WHERE o.shop_id = ${shop_id}` : "";

    // Top customers by order count and revenue
    const [topCustomers] = await pool.query(
      `SELECT 
        u.id,
        u.full_name,
        u.phone,
        c.email,
        c.profile_image_url,
        COUNT(DISTINCT o.id) as total_orders,
        SUM(o.total_amount) as total_spent,
        AVG(o.total_amount) as avg_order_value,
        MAX(o.created_at) as last_order_date
       FROM users u
       JOIN customers c ON u.id = c.user_id
       JOIN orders o ON u.id = o.user_id
       ${orderWhereClause}
       GROUP BY u.id, u.full_name, u.phone, c.email, c.profile_image_url
       ORDER BY total_spent DESC
       LIMIT 10`
    );

    // Customer acquisition trend (last 12 months)
    const [acquisitionTrend] = await pool.query(
      `SELECT 
        DATE_FORMAT(c.created_at, '%Y-%m') as month,
        COUNT(*) as new_customers
       FROM customers c
       JOIN users u ON c.user_id = u.id
       WHERE u.is_active = 1
       AND c.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month
       ORDER BY month ASC`
    );

    return res.status(200).json({
      success: true,
      message: "Customer analytics fetched successfully",
      data: {
        top_customers: topCustomers.map((customer) => ({
          id: customer.id,
          name: customer.full_name || "N/A",
          phone: customer.phone,
          email: customer.email,
          profile_image: customer.profile_image_url,
          orders: customer.total_orders,
          total_spent: parseFloat(customer.total_spent || 0).toFixed(2),
          avg_order_value: parseFloat(customer.avg_order_value || 0).toFixed(2),
          last_order: customer.last_order_date,
        })),
        acquisition_trend: acquisitionTrend,
      },
    });
  } catch (error) {
    console.error("Customer Analytics Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch customer analytics",
    });
  }
};

export { getDashboardAnalytics, getOrderStatistics, getCustomerAnalytics };