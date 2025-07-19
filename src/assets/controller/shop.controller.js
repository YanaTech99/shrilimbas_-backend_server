import pools from "../db/index.js";
import fs from "fs";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinary.util.js";

import { sanitizeInput } from "../utils/validation.util.js";

const updateShop = async (req, res) => {
  const pool = pools[req.tenantId];
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

const updateAddress = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [shop_id] = await pool.query(`SELECT id FROM shops WHERE user_id = ?`, [
    user_id,
  ]);

  if (!shop_id || shop_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Shop not found",
    });
  }

  const modifiedInput = sanitizeInput(req.body);

  const { address_id } = modifiedInput;
  const {
    address_line1,
    address_line2,
    landmark,
    city,
    state,
    postal_code,
    country,
    address_type,
  } = modifiedInput.address;

  const client = await pool.getConnection();

  try {
    client.beginTransaction();

    const updateQuery = [];

    if (address_line1) updateQuery.push(`address_line1 = '${address_line1}'`);
    if (address_line2) updateQuery.push(`address_line2 = '${address_line2}'`);
    if (landmark) updateQuery.push(`landmark = '${landmark}'`);
    if (city) updateQuery.push(`city = '${city}'`);
    if (state) updateQuery.push(`state = '${state}'`);
    if (postal_code) updateQuery.push(`postal_code = '${postal_code}'`);
    if (country) updateQuery.push(`country = '${country}'`);
    if (address_type) updateQuery.push(`address_type = '${address_type}'`);

    const [result] = await client.query(
      `UPDATE addresses SET ${updateQuery.join(
        ", "
      )} WHERE id = ? AND shop_id = ?`,
      [address_id, shop_id[0].id]
    );

    if (result.affectedRows === 0) {
      await client.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to update address.",
      });
    }

    await client.commit();
    return res.status(200).json({
      success: true,
      message: "Address updated successfully.",
    });
  } catch (error) {
    await client.rollback();
    return res.status(500).json({
      success: false,
      error: "Failed to update address. Inernal server error.",
    });
  } finally {
    client.release();
  }
};

const addBrand = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can add brands.",
    });
  }

  const brand = req.body;
  const image = req.file || null;

  try {
    // Get vendor's active shop
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

    const {
      title,
      slug,
      description,
      status = 1,
      sort_order = 0,
      meta_title,
      meta_description,
    } = brand;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Brand title is required.",
      });
    }

    let image_url = null;

    const [result] = await pool.execute(
      `INSERT INTO brands 
       (title, slug, description, status, sort_order, meta_title, meta_description, shop_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        slug,
        description || null,
        status,
        sort_order,
        meta_title || null,
        meta_description || null,
        shop_id,
      ]
    );

    // Upload image to Cloudinary
    if (image) {
      const uploadResult = await uploadImageToCloudinary(image.path);
      if (uploadResult?.secure_url) {
        image_url = uploadResult.secure_url;
      }

      await pool.execute("UPDATE brands SET image_url = ? WHERE id = ?", [
        image_url,
        result.insertId,
      ]);
    }

    const [newBrand] = await pool.execute("SELECT * FROM brands WHERE id = ?", [
      result.insertId,
    ]);

    return res.status(201).json({
      success: true,
      message: "Brand added successfully.",
      data: newBrand[0],
    });
  } catch (error) {
    console.error("Error adding brand:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to add brand.",
      error: error.message,
    });
  } finally {
    if (image && image.path && fs.existsSync(image.path)) {
      fs.unlinkSync(image.path);
    }
  }
};

const getPaginatedBrands = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;

  const shop_id = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  try {
    const {
      page = 1,
      limit = 10,
      status,
      title,
      search,
      sort_by = "sort_order",
      order = "ASC",
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClauses = [];
    const values = [];

    // Filters
    if (status) {
      whereClauses.push("status = ?");
      values.push(status);
    }

    if (title) {
      whereClauses.push("title LIKE ?");
      values.push(`%${title}%`);
    }

    if (search) {
      whereClauses.push(`(
        title LIKE ? OR
        slug LIKE ? OR
        description LIKE ?
      )`);
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (shop_id.length > 0) {
      whereClauses.push("shop_id = ?");
      values.push(shop_id[0].id);
    }

    const whereSQL = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    // Total count for pagination
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) AS total FROM brands ${whereSQL}`,
      values
    );
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(limit));
    // Fetch paginated brands
    const [brands] = await pool.execute(
      `SELECT * FROM brands ${whereSQL} ORDER BY ${sort_by} ${order} LIMIT ? OFFSET ?`,
      [...values, parseInt(limit), offset]
    );

    return res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      per_page: parseInt(limit),
      total_pages: totalPages,
      data: brands,
    });
  } catch (error) {
    console.error("Error fetching brands:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch brands.",
      error: error.message,
    });
  }
};

