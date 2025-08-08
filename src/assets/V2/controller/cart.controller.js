import pools from "../../db/index.js";

const addToCart = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE user_id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const { product_id, product_variant_id, item_quantity } = req.body;
  let quantity = parseInt(item_quantity);
  if (
    !product_id ||
    quantity === undefined ||
    product_variant_id === undefined
  ) {
    return res.status(400).json({
      success: false,
      error: "Invalid input fields",
    });
  }

  const connection = await pool.getConnection();

  try {
    // 1. Check product exists and is active
    const [productRows] = await connection.execute(
      "SELECT id, shop_id, product_name, tax_percentage FROM products WHERE id = ? AND is_active = true",
      [product_id]
    );

    if (productRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Product not found or inactive",
      });
    }

    const product = productRows[0];

    // 2. If variant is provided, verify it
    let variant = null;
    if (product_variant_id) {
      const [variantRows] = await connection.execute(
        "SELECT id, sku, selling_price, stock FROM product_variants WHERE id = ? AND product_id = ?",
        [product_variant_id, product_id]
      );

      if (variantRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Invalid product variant",
        });
      }

      variant = variantRows[0];
      if (quantity > variant.stock) {
        return res.status(400).json({
          success: false,
          error: "Requested quantity exceeds stock for variant",
        });
      }
    } else {
      if (quantity > product.stock) {
        return res.status(400).json({
          success: false,
          error: "Requested quantity exceeds stock",
        });
      }
    }

    // 3. Compute pricing
    let subTotal = 0;
    const price = parseFloat(variant.selling_price);
    const tax = parseFloat(product.tax_percentage || 0);
    const discount = 0;

    const lineTotal = (price + tax) * quantity;
    subTotal += lineTotal;

    // Apply coupon logic (stub example)
    // let discountAmount = 0;
    // if (coupon_code) {
    //   // Apply logic to validate coupon and calculate discountAmount
    //   discountAmount = 50; // dummy value
    // }

    // const taxAmount = subTotal * 0.1; // 10% tax
    // const shippingFee = 0; // Flat fee (optional logic)
    // const totalAmount = subTotal - discountAmount + taxAmount + shippingFee;

    const product_snapshot = JSON.stringify({
      name: product.product_name,
      base_price: variant.selling_price,
      tax_per_unit: tax,
      discount: discount,
      quantity: quantity,
      final_price: subTotal,
    });

    // 4. Check if item already exists in cart
    const [existing] = await connection.execute(
      `SELECT id, quantity FROM cart_items 
       WHERE customer_id = ? AND product_id = ? AND 
             (product_variant_id = ? OR (product_variant_id IS NULL AND ? IS NULL))`,
      [customer_id[0].id, product_id, product_variant_id, product_variant_id]
    );

    if (existing.length > 0) {
      const existingItem = existing[0];

      if (quantity === 0) {
        const [deleted] = await connection.execute(
          `DELETE FROM cart_items WHERE id = ?`,
          [existingItem.id]
        );

        if (deleted.affectedRows > 0) {
          return res.status(200).json({
            success: true,
            message: "Cart item deleted successfully",
          });
        } else {
          return res.status(500).json({
            success: false,
            error: "Failed to delete cart item",
          });
        }
      }

      const [updated] = await connection.execute(
        `UPDATE cart_items
         SET quantity = ?, price_per_unit = ?, discount_per_unit = ?, tax_per_unit = ?, 
             product_snapshot = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          parseInt(quantity),
          price,
          discount || 0,
          tax,
          product_snapshot,
          existingItem.id,
        ]
      );

      if (updated.affectedRows === 0) {
        return res.status(500).json({
          success: false,
          error: "Failed to update cart item",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Cart item updated successfully",
      });
    } else {
      // 5. Insert new item

      if (quantity === 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid quantity",
        });
      }

      const [result] = await connection.execute(
        `INSERT INTO cart_items 
         (customer_id, product_id, product_variant_id, shop_id, quantity, 
          price_per_unit, discount_per_unit, tax_per_unit, product_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer_id[0].id,
          product_id,
          product_variant_id,
          product.shop_id,
          parseInt(quantity),
          price,
          discount || 0,
          tax,
          product_snapshot,
        ]
      );

      return res.status(201).json({
        success: true,
        message: "Item added to cart",
        data: {
          id: result.insertId,
          product_id: product_id,
          product_variant_id: product_variant_id,
          shop_id: product.shop_id,
          quantity: quantity,
          price_per_unit: price,
          discount_per_unit: discount || 0,
          tax_per_unit: tax,
          product_snapshot: product_snapshot,
        },
      });
    }
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

const deleteFromCart = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const { id: cart_item_id } = req.body;

  const client = await pool.getConnection();

  try {
    const [cartItem] = await client.execute(
      `SELECT * FROM cart_items WHERE id = ? AND customer_id = ?`,
      [cart_item_id, customer_id[0].id]
    );

    if (!cartItem || cartItem.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Cart item not found",
      });
    }

    const [result] = await client.execute(
      `DELETE FROM cart_items WHERE id = ? AND customer_id = ?`,
      [cart_item_id, customer_id[0].id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: "Failed to delete cart item",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Cart item deleted successfully",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
};

const getCart = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE user_id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const connection = await pool.getConnection();

  try {
    const [result] = await connection.execute(
      `SELECT * FROM cart_items WHERE customer_id = ?`,
      [customer_id[0].id]
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Cart not found",
      });
    }

    // Map cart items to products
    const cartItems = await Promise.all(
      result.map(async (item) => {
        const [productRows] = await connection.execute(
          `SELECT * FROM products WHERE id = ?`,
          [item.product_id]
        );

        const [variantRows] = await connection.execute(
          `SELECT * FROM product_variants WHERE id = ?`,
          [item.product_variant_id]
        );

        const product = productRows[0];
        const variant = variantRows[0];

        return {
          id: product.id,
          product_name: product.product_name,
          thumbnail: variant.thumbnail,
          short_description: product.short_description,
          quantity: item.quantity,
          price_per_unit: item.price_per_unit,
          discount_per_unit: item.discount_per_unit,
          tax_per_unit: product.tax_percentage,
          product_snapshot: item.product_snapshot,
          finalAmmount: item.total_price,
        };
      })
    );

    return res.status(200).json({
      success: true,
      message: "Cart retrieved successfully",
      data: cartItems,
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

export { addToCart, deleteFromCart, getCart };
