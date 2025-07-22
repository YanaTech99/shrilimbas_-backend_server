import pools from "../db/index.js";
import { generateInvoicePDF } from "../utils/puppeteer.util.js";

const placeOrder = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || !customer_id[0]) {
    return res.status(404).json({
      success: false,
      message: "Customer not found",
    });
  }

  const connection = await pool.getConnection();

  await connection.beginTransaction();

  try {
    const {
      delivery_address,
      delivery_city,
      delivery_state,
      delivery_country,
      delivery_postal_code,
      delivery_latitude,
      delivery_longitude,
      delivery_instructions,
      items,
      payment_method,
      coupon_code,
      notes,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No items in the order",
      });
    }

    // Validate and lock product stock
    let subTotal = 0;
    const orderItems = [];
    let shop_id = null;

    for (const item of items) {
      const [productRow] = await connection.execute(
        `SELECT p.*, pv.stock, pv.id as variant_id
         FROM products p
         LEFT JOIN product_variants pv ON p.id = pv.product_id
         WHERE p.id = ? AND (pv.id IS NULL OR pv.id = ?)
         FOR UPDATE`,
        [item.product_id, item.product_variant_id || null]
      );

      if (productRow.length === 0)
        return res.status(404).json({
          success: false,
          error: `Product ${item.product_id} not found`,
        });

      const product = productRow[0];
      shop_id = product.shop_id;

      const availableStock = product.stock ?? product.stock_quantity;
      if (availableStock < item.quantity) {
        return res.status(400).json({
          success: false,
          error: `Not enough stock for product ${item.product_id}`,
        });
      }

      const price = parseFloat(product.selling_price);
      const tax = parseFloat(product.tax_percentage || 0);
      const discount = parseFloat(product.discount || 0);

      const lineTotal = (price - discount + tax) * item.quantity;
      subTotal += lineTotal;

      orderItems.push({
        ...item,
        price_per_unit: price,
        discount_per_unit: discount,
        tax_per_unit: tax,
        sku: product.sku || "",
        product_snapshot: JSON.stringify(product),
      });
    }

    // Apply coupon logic (stub example)
    let discountAmount = 0;
    if (coupon_code) {
      // Apply logic to validate coupon and calculate discountAmount
      discountAmount = 50; // dummy value
    }

    const taxAmount = subTotal * 0.1; // 10% tax
    const shippingFee = 40; // Flat fee (optional logic)
    const totalAmount = subTotal - discountAmount + taxAmount + shippingFee;

    // Insert order
    const order_number = `ORD-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    const statusHistory = JSON.stringify([
      { status: "pending", timestamp: new Date() },
    ]);

    const [orderResult] = await connection.execute(
      `INSERT INTO orders (
        order_number, customer_id, shop_id, delivery_address, delivery_city,
        delivery_state, delivery_country, delivery_postal_code, delivery_latitude, delivery_longitude,
        delivery_instructions, payment_method, payment_status, sub_total,
        discount_amount, tax_amount, shipping_fee, coupon_code, coupon_discount,
        notes, status_history
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order_number,
        customer_id[0].id,
        shop_id,
        delivery_address || "address",
        delivery_city || "",
        delivery_state || "",
        delivery_country || "",
        delivery_postal_code || "",
        delivery_latitude || 0,
        delivery_longitude || 0,
        delivery_instructions || "",
        payment_method || "",
        subTotal,
        discountAmount || 0,
        taxAmount || 0,
        shippingFee || 0,
        coupon_code || null,
        discountAmount || 0,
        notes || null,
        statusHistory,
      ]
    );

    const orderId = orderResult.insertId;

    // Insert order items and update stock
    for (const item of orderItems) {
      await connection.execute(
        `INSERT INTO order_items (
          order_id, product_id, product_variant_id, quantity,
          price_per_unit, discount_per_unit, tax_per_unit,
          sku, product_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.product_id,
          item.product_variant_id || null,
          item.quantity,
          item.price_per_unit,
          item.discount_per_unit,
          item.tax_per_unit,
          item.sku,
          item.product_snapshot,
        ]
      );

      // Update stock
      // if (item.product_variant_id) {
      //   await connection.execute(
      //     `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
      //     [item.quantity, item.product_variant_id]
      //   );
      // } else {
      //   await connection.execute(
      //     `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
      //     [item.quantity, item.product_id]
      //   );
      // }
    }

    await connection.commit();

    // get customer details
    const [customerDetails] = await pool.query(
      `SELECT name FROM customers WHERE id = ?`,
      [user_id]
    );

    // Generate invoice
    const orderData = {
      order_number,
      date: new Date().toLocaleDateString(),
      customer_name: customerDetails[0]?.name || "Customer",
      items: orderItems.map((i) => ({
        name: i.product_snapshot
          ? JSON.parse(i.product_snapshot).name
          : "Product",
        quantity: i.quantity,
        price: i.price_per_unit,
      })),
      total: totalAmount,
    };

    // Generate PDF
    const fileName = `invoice-${order_number}.pdf`;
    const relativePath = await generateInvoicePDF(orderData, fileName);
    console.log(relativePath);

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      data: orderData,
    });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    connection.release();
  }
};

