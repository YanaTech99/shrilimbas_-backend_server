import pool from "../db/index.js";

const addToCart = async (req, res) => {
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  const { product_id, product_variant_id = null, quantity } = req.body;

  if (!product_id || !quantity || quantity < 1) {
    return res.status(400).json({ error: "Invalid input fields" });
  }

  const connection = await pool.getConnection();

  try {
    // 1. Check product exists and is active
    const [productRows] = await connection.execute(
      "SELECT id, shop_id, product_name, selling_price, stock_quantity, sku FROM products WHERE id = ? AND status = 'active'",
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
    const price_per_unit =
      product.selling_price + (variant?.selling_price || 0);
    const discount_per_unit = 0;
    const tax_per_unit = 0; // tax logic can go here

    const sku = variant?.sku || product.sku;

    const product_snapshot = JSON.stringify({
      name: product.product_name,
      base_price: product.selling_price,
      variant_price: variant?.selling_price || 0,
      final_price: price_per_unit,
      sku,
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
      const newQuantity = parseInt(existingItem.quantity) + parseInt(quantity);

      await connection.execute(
        `UPDATE cart_items
         SET quantity = ?, price_per_unit = ?, discount_per_unit = ?, tax_per_unit = ?, 
             sku = ?, product_snapshot = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          newQuantity,
          price_per_unit,
          discount_per_unit,
          tax_per_unit,
          sku,
          product_snapshot,
          existingItem.id,
        ]
      );

      return res.status(200).json({
        success: true,
        message: "Cart item updated successfully",
      });
    } else {
      // 5. Insert new item
      const [result] = await connection.execute(
        `INSERT INTO cart_items 
         (customer_id, product_id, product_variant_id, shop_id, quantity, 
          price_per_unit, discount_per_unit, tax_per_unit, sku, product_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer_id[0].id,
          product_id,
          product_variant_id,
          product.shop_id,
          parseInt(quantity),
          price_per_unit,
          discount_per_unit,
          tax_per_unit,
          sku,
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
          price_per_unit: price_per_unit,
          discount_per_unit: discount_per_unit,
          tax_per_unit: tax_per_unit,
          sku: sku,
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
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  const { id: cart_item_id } = req.body;

  const connection = await pool.getConnection();

  try {
    const [result] = await connection.execute(
      `DELETE FROM cart_items WHERE id = ? AND customer_id = ?`,
      [cart_item_id, customer_id[0].id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: "Cart item not found",
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
    connection.release();
  }
};

const getCart = async (req, res) => {
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  const connection = await pool.getConnection();

  try {
    const [result] = await connection.execute(
      `SELECT id, product_id, product_variant_id, shop_id, quantity, 
       price_per_unit, discount_per_unit, tax_per_unit, sku, product_snapshot
       FROM cart_items WHERE customer_id = ?`,
      [customer_id[0].id]
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Cart not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Cart retrieved successfully",
      data: result,
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