const addCategory = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendor can add categories.",
    });
  }

  const category = req.body;

  const [shop_id] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  const image = req.file ? req.file : null;

  try {
    const {
      title,
      description,
      slug,
      status = "active",
      sort_order = 0,
      meta_title,
      meta_description,
      parent_id,
    } = category;

    let validParentId = parent_id === "null" ? null : parent_id;
    const [result] = await pool.execute(
      `INSERT INTO categories 
       (title, slug, description, status, sort_order, meta_title, meta_description, parent_id, shop_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        slug,
        description || null,
        status,
        sort_order,
        meta_title || null,
        meta_description || null,
        validParentId || null,
        shop_id[0].id,
      ]
    );

    if (image && image !== null) {
      const uploadResult = await uploadImageToCloudinary(image.path);
      if (uploadResult) {
        await pool.execute("UPDATE categories SET image_url = ? WHERE id = ?", [
          uploadResult.secure_url,
          result.insertId,
        ]);
      }
    }

    const [newCategory] = await pool.execute(
      "SELECT * FROM categories WHERE id = ?",
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: "Category added successfully.",
      data: newCategory[0],
    });
  } catch (error) {
    console.error("Error adding category:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to add category.",
      error: error.message,
    });
  } finally {
    if (image && image !== null) {
      fs.unlinkSync(image.path);
    }
  }
};

const getPaginatedCategories = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [shop_id] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  try {
    const {
      page = 1,
      limit,
      status,
      title,
      parent_id,
      search,
      sort_by = "sort_order",
      order = "ASC",
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClauses = [];
    const values = [];

    // Filters
    if (status) {
      whereClauses.push("status = ?");
      values.push(status);
    }

    if (title) {
      whereClauses.push("title LIKE ?");
      values.push(`%${title}%`);
    }

    if (parent_id) {
      whereClauses.push("parent_id = ?");
      values.push(parent_id);
    }

    if (search) {
      whereClauses.push(`(
        title LIKE ? OR
        slug LIKE ? OR
        description LIKE ?
      )`);
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (shop_id.length > 0) {
      whereClauses.push("shop_id = ?");
      values.push(shop_id[0].id);
    }

    const whereSQL = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    // Total count for pagination
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) AS total FROM categories ${whereSQL}`,
      values
    );
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(limit));

    // Fetch paginated categories
    const [categories] = await pool.execute(
      `SELECT * FROM categories ${whereSQL} ORDER BY ${sort_by} ${order} ${
        limit ? `LIMIT ${limit} OFFSET ${parseInt(offset)}` : ""
      }`,
      [...values]
    );

    return res.status(200).json({
      success: true,
      message: "Categories fetched successfully.",
      pagination: {
        total,
        page: parseInt(page),
        per_page: parseInt(limit),
        total_pages: totalPages,
      },
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch categories.",
      error: error.message,
    });
  }
};