const updateStatus = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can update order status.",
    });
  }

  const [shop_id] = await pool.execute(
    `SELECT id FROM shops WHERE user_id = ?`,
    [user_id]
  );

  if (!shop_id || shop_id[0].length === 0) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
    });
  }

  const { order_number, status } = req.body;

  if (!order_number || order_number === "" || order_number === "undefined") {
    return res.status(400).json({
      success: false,
      error: "Invalid order number",
    });
  }

  if (!status || status === "" || status === "undefined") {
    return res.status(400).json({
      success: false,
      error: "Invalid status",
    });
  }

  const connection = await pool.getConnection();

  try {
    // Get order
    const [orderRows] = await connection.execute(
      `SELECT id FROM orders WHERE order_number = ? AND shop_id = ?`,
      [order_number, shop_id[0].id]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const orderId = orderRows[0].id;

    // Update order status
    await connection.execute(
      `UPDATE orders SET status_history = JSON_ARRAY_APPEND(status_history, '$', JSON_OBJECT('status', ?, 'timestamp', NOW())), order_status = ? WHERE id = ?`,
      [status, status, orderId]
    );

    return res.status(200).json({
      success: true,
      message: "Order status updated successfully",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    connection.release();
  }
};

const getOrderByCustomerID = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.execute(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id[0].length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const { order_number } = req.query;

  if (!order_number || order_number === "" || order_number === "undefined") {
    return res.status(400).json({
      success: false,
      error: "Invalid order number",
    });
  }

  const connection = await pool.getConnection();

  try {
    // Get order
    const [orderRows] = await connection.execute(
      `SELECT 
         id, order_number, order_status, order_date, delivery_date,
         delivery_address, delivery_city, delivery_state, delivery_country, delivery_postal_code,
         delivery_latitude, delivery_longitude, delivery_instructions,
         payment_method, payment_status,
         sub_total, discount_amount, tax_amount, shipping_fee, total_amount,
         coupon_code, coupon_discount, currency,
         status_history
       FROM orders
       WHERE order_number = ? AND customer_id = ?
       LIMIT 1`,
      [order_number, customer_id[0].id]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const order = orderRows[0];
    const orderId = orderRows[0].id;

    // Get order items
    const [items] = await connection.execute(
      `SELECT 
         product_id, product_variant_id, quantity,
         price_per_unit, discount_per_unit, tax_per_unit,
         total_price, sku, product_snapshot
       FROM order_items
       WHERE order_id = ?`,
      [orderId]
    );

    const formattedItems = items.map((item) => {
      return {
        product_id: item.product_id,
        variant_id: item.product_variant_id,
        quantity: item.quantity,
        sku: item.sku,
        price: {
          unit: item.price_per_unit,
          discount: item.discount_per_unit,
          tax: item.tax_per_unit,
          total: item.total_price,
        },
        snapshot:
          typeof item.product_snapshot === "string"
            ? JSON.parse(item.product_snapshot)
            : item.product_snapshot,
      };
    });

    return res.json({
      success: true,
      message: "Order retrieved successfully",
      data: {
        order_number: order.order_number,
        status: order.order_status,
        placed_at: order.order_date,
        delivered_at: order.delivery_date,
        delivery: {
          address: order.delivery_address,
          city: order.delivery_city,
          state: order.delivery_state,
          country: order.delivery_country,
          postal_code: order.delivery_postal_code,
          instructions: order.delivery_instructions,
          coordinates: {
            lat: order.delivery_latitude,
            lng: order.delivery_longitude,
          },
        },
        payment: {
          method: order.payment_method,
          status: order.payment_status,
          subtotal: order.sub_total,
          discount: order.discount_amount,
          tax: order.tax_amount,
          shipping: order.shipping_fee,
          total: order.total_amount,
          currency: order.currency,
          coupon: order.coupon_code,
          coupon_discount: order.coupon_discount,
        },
        items: formattedItems,
        status_history:
          typeof order.status_history === "string"
            ? JSON.parse(order.status_history)
            : order.status_history,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    connection.release();
  }
};

const getOrderByShopID = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [shop_id] = await pool.execute(
    `SELECT id FROM shops WHERE user_id = ?`,
    [user_id]
  );

  if (!shop_id || shop_id[0].length === 0) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
    });
  }

  const connection = await pool.getConnection();

  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // --- Count total for pagination
    const [countRows] = await connection.execute(
      `
      SELECT COUNT(*) AS total
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.shop_id = ?
      AND (
        o.order_number LIKE ? OR
        c.name LIKE ?
      )
    `,
      [shop_id[0].id, `%${search}%`, `%${search}%`]
    );
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limit);

    // --- Main paginated order query
    const [orders] = await connection.query(
      `
      SELECT 
        o.id,
        o.order_number,
        o.order_status,
        o.order_date,
        o.delivery_date,
        o.payment_method,
        o.payment_status,
        o.total_amount,
        o.sub_total,
        o.discount_amount,
        o.tax_amount,
        o.shipping_fee,
        o.coupon_code,
        o.coupon_discount,
        o.currency,
        o.notes,

        o.delivery_address,
        o.delivery_city,
        o.delivery_state,
        o.delivery_country,
        o.delivery_postal_code,
        o.delivery_latitude,
        o.delivery_longitude,
        o.delivery_instructions,

        o.delivery_window,
        o.status_history,
        o.payment_metadata,

        c.name AS customer_name,
        c.email AS customer_email,
        c.alternate_phone AS customer_phone
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.shop_id = ?
        AND (
          o.order_number LIKE ?
          OR c.name LIKE ?
        )
      ORDER BY o.order_date DESC
      LIMIT ?
      OFFSET ?
      `,
      [shop_id[0].id, `%${search}%`, `%${search}%`, limit, offset]
    );

    // --- Get all order items for these orders
    const orderIds = orders.map((order) => order.id);
    let orderItems = [];

    if (orderIds.length > 0) {
      const [items] = await connection.query(
        `
        SELECT 
          oi.*, 
          p.product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id IN (?)
      `,
        [orderIds]
      );

      orderItems = items;
    }

    // --- Group items by order
    const itemsByOrder = {};
    for (const item of orderItems) {
      if (!itemsByOrder[item.order_id]) {
        itemsByOrder[item.order_id] = [];
      }
      itemsByOrder[item.order_id].push({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        product_variant_id: item.product_variant_id,
        quantity: item.quantity,
        price_per_unit: item.price_per_unit,
        discount_per_unit: item.discount_per_unit,
        tax_per_unit: item.tax_per_unit,
        total_price: item.total_price,
        sku: item.sku,
        product_snapshot:
          typeof item.product_snapshot === "string"
            ? JSON.parse(item.product_snapshot)
            : item.product_snapshot,
        notes: item.notes,
        created_at: item.created_at,
      });
    }

    // --- Final Response
    const response = orders.map((order) => ({
      id: order.id,
      order_number: order.order_number,
      status: order.order_status,
      order_date: order.order_date,
      delivery_date: order.delivery_date,
      payment_method: order.payment_method,
      payment_status: order.payment_status,

      sub_total: order.sub_total,
      discount_amount: order.discount_amount,
      tax_amount: order.tax_amount,
      shipping_fee: order.shipping_fee,
      total_amount: order.total_amount,
      coupon_code: order.coupon_code,
      coupon_discount: order.coupon_discount,
      currency: order.currency,
      notes: order.notes,

      delivery: {
        address: order.delivery_address,
        city: order.delivery_city,
        state: order.delivery_state,
        country: order.delivery_country,
        postal_code: order.delivery_postal_code,
        latitude: order.delivery_latitude,
        longitude: order.delivery_longitude,
        instructions: order.delivery_instructions,
        window: JSON.parse(order.delivery_window || "{}"),
      },

      customer: {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
      },

      payment_metadata: JSON.parse(order.payment_metadata || "{}"),
      status_history:
        typeof order.status_history === "string"
          ? JSON.parse(order.status_history)
          : order.status_history,
      items: itemsByOrder[order.id] || [],
    }));

    return res.status(200).json({
      success: true,
      orders: response,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (err) {
    console.error("Error fetching orders:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch orders" });
  } finally {
    if (connection) connection.release();
  }
};

export { placeOrder, getOrderByCustomerID, getOrderByShopID, updateStatus };
