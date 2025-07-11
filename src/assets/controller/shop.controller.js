import pool from "../db/index.js";

const updateShop = async (req, res) => {
  const { id: userId } = req.user;
  const [shop] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [userId]
  );

  const shopId = shop[0]?.id;
  if (!shopId) {
    return res.status(404).json({ success: false, message: "Shop not found." });
  }

  const updateFields = req.body;

  if (!Object.keys(updateFields).length) {
    return res
      .status(400)
      .json({ success: false, message: "No data provided to update." });
  }

  const allowedFields = [
    "name",
    "description",
    "logo_url",
    "license_number",
    "status",
    "email",
    "contact_alternate_phone",
    "address_id",
    "is_verified",
    "is_featured",
    "categories",
    "working_hours",
    "is_open",
    "last_login_at",
  ];

  // Filter out only valid fields
  const fieldsToUpdate = Object.keys(updateFields).filter((field) =>
    allowedFields.includes(field)
  );
  if (fieldsToUpdate.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No valid fields to update." });
  }

  const setClause = fieldsToUpdate
    .map((field) => `\`${field}\` = ?`)
    .join(", ");
  const values = fieldsToUpdate.map((field) => {
    const value = updateFields[field];
    // stringify JSON fields
    if (
      ["categories", "working_hours"].includes(field) &&
      typeof value === "object"
    ) {
      return JSON.stringify(value);
    }
    return value;
  });

  const sql = `UPDATE shops SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;

  try {
    const [result] = await pool.execute(sql, [...values, shopId]);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shop not found." });
    }

    return res
      .status(200)
      .json({ success: true, message: "Shop updated successfully." });
  } catch (error) {
    console.error("Error updating shop:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Internal Server Error" });
  }
};

const addBrands = async (req, res) => {
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can add brands.",
    });
  }

  const { brands } = req.body;

  if (!Array.isArray(brands) || brands.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No brand data provided.",
    });
  }

  try {
    // Get shop for vendor
    const [shops] = await pool.execute(
      "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
      [user_id]
    );

    if (shops.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Active shop not found for this vendor.",
      });
    }

    const shop_id = shops[0].id;

    const allowedFields = [
      "shop_id",
      "title",
      "slug",
      "description",
      "image_url",
      "status",
      "sort_order",
      "meta_title",
      "meta_description",
    ];

    const values = [];
    const placeholders = [];

    for (const brand of brands) {
      const row = [];

      for (const field of allowedFields) {
        switch (field) {
          case "shop_id":
            row.push(shop_id);
            break;
          default:
            row.push(brand[field] ?? null);
        }
      }

      values.push(...row);
      placeholders.push(`(${allowedFields.map(() => "?").join(", ")})`);
    }

    const sql = `
      INSERT INTO brands (${allowedFields.join(", ")})
      VALUES ${placeholders.join(", ")}
    `;

    const [result] = await pool.execute(sql, values);

    const allBrands = await pool.execute(
      "SELECT * FROM brands WHERE shop_id = ?",
      [shop_id]
    );

    return res.status(201).json({
      success: true,
      message: `${result.affectedRows} brand(s) added successfully.`,
      data: allBrands[0],
    });
  } catch (error) {
    console.error("Error adding brands:", error.message);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
};

const addCategories = async (req, res) => {
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can add categories.",
    });
  }

  const { categories } = req.body;

  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No category data provided.",
    });
  }

  try {
    // Get shop for vendor
    const [shops] = await pool.execute(
      "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
      [user_id]
    );

    if (shops.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Active shop not found for this vendor.",
      });
    }

    const shop_id = shops[0].id;

    const allowedFields = [
      "shop_id",
      "title",
      "slug",
      "description",
      "image_url",
      "status",
      "sort_order",
      "meta_title",
      "meta_description",
      "parent_id",
    ];

    const values = [];
    const placeholders = [];

    for (const category of categories) {
      const row = [];

      for (const field of allowedFields) {
        switch (field) {
          case "shop_id":
            row.push(shop_id);
            break;
          default:
            row.push(category[field] ?? null);
        }
      }

      values.push(...row);
      placeholders.push(`(${allowedFields.map(() => "?").join(", ")})`);
    }

    const sql = `
      INSERT INTO categories (${allowedFields.join(", ")})
      VALUES ${placeholders.join(", ")}
    `;

    const [result] = await pool.execute(sql, values);

    const allCategories = await pool.execute(
      "SELECT * FROM categories WHERE shop_id = ?",
      [shop_id]
    );

    return res.status(201).json({
      success: true,
      message: `${result.affectedRows} category(s) added successfully.`,
      data: allCategories[0],
    });
  } catch (error) {
    console.error("Error adding categories:", error.message);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
};

const addProducts = async (req, res) => {
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can add products.",
    });
  }
  const [shops] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  if (shops.length === 0) {
    return res.status(404).json({
      success: false,
      message: "Active shop not found for this vendor.",
    });
  }
  const shop_id = shops[0].id;

  const product = req.body;
  const variants = product.variants || [];

  // Required product fields
  const requiredFields = [
    "product_name",
    "sku",
    "mrp",
    "selling_price",
    "brand_id",
    "shop_id",
  ];

  for (const field of requiredFields) {
    if (!product[field]) {
      return res.status(400).json({
        success: false,
        message: `Missing required field: ${field}`,
      });
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Insert product
    const productFields = [
      "product_name",
      "slug",
      "sku",
      "barcode",
      "thumbnail",
      "gallery_images",
      "short_description",
      "long_description",
      "specifications",
      "mrp",
      "selling_price",
      "cost_price",
      "tax_percentage",
      "hsn_code",
      "stock_quantity",
      "min_stock_alert",
      "stock_unit",
      "is_in_stock",
      "warehouse_location",
      "brand_id",
      "tags",
      "attributes",
      "is_featured",
      "is_new_arrival",
      "is_best_seller",
      "product_type",
      "status",
      "sort_order",
      "meta_title",
      "meta_description",
      "custom_fields",
      "shop_id",
    ];

    const insertValues = [];

    for (const field of productFields) {
      insertValues.push(
        [
          "gallery_images",
          "specifications",
          "tags",
          "attributes",
          "custom_fields",
        ].includes(field) && typeof product[field] === "object"
          ? JSON.stringify(product[field])
          : product[field] ?? null
      );
    }

    insertValues.push(shop_id);

    const productSql = `
      INSERT INTO products (${productFields.join(", ")})
      VALUES (${productFields.map(() => "?").join(", ")})
    `;

    const [productResult] = await connection.execute(productSql, insertValues);
    const productId = productResult.insertId;

    // Insert variants
    if (variants.length > 0) {
      const variantFields = [
        "product_id",
        "sku",
        "barcode",
        "color",
        "size",
        "material",
        "thumbnail",
        "gallery_images",
        "base_price",
        "selling_price",
        "cost_price",
        "stock",
        "stock_alert_at",
        "is_available",
        "is_visible",
        "is_deleted",
      ];

      const variantValues = [];
      const variantPlaceholders = [];

      for (const variant of variants) {
        if (!variant.sku || !variant.base_price) {
          throw new Error("Each variant must have `sku` and `base_price`");
        }

        const row = variantFields.map((field) => {
          if (field === "product_id") return productId;
          if (
            field === "gallery_images" &&
            typeof variant[field] === "object"
          ) {
            return JSON.stringify(variant[field]);
          }
          return variant[field] ?? null;
        });

        variantValues.push(...row);
        variantPlaceholders.push(
          `(${variantFields.map(() => "?").join(", ")})`
        );
      }

      const variantSql = `
        INSERT INTO product_variants (${variantFields.join(", ")})
        VALUES ${variantPlaceholders.join(", ")}
      `;

      await connection.execute(variantSql, variantValues);
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Product added successfully.",
      product_id: productId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error adding product:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to add product.",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

export { updateShop, addCategories, addBrands, addProducts };