const addProducts = async (req, res) => {
  const pool = pools[req.tenantId];
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
  const product =
    typeof req.body.product === "string"
      ? JSON.parse(req.body.product)
      : req.body;
  const variants = product.variants || [];
  const productFiles = req.files || {};

  console.log(product);

  const requiredFields = ["product_name", "sku", "mrp", "selling_price"];
  for (const field of requiredFields) {
    if (!product[field]) {
      return res.status(400).json({
        success: false,
        message: `Missing required field: ${field}`,
      });
    }
  }

  // Ensure thumbnail image is present
  if (!productFiles.thumbnail || productFiles.thumbnail.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Thumbnail image is required for the product.",
    });
  }

  const connection = await pool.getConnection();
  const cloudinaryUploads = [];
  const localFiles = [];

  try {
    await connection.beginTransaction();

    // Upload product thumbnail
    const thumbFile = productFiles.thumbnail[0];
    const thumbnailUpload = await uploadImageToCloudinary(thumbFile.path);
    cloudinaryUploads.push(thumbnailUpload.public_id);
    localFiles.push(thumbFile.path);

    const galleryImages = [];
    if (
      productFiles.gallery_images &&
      Array.isArray(productFiles.gallery_images)
    ) {
      for (const img of productFiles.gallery_images) {
        const uploaded = await uploadImageToCloudinary(img.path);
        cloudinaryUploads.push(uploaded.public_id);
        localFiles.push(img.path);
        galleryImages.push(uploaded.secure_url);
      }
    }

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
      let value = null;
      if (field === "thumbnail") {
        value = thumbnailUpload.secure_url;
      } else if (field === "gallery_images") {
        value = JSON.stringify(galleryImages);
      } else if (
        ["tags", "attributes", "specifications", "custom_fields"].includes(
          field
        )
      ) {
        value =
          typeof product[field] === "object"
            ? JSON.stringify(product[field])
            : null;
      } else if (field === "shop_id") {
        value = shop_id;
      } else {
        value = product[field] ?? null;
      }
      insertValues.push(value);
    }

    const productSql = `
      INSERT INTO products (${productFields.join(", ")})
      VALUES (${productFields.map(() => "?").join(", ")})
    `;

    const [productResult] = await connection.execute(productSql, insertValues);
    const productId = productResult.insertId;

    // Insert product categories
    const categoryIds = product.category_ids || [];

    if (categoryIds.length > 0) {
      const categoryValues = [];
      const placeholders = [];

      for (const categoryId of categoryIds) {
        categoryValues.push(productId, categoryId, 0);
        placeholders.push("(?, ?, ?)");
      }

      const categorySql = `
        INSERT INTO product_categories (product_id, category_id, sort_order)
        VALUES ${placeholders.join(", ")}
      `;
      await connection.execute(categorySql, categoryValues);
    }

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

      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];

        if (!variant.sku || !variant.base_price) {
          throw new Error("Each variant must have `sku` and `base_price`");
        }

        const thumbnailFile = productFiles[`variant_thumbnail_${i}`]?.[0];
        if (!thumbnailFile) {
          throw new Error(`Thumbnail is required for variant index ${i}`);
        }

        const thumbnailUpload = await uploadImageToCloudinary(
          thumbnailFile.path
        );
        cloudinaryUploads.push(thumbnailUpload.public_id);
        localFiles.push(thumbnailFile.path);

        const variantGalleryUrls = [];
        const galleryFiles = productFiles[`variant_gallery_images_${i}`] || [];

        for (const g of galleryFiles) {
          const uploaded = await uploadImageToCloudinary(g.path);
          cloudinaryUploads.push(uploaded.public_id);
          localFiles.push(g.path);
          variantGalleryUrls.push(uploaded.secure_url);
        }

        const row = variantFields.map((field) => {
          if (field === "product_id") return productId;
          if (field === "thumbnail") return thumbnailUpload.secure_url;
          if (field === "gallery_images")
            return JSON.stringify(variantGalleryUrls);
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

    // Delete uploaded cloudinary images
    for (const publicId of cloudinaryUploads) {
      try {
        await deleteFromCloudinary(publicId);
      } catch (cloudErr) {
        console.error(`Failed to delete cloudinary image: ${publicId}`);
      }
    }

    console.error("Error adding product:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add product.",
      error: error.message,
    });
  } finally {
    // Remove local files
    for (const filePath of localFiles) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    connection.release();
  }
};

