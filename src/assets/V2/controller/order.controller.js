import pools from "../../db/index.js";
import { generateInvoicePDF } from "../../utils/generateInvoice.util.js";
import { uploadInvoiceToCloudinary } from "../../utils/cloudinary.util.js";
import fs from "fs";
import crypto from "crypto";

const placeOrder = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE user_id = ?`,
    [user_id]
  );

  if (!customer_id || !customer_id[0]) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
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
    let tax_subtotal = 0;
    const orderItems = [];
    let shop_id = null;

    for (const item of items) {
      if (!item.product_id || !item.product_variant_id || !item.quantity) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: "Invalid item data",
        });
      }

      const [productRow] = await connection.execute(
        `SELECT 
          p.*, 
          pv.id AS variant_id,
          pv.sku AS variant_sku,
          pv.barcode AS variant_barcode,
          pv.color AS variant_color,
          pv.size AS variant_size,
          pv.material AS variant_material,
          pv.thumbnail AS variant_thumbnail,
          pv.gallery_images AS variant_gallery_images,
          pv.base_price AS variant_base_price,
          pv.selling_price AS variant_selling_price,
          pv.cost_price AS variant_cost_price,
          pv.stock AS variant_stock
        FROM products p
        LEFT JOIN product_variants pv ON p.id = pv.product_id
        WHERE p.id = ? AND pv.id = ?
        FOR UPDATE`,
        [item.product_id, item.product_variant_id]
      );

      if (productRow.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          error: `Product ${item.product_id} not found`,
        });
      }

      const product = productRow[0];
      shop_id = product.shop_id;

      const availableStock = product.stock_quantity;
      if (
        availableStock < item.quantity &&
        product.variant_stock < item.quantity
      ) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: `Not enough stock for product ${item.product_id}`,
        });
      }

      const price = parseFloat(product.variant_selling_price);
      const tax = parseFloat(product.tax_percentage || 0);
      const discount = 0;

      const lineTotal = price * item.quantity;
      subTotal += lineTotal;
      tax_subtotal += tax * item.quantity;

      orderItems.push({
        ...item,
        price_per_unit: price,
        discount_per_unit: discount || 0,
        tax_per_unit: tax,
        sku: product.sku || "",
        product_snapshot: JSON.stringify(product),
        variant_snapshot: product.variant_id
          ? JSON.stringify({
              id: product.variant_id,
              sku: product.variant_sku,
              barcode: product.variant_barcode,
              color: product.variant_color,
              size: product.variant_size,
              material: product.variant_material,
              thumbnail: product.variant_thumbnail,
              gallery_images:
                product.variant_gallery_images &&
                typeof product.variant_gallery_images === "string"
                  ? JSON.parse(product.variant_gallery_images)
                  : [],
              selling_price: parseFloat(product.variant_selling_price),
            })
          : null,
      });
    }

    // Apply coupon logic (stub example)
    let discountAmount = 0;
    // if (coupon_code) {
    //   // Apply logic to validate coupon and calculate discountAmount
    //   discountAmount = 50; // dummy value
    // }

    const taxAmount = tax_subtotal; // 10% tax
    const shippingFee = 0; // Flat fee (optional logic)
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
        order_number, user_id, shop_id, delivery_address, delivery_city,
        delivery_state, delivery_country, delivery_postal_code, delivery_latitude, delivery_longitude,
        delivery_instructions, payment_method, payment_status, sub_total,
        discount_amount, tax_amount, shipping_fee, coupon_code, coupon_discount,
        notes, status_history
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order_number,
        user_id,
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
          price_per_unit, discount_per_unit, tax_per_unit, product_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.product_id,
          item.product_variant_id || null,
          item.quantity,
          item.price_per_unit,
          item.discount_per_unit,
          item.tax_per_unit,
          item.product_snapshot,
        ]
      );

      // Update stock
      if (item.product_variant_id) {
        const [result] = await connection.execute(
          `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
          [item.quantity, item.product_variant_id]
        );

        if (result.affectedRows === 0) {
          await connection.rollback();
          return res.status(500).json({
            success: false,
            error: `Failed to update stock for product variant ${item.product_variant_id}`,
          });
        }
      }

      const [result] = await connection.execute(
        `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
        [item.quantity, item.product_id]
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(500).json({
          success: false,
          error: `Failed to update stock for product ${item.product_id}`,
        });
      }
    }

    // Remove from cart items
    const [cartResult] = await connection.execute(
      `DELETE FROM cart_items WHERE customer_id = ?`,
      [customer_id[0].id]
    );

    if (cartResult.affectedRows === 0) {
      console.error("Failed to remove cart items");
    }

    await connection.commit();

    // Get full customer details (optional additional fields)

    const [customerDetails] = await pool.query(
      `SELECT name, email, alternate_phone FROM customers WHERE user_id = ?`,
      [user_id]
    );

    const customer = customerDetails[0] || {};
    const now = new Date();

    // Prepare order data
    const orderData = {
      order_id: orderId,
      order_number,
      date: now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
      time: now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
      payment_method,
      payment_status: "unpaid",
      customer: {
        name: customer.name || "Customer",
        email: customer.email || "",
        phone: customer.phone || "",
        alternate_phone: customer.alternate_phone || "",
      },
      delivery_address: {
        address: delivery_address || "N/A",
        city: delivery_city || "",
        state: delivery_state || "",
        country: delivery_country || "",
        postal_code: delivery_postal_code || "",
        instructions: delivery_instructions || "",
      },
      items: orderItems.map((item) => {
        const snapshot = item.product_snapshot
          ? JSON.parse(item.product_snapshot)
          : {};

        const variant = item.variant_snapshot
          ? JSON.parse(item.variant_snapshot)
          : null;

        const price = item.price_per_unit;
        const discount = item.discount_per_unit;
        const tax = item.tax_per_unit;
        const totalPerItem = (price - discount + tax) * item.quantity;

        return {
          name: snapshot.product_name || snapshot.name || "Product",
          sku: item.sku || "",
          quantity: item.quantity,
          price_per_unit: item.price_per_unit,
          discount_per_unit: item.discount_per_unit,
          tax_per_unit: item.tax_per_unit,
          total: totalPerItem,
          variant: variant
            ? {
                id: variant.id,
                sku: variant.sku,
                barcode: variant.barcode,
                color: variant.color,
                size: variant.size,
                material: variant.material,
                thumbnail: variant.thumbnail,
                gallery_images: variant.gallery_images || [],
                base_price: variant.base_price,
                selling_price: variant.selling_price,
                cost_price: variant.cost_price,
                stock: variant.stock,
              }
            : null,
        };
      }),
      price_summary: {
        sub_total: subTotal,
        discount: discountAmount,
        tax: taxAmount,
        shipping_fee: shippingFee,
        total: totalAmount,
      },
      notes: notes || "",
    };

    // Generate PDF invoice
    const randomStr = crypto.randomBytes(4).toString("hex");
    const fileName = `invoice-${order_number}-${randomStr}.pdf`;
    const { relativePath, pdfBuffer } = await generateInvoicePDF(
      orderData,
      fileName,
      tenantId
    );

    // Upload PDF to Cloudinary
    let cloudinaryUrl = "";
    try {
      cloudinaryUrl = await uploadInvoiceToCloudinary(
        pdfBuffer,
        fileName,
        relativePath,
        tenantId
      );

      await connection.execute(
        `UPDATE orders SET invoice_url = ? WHERE id = ?`,
        [cloudinaryUrl, orderId]
      );
    } catch (uploadErr) {
      console.error("Invoice upload failed:", uploadErr);
    }

    if (fs.existsSync(relativePath)) {
      fs.unlink(relativePath, (err) => {
        if (err) console.error("⚠️ Error deleting PDF:", err.message);
      });
    }

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      pdfUrl: cloudinaryUrl,
      data: orderData,
    });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Failed to place order",
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
      error: "Forbidden: Only vendors can update order status.",
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
    `SELECT id FROM customers WHERE user_id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id[0].length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const connection = await pool.getConnection();

  try {
    // Get order
    const [orderRows] = await connection.execute(
      `SELECT 
         id, order_number, order_status, order_date, delivery_date, invoice_url,
         delivery_address, delivery_city, delivery_state, delivery_country, delivery_postal_code,
         delivery_latitude, delivery_longitude, delivery_instructions,
         payment_method, payment_status,
         sub_total, discount_amount, tax_amount, shipping_fee, total_amount,
         coupon_code, coupon_discount, currency,
         status_history
       FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
      [user_id]
    );

    if (orderRows.length === 0) {
      return res.status(200).json({
        success: true,
        error: "Order not found",
      });
    }

    const orderIds = orderRows.map((order) => order.id);

    // Get order items
    let items = [];

    for (const orderId of orderIds) {
      const [orderItems] = await connection.execute(
        `SELECT * FROM order_items WHERE order_id = ?`,
        [orderId]
      );
      items = items.concat(orderItems);
    }

    const formattedResponse = orderRows.map((order) => ({
      id: order.id,
      order_number: order.order_number,
      invoice_url: order.invoice_url,
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
      items: items.filter((item) => item.order_id === order.id),
      status_history:
        typeof order.status_history === "string"
          ? JSON.parse(order.status_history)
          : order.status_history,
    }));

    return res.json({
      success: true,
      message: "Order retrieved successfully",
      data: formattedResponse,
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
    const status = req.query.status;
    const offset = (page - 1) * limit;

    const validStatuses = ["pending", "shipped", "delivered", "cancelled"];

    let countQuery = `
      SELECT COUNT(*) AS total
      FROM orders o 
      JOIN users u ON o.user_id = u.id where o.shop_id = ? AND (o.order_number LIKE ? OR u.full_name LIKE ?)
    `;
    if (validStatuses.includes(status)) {
      countQuery += ` AND o.order_status = '${status}'`;
    }

    // --- Count total for pagination
    const [countRows] = await connection.execute(countQuery, [
      shop_id[0].id,
      `%${search}%`,
      `%${search}%`,
    ]);
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limit);

    // --- Main paginated order query
    let orderQuery = `
      SELECT 
        o.id,
        o.order_number,
        o.order_status,
        o.invoice_url,
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

        u.full_name AS customer_name,
        u.email AS customer_email,
        u.phone AS customer_phone
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.shop_id = ? AND (o.order_number LIKE ? OR u.full_name LIKE ?)
    `;
    if (validStatuses.includes(status)) {
      orderQuery += ` AND o.order_status = '${status}'`;
    }
    orderQuery += ` ORDER BY o.order_date DESC LIMIT ? OFFSET ?`;

    const [orders] = await connection.query(orderQuery, [
      shop_id[0].id,
      `%${search}%`,
      `%${search}%`,
      limit,
      offset,
    ]);

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
      invoice_url: order.invoice_url,
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
      message: "Orders fetched successfully",
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
      .json({ success: false, error: "Failed to fetch orders" });
  } finally {
    if (connection) connection.release();
  }
};

export { placeOrder, getOrderByCustomerID, getOrderByShopID, updateStatus };
