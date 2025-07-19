import pools from "../db/index.js";

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
      shop_id,
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

      const availableStock = product.stock ?? product.stock_quantity;
      if (availableStock < item.quantity) {
        return res.status(400).json({
          success: false,
          error: `Not enough stock for product ${item.product_id}`,
        });
      }

      const price = parseFloat(product.price);
      const tax = parseFloat(product.tax || 0);
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

    const [orderResult] = await connection.execute(
      `INSERT INTO orders (
        order_number, customer_id, shop_id, delivery_address, delivery_city,
        delivery_state, delivery_country, delivery_postal_code, delivery_latitude, delivery_longitude,
        delivery_instructions, payment_method, payment_status, sub_total,
        discount_amount, tax_amount, shipping_fee, coupon_code, coupon_discount,
        notes, status_history
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY(JSON_OBJECT('status', 'pending', 'timestamp', NOW())))`,
      [
        order_number,
        customer_id[0].id,
        shop_id,
        delivery_address,
        delivery_city,
        delivery_state,
        delivery_country,
        delivery_postal_code,
        delivery_latitude,
        delivery_longitude,
        delivery_instructions,
        payment_method,
        subTotal,
        discountAmount,
        taxAmount,
        shippingFee,
        coupon_code || null,
        discountAmount,
        notes || null,
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
      //   if (item.product_variant_id) {
      //     await connection.execute(
      //       `UPDATE product_variants SET stock = stock - ? WHERE id = ?`,
      //       [item.quantity, item.product_variant_id]
      //     );
      //   } else {
      //     await connection.execute(
      //       `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
      //       [item.quantity, item.product_id]
      //     );
      //   }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order_id: orderId,
      order_number,
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

// const getOrderByShopID = async (req, res) => {};

export { placeOrder, getOrderByCustomerID };