const updateProduct = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;
  const [shop_id] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ?",
    [user_id]
  );

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can update their products.",
    });
  }

  if (!shop_id || !shop_id[0]) {
    return res.status(404).json({
      success: false,
      message: "Shop not found for this vendor.",
    });
  }

  const modifiedInput = sanitizeInput(req.body);

  const {
    id: product_id,
    product_name,
    barcode,
    short_description,
    long_description,
    specifications,
    mrp,
    selling_price,
    cost_price,
    tax_percentage,
    stock_quantity,
    min_stock_alert,
    stock_unit,
    is_in_stock,
    warehouse_location,
    tags,
    attributes,
    is_featured,
    is_new_arrival,
    is_best_seller,
    product_type,
    status,
    meta_title,
    meta_description,
    custom_fields,
  } = modifiedInput;

  const productImage = req.file;
  let uploadedImage = null;

  const [product] = await pool.execute(
    `SELECT * FROM products WHERE id = ? AND shop_id = ?`,
    [product_id, shop_id[0].id]
  );

  if (!product || !product[0]) {
    return res.status(404).json({
      success: false,
      message: "Product not found.",
    });
  }

  const client = await pool.getConnection();

  try {
    await client.beginTransaction();

    const updateQuery = [];
    const values = [];

    if (product_name) updateQuery.push(`product_name = ?`);
    if (barcode) updateQuery.push(`barcode = ?`);
    if (short_description) updateQuery.push(`short_description = ?`);
    if (long_description) updateQuery.push(`long_description = ?`);
    if (specifications) updateQuery.push(`specifications = ?`);
    if (mrp) updateQuery.push(`mrp = ?`);
    if (selling_price) updateQuery.push(`selling_price = ?`);
    if (cost_price) updateQuery.push(`cost_price = ?`);
    if (tax_percentage) updateQuery.push(`tax_percentage = ?`);
    if (stock_quantity) updateQuery.push(`stock_quantity = ?`);
    if (min_stock_alert) updateQuery.push(`min_stock_alert = ?`);
    if (stock_unit) updateQuery.push(`stock_unit = ?`);
    if (is_in_stock) updateQuery.push(`is_in_stock = ?`);
    if (warehouse_location) updateQuery.push(`warehouse_location = ?`);
    if (tags) updateQuery.push(`tags = ?`);
    if (attributes) updateQuery.push(`attributes = ?`);
    if (is_featured) updateQuery.push(`is_featured = ?`);
    if (is_new_arrival) updateQuery.push(`is_new_arrival = ?`);
    if (is_best_seller) updateQuery.push(`is_best_seller = ?`);
    if (product_type) updateQuery.push(`product_type = ?`);
    if (status) updateQuery.push(`status = ?`);
    if (meta_title) updateQuery.push(`meta_title = ?`);
    if (meta_description) updateQuery.push(`meta_description = ?`);
    if (custom_fields) updateQuery.push(`custom_fields = ?`);

    updateQuery.push(`updated_at = NOW()`);

    updateQuery.forEach((_, index) =>
      values.push(modifiedInput[updateQuery[index]])
    );

    const [result] = await pool.execute(
      `UPDATE products SET ${updateQuery.join(
        ", "
      )} WHERE id = ? AND shop_id = ?`,
      [...values, product_id, shop_id[0].id]
    );

    if (result.affectedRows === 0) {
      await client.rollback();
      return res.status(404).json({
        success: false,
        message: "Failed to update product.",
      });
    }

    if (productImage || productImage.path) {
      uploadedImage = await uploadImageToCloudinary(productImage.path);

      if (uploadedImage) {
        const [result] = await pool.execute(
          `UPDATE products SET thumbnail = ? WHERE id = ? AND shop_id = ?`,
          [uploadedImage.secure_url, product_id, shop_id[0].id]
        );

        if (result.affectedRows === 0) {
          await client.rollback();
          return res.status(404).json({
            success: false,
            message: "Failed to update product image.",
          });
        }
      }
    }

    await client.commit();
    return res.status(200).json({
      success: true,
      message: "Product updated successfully.",
    });
  } catch (error) {
    await client.rollback();
    await deleteFromCloudinary(uploadedImage?.public_id);
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to update product.",
    });
  } finally {
    fs.unlinkSync(productImage.path);
    client.release();
  }
};

const getPaginatedproducts = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can access their products.",
    });
  }

  const {
    page = 1,
    limit = 10,
    status,
    brand_id,
    category_id,
    search,
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const filters = [];
  const values = [];

  try {
    // Step 1: Get vendor's shop ID
    const [shopRows] = await pool.execute(
      "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
      [user_id]
    );

    if (shopRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No active shop found." });
    }

    const shopId = shopRows[0].id;

    filters.push("p.shop_id = ?");
    values.push(shopId);
    filters.push("p.deleted_at IS NULL");

    // Optional filters
    if (status) {
      filters.push("p.status = ?");
      values.push(status);
    }

    if (brand_id) {
      filters.push("p.brand_id = ?");
      values.push(brand_id);
    }

    if (search) {
      filters.push("(p.product_name LIKE ? OR p.sku LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }

    const whereSQL = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Step 2: Count total
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) AS total FROM products p ${whereSQL}`,
      values
    );

    const total = countResult[0].total;

    // Step 3: Fetch paginated products
    const [productRows] = await pool.execute(
      `SELECT * FROM products p ${whereSQL} ORDER BY p.created_at DESC LIMIT ${parseInt(
        limit
      )} OFFSET ${offset}`,
      [...values]
    );

    if (productRows.length === 0) {
      return res.json({
        success: true,
        message: "No products found.",
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        data: [],
      });
    }

    const productIds = productRows.map((p) => p.id);

    // Step 4: Category filter (after product fetch)
    if (category_id) {
      const [filtered] = await pool.execute(
        `SELECT DISTINCT product_id FROM product_categories WHERE category_id = ?`,
        [category_id]
      );
      const validIds = new Set(filtered.map((r) => r.product_id));
      productRows = productRows.filter((p) => validIds.has(p.id));
    }

    // Step 5: Get categories for each product
    const [categoryMapRows] = await pool.execute(
      `SELECT pc.product_id, c.title
       FROM product_categories pc
       JOIN categories c ON pc.category_id = c.id
       WHERE pc.product_id IN (${productIds.map(() => "?").join(",")})`,
      productIds
    );

    const categoryMap = {};
    for (const row of categoryMapRows) {
      if (!categoryMap[row.product_id]) categoryMap[row.product_id] = [];
      categoryMap[row.product_id].push(row.title);
    }

    // Step 6: Get product variants
    const [variantRows] = await pool.execute(
      `SELECT
         product_id, sku, color, size, material, selling_price
       FROM product_variants
       WHERE product_id IN (${productIds
         .map(() => "?")
         .join(",")}) AND is_deleted = FALSE`,
      productIds
    );

    const variantMap = {};
    for (const v of variantRows) {
      if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
      variantMap[v.product_id].push(v);
    }

    // Step 7: Build final response
    // const data = productRows.map((product) => ({
    //   id: product.id,
    //   product_name: product.product_name,
    //   slug: product.slug,
    //   sku: product.sku,
    //   thumbnail: product.thumbnail,
    //   selling_price: product.selling_price,
    //   mrp: product.mrp,
    //   brand: product.brand,
    //   categories: categoryMap[product.id] || [],
    //   variants: variantMap[product.id] || [],
    // }));

    return res.status(200).json({
      success: true,
      message: "Products fetched successfully.",
      data: productRows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching products:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products.",
      error: error.message,
    });
  }
};

export {
  updateShop,
  updateAddress,
  addCategory,
  addBrand,
  addProducts,
  updateProduct,
  getPaginatedCategories,
  getPaginatedBrands,
  getPaginatedproducts,
};
