import pools from "../../db/index.js";
import fs from "fs";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../../utils/cloudinary.util.js";

import { sanitizeInput } from "../../utils/validation.util.js";
import { defaultImageUrl } from "../../../constants.js";

// Helper to extract Cloudinary public_id from image URL
function getPublicIdFromUrl(url) {
  const parts = url.split("/");
  const file =
    parts[parts.length - 2] + "/" + parts[parts.length - 1].split(".")[0];
  return file;
}

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

const addProducts = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
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
  const formattedData =
    typeof req.body.product === "string"
      ? JSON.parse(req.body.product)
      : req.body;

  const product = sanitizeInput(formattedData);
  console.log(product);
  const variants =
    typeof product.variants === "string"
      ? JSON.parse(product.variants)
      : product.variants;

  // Group multer.any() files by fieldname
  const productFilesArray = req.files || [];
  const productFiles = {};
  for (const file of productFilesArray) {
    if (!productFiles[file.fieldname]) {
      productFiles[file.fieldname] = [];
    }
    productFiles[file.fieldname].push(file);
  }

  const requiredFields = ["product_name", "sku"];
  for (const field of requiredFields) {
    if (!product[field]) {
      return res.status(400).json({
        success: false,
        message: `Missing required field: ${field}`,
      });
    }
  }

  const [sortOrder] = await pool.execute(
    "SELECT IFNULL(MAX(sort_order), 0) + 1 AS sort_order FROM products WHERE shop_id = ?",
    [shop_id]
  );
  product.sort_order = sortOrder[0].sort_order;

  const connection = await pool.getConnection();
  const cloudinaryUploads = [];

  try {
    await connection.beginTransaction();

    // ✅ Sum up stock quantity from variants
    if (variants.length > 0) {
      product.stock_quantity = variants.reduce((sum, v) => {
        return sum + (parseInt(v.stock) || 0);
      }, 0);
      product.is_in_stock = product.stock_quantity > 0;
    }

    // ✅ Create product

    const insertQuery = [];
    const insertValues = [];

    for (const field in product) {
      let value = null;

      if (field === "variants") {
        continue;
      } else if (field === "category_ids") {
        continue;
      } else if (
        ["tags", "attributes", "specifications", "custom_fields"].includes(
          field
        )
      ) {
        value =
          typeof product[field] === "object"
            ? JSON.stringify(product[field])
            : {};
      } else {
        value = product[field];
      }
      insertQuery.push(field);
      insertValues.push(value);
    }
    insertQuery.push("shop_id");
    insertValues.push(shop_id);

    const productSql = `INSERT INTO products (${insertQuery.join(
      ", "
    )}) VALUES (${insertQuery.map(() => "?").join(", ")})`;

    const [productResult] = await connection.execute(productSql, insertValues);
    const productId = productResult.insertId;

    // Insert product categories
    let categoryIds = [];
    if (Array.isArray(product.category_ids)) {
      categoryIds = product.category_ids.map(Number);
    } else if (typeof product.category_ids === "string") {
      categoryIds = product.category_ids
        .split(",")
        .map((id) => parseInt(id.trim()));
    }

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
      const [categoryResult] = await connection.execute(
        categorySql,
        categoryValues
      );

      if (categoryResult.affectedRows === 0) {
        await connection.rollback();

        // Delete uploaded images
        for (const publicId of cloudinaryUploads) {
          try {
            await deleteFromCloudinary(publicId);
          } catch (cloudErr) {
            console.error(`Failed to delete cloudinary image: ${publicId}`);
          }
        }

        return res.status(500).json({
          success: false,
          message: "Failed to insert product categories.",
        });
      }
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

        if (!variant.sku || !variant.base_price || !variant.selling_price) {
          throw new Error(
            `Missing required fields: sku, base_price, selling_price for variant ${
              i + 1
            }`
          );
        }

        if (productFiles["variant_thumbnail_1"]?.length === 0) {
          throw new Error(`Atleast one thumbnail is required`);
        }

        const thumbnailFile = productFiles[`variant_thumbnail_${i + 1}`]?.[0];
        let thumbnailUpload = null;
        if (thumbnailFile && thumbnailFile.path) {
          thumbnailUpload = await uploadImageToCloudinary(
            thumbnailFile.path,
            tenantId
          );
          cloudinaryUploads.push(thumbnailUpload.public_id);
        }

        const variantGalleryUrls = [];
        const galleryFiles =
          productFiles[`variant_gallery_images_${i + 1}`] || [];

        for (const g of galleryFiles) {
          const uploaded = await uploadImageToCloudinary(g.path, tenantId);
          cloudinaryUploads.push(uploaded.public_id);
          variantGalleryUrls.push(uploaded.secure_url);
        }

        const row = variantFields.map((field) => {
          if (field === "product_id") return productId;
          if (field === "thumbnail")
            return thumbnailUpload !== null
              ? thumbnailUpload.secure_url
              : defaultImageUrl;
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
      const [variantResult] = await connection.execute(
        variantSql,
        variantValues
      );
      if (variantResult.affectedRows === 0) {
        await connection.rollback();

        // Delete uploaded images
        for (const publicId of cloudinaryUploads) {
          try {
            await deleteFromCloudinary(publicId);
          } catch (cloudErr) {
            console.error(`Failed to delete cloudinary image: ${publicId}`);
          }
        }

        return res.status(500).json({
          success: false,
          message: "Failed to insert product variants.",
        });
      }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Product added successfully.",
      product_id: productId,
    });
  } catch (error) {
    await connection.rollback();

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
    for (const file of productFilesArray) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
    connection.release();
  }
};

const updateProduct = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can update their products.",
    });
  }

  const [shopRows] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  if (!shopRows.length) {
    return res.status(404).json({
      success: false,
      message: "Active shop not found for this vendor.",
    });
  }

  const shop_id = shopRows[0].id;
  const formattedData =
    typeof req.body.product === "string"
      ? JSON.parse(req.body.product)
      : req.body;

  const product = sanitizeInput(formattedData);
  const product_id = product.product_id;

  if (!product_id) {
    return res
      .status(400)
      .json({ success: false, message: "Product ID is required." });
  }

  const [existingProductRows] = await pool.execute(
    "SELECT * FROM products WHERE id = ? AND shop_id = ?",
    [product_id, shop_id]
  );

  if (!existingProductRows.length) {
    return res.status(404).json({
      success: false,
      message: "Product not found.",
    });
  }

  const existingProduct = existingProductRows[0];
  const connection = await pool.getConnection();
  const productFilesArray = req.files || [];
  const productFiles = {};

  for (const file of productFilesArray) {
    if (!productFiles[file.fieldname]) {
      productFiles[file.fieldname] = [];
    }
    productFiles[file.fieldname].push(file);
  }

  const cloudinaryUploads = [];

  try {
    await connection.beginTransaction();

    const updateFields = [];
    const updateValues = [];

    // Helper function to update fields if present
    const updateIfPresent = (field, transform = (v) => v) => {
      if (field in product) {
        updateFields.push(`${field} = ?`);
        updateValues.push(transform(product[field]));
      }
    };

    const jsonFields = [
      "tags",
      "attributes",
      "specifications",
      "custom_fields",
    ];
    for (const field of jsonFields) {
      updateIfPresent(field, (v) =>
        typeof v === "object" ? JSON.stringify(v) : v
      );
    }

    const directFields = [
      "product_name",
      "slug",
      "sku",
      "barcode",
      "short_description",
      "long_description",
      "tax_percentage",
      "hsn_code",
      "min_stock_alert",
      "stock_unit",
      "is_in_stock",
      "warehouse_location",
      "brand_id",
      "is_featured",
      "is_new_arrival",
      "is_best_seller",
      "product_type",
      "status",
      "meta_title",
      "meta_description",
    ];

    for (const field of directFields) updateIfPresent(field);

    // 🔁 Update other fields
    if (updateFields.length) {
      updateFields.push("updated_at = NOW()");
      await connection.execute(
        `UPDATE products SET ${updateFields.join(
          ", "
        )} WHERE id = ? AND shop_id = ?`,
        [...updateValues, product_id, shop_id]
      );
    }

    // 🔁 Update categories if provided
    if (product.category_ids) {
      let categoryIds = [];
      if (Array.isArray(product.category_ids)) {
        categoryIds = product.category_ids.map(Number);
      } else if (typeof product.category_ids === "string") {
        categoryIds = product.category_ids
          .split(",")
          .map((id) => parseInt(id.trim()));
      }

      if (categoryIds.length > 0) {
        // First, delete existing categories
        await connection.execute(
          "DELETE FROM product_categories WHERE product_id = ?",
          [product_id]
        );

        const categoryValues = [];
        const placeholders = [];

        for (const categoryId of categoryIds) {
          categoryValues.push(product_id, categoryId, 0);
          placeholders.push("(?, ?, ?)");
        }

        await connection.execute(
          `INSERT INTO product_categories (product_id, category_id, sort_order) VALUES ${placeholders.join(
            ", "
          )}`,
          categoryValues
        );
      }
    }

    // 🔁 Update variants if provided
    if (product.variants && Array.isArray(product.variants)) {
      for (let i = 0; i < product.variants.length; i++) {
        const variant = product.variants[i];
        if (!variant.id) continue;

        const [existingVariantRows] = await connection.execute(
          "SELECT * FROM product_variants WHERE id = ? AND product_id = ?",
          [variant.id, product_id]
        );

        if (!existingVariantRows.length) continue;

        const existingVariant = existingVariantRows[0];
        const fields = [];
        const values = [];

        const variantFields = [
          "sku",
          "barcode",
          "color",
          "size",
          "material",
          "base_price",
          "selling_price",
          "cost_price",
          "stock",
          "stock_alert_at",
          "is_available",
          "is_visible",
          "is_deleted",
        ];

        for (const field of variantFields) {
          if (field in variant) {
            fields.push(`${field} = ?`);
            values.push(variant[field]);
          }
        }

        const thumbFile = productFiles[`variant_thumbnail_${i + 1}`]?.[0];
        if (thumbFile) {
          const uploaded = await uploadImageToCloudinary(
            thumbFile.path,
            tenantId
          );
          if (!uploaded?.secure_url) {
            throw new Error(
              `Failed to upload variant ${variant.id} thumbnail.`
            );
          }

          if (existingVariant.thumbnail) {
            const public_id = getPublicIdFromUrl(existingVariant.thumbnail);
            const result = await deleteFromCloudinary(public_id);
            if (
              !result?.result ||
              (result.result !== "ok" && result.result !== "not found")
            ) {
              throw new Error(
                `Failed to delete old variant ${variant.id} thumbnail.`
              );
            }
          }
          cloudinaryUploads.push(uploaded.public_id);
          fields.push("thumbnail = ?");
          values.push(uploaded.secure_url);
        }

        const galleryFiles =
          productFiles[`variant_gallery_images_${i + 1}`] || [];
        if (galleryFiles.length > 0) {
          const urls = [];

          for (const file of galleryFiles) {
            const uploaded = await uploadImageToCloudinary(file.path, tenantId);
            if (!uploaded?.secure_url) {
              throw new Error(
                `Failed to upload variant ${variant.id} gallery image.`
              );
            }

            cloudinaryUploads.push(uploaded.public_id);
            urls.push(uploaded.secure_url);
          }

          fields.push("gallery_images = ?");
          values.push(JSON.stringify(urls));

          if (existingVariant.gallery_images) {
            const images =
              typeof existingVariant.gallery_images === "string"
                ? JSON.parse(existingVariant.gallery_images)
                : existingVariant.gallery_images;

            const public_ids = images.map((image) => getPublicIdFromUrl(image));
            for (const public_id of public_ids) {
              const result = await deleteFromCloudinary(public_id);
              if (
                !result?.result ||
                (result.result !== "ok" && result.result !== "not found")
              ) {
                throw new Error(
                  `Failed to delete old variant ${variant.id} gallery image.`
                );
              }
            }
          }
        }

        // 🧮 Stock Recalculation
        if (typeof variant.stock === "number") {
          const [productStock] = await connection.execute(
            "SELECT stock_quantity FROM products WHERE id = ?",
            [product_id]
          );
          const currentStock = productStock[0].stock_quantity;
          const newStock = currentStock - existingVariant.stock + variant.stock;

          await connection.execute(
            "UPDATE products SET stock_quantity = ? WHERE id = ?",
            [newStock, product_id]
          );
        }

        if (fields.length > 0) {
          await connection.execute(
            `UPDATE product_variants SET ${fields.join(
              ", "
            )} WHERE id = ? AND product_id = ?`,
            [...values, variant.id, product_id]
          );
        }
      }
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Product updated successfully.",
    });
  } catch (error) {
    await connection.rollback();
    for (const publicId of cloudinaryUploads) {
      try {
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error("Cloudinary cleanup failed:", err.message);
      }
    }

    console.error("Update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update product.",
      error: error.message,
    });
  } finally {
    for (const file of productFilesArray) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
    connection.release();
  }
};

const deleteProduct = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can delete their products.",
    });
  }

  const { product_id } = req.body;

  const [shopRows] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  if (!shopRows.length) {
    return res
      .status(404)
      .json({ success: false, error: "Shop not found for this vendor." });
  }

  const shop_id = shopRows[0].id;

  const [productRows] = await pool.execute(
    "SELECT * FROM products WHERE id = ? AND shop_id = ?",
    [product_id, shop_id]
  );

  if (!productRows.length) {
    return res.status(404).json({ success: false, error: "Product not found" });
  }

  const client = await pool.getConnection();

  try {
    await client.beginTransaction();

    //get product variants
    const [variants] = await client.execute(
      "SELECT id, thumbnail, gallery_images FROM product_variants WHERE product_id = ?",
      [product_id]
    );

    // Delete product from DB
    const [deleteResult] = await client.execute(
      "DELETE FROM products WHERE id = ? AND shop_id = ?",
      [product_id, shop_id]
    );

    if (deleteResult.affectedRows === 0) {
      return res
        .status(500)
        .json({ success: false, error: "Failed to delete product" });
    }

    // Delete variant images
    for (const variant of variants) {
      // Delete variant thumbnail
      if (variant.thumbnail) {
        const public_id = getPublicIdFromUrl(variant.thumbnail);
        const result = await deleteFromCloudinary(public_id);
        if (
          !result?.result ||
          (result.result !== "ok" && result.result !== "not found")
        ) {
          throw new Error("Failed to delete variant thumbnail.");
        }
      }

      // Delete variant gallery
      if (variant.gallery_images) {
        const images =
          typeof variant.gallery_images === "string"
            ? JSON.parse(variant.gallery_images)
            : variant.gallery_images;

        const public_ids = images.map((url) => getPublicIdFromUrl(url));

        const deletions = await Promise.all(
          public_ids.map((id) => deleteFromCloudinary(id))
        );
        if (
          deletions.some(
            (res) =>
              !res?.result ||
              (res.result !== "ok" && res.result !== "not found")
          )
        ) {
          throw new Error("Failed to delete variant gallery images.");
        }
      }
    }

    await client.commit();
    return res.status(200).json({
      success: true,
      message: "Product deleted successfully.",
    });
  } catch (error) {
    await client.rollback();
    console.error("Delete product error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to delete product.",
    });
  } finally {
    client.release();
  }
};

const deleteVariant = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can delete their products.",
    });
  }

  const { variant_id } = req.body;

  const [shopRows] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  if (!shopRows.length) {
    return res
      .status(404)
      .json({ success: false, error: "Shop not found for this vendor." });
  }

  const [variantRows] = await pool.execute(
    "SELECT * FROM product_variants WHERE id = ?",
    [variant_id]
  );

  if (!variantRows.length) {
    return res
      .status(404)
      .json({ success: false, error: "Variant not found." });
  }

  const variant = variantRows[0];
  const thumbnail = variant.thumbnail;
  const gallery_images = variant.gallery_images;
  const variantStock = variant.stock;

  const client = await pool.getConnection();

  try {
    await client.beginTransaction();

    // Delete variant from DB
    const [deleteResult] = await client.execute(
      "DELETE FROM product_variants WHERE id = ?",
      [variant_id]
    );

    if (deleteResult.affectedRows === 0) {
      return res
        .status(500)
        .json({ success: false, error: "Failed to delete variant." });
    }

    // update product stock
    const [updateProductResult] = await client.execute(
      "UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?",
      [variantStock, variant.product_id]
    );

    if (updateProductResult.affectedRows === 0) {
      throw new Error("Failed to update product stock.");
    }

    // Delete variant images
    if (thumbnail && thumbnail !== "") {
      const public_id = getPublicIdFromUrl(thumbnail);
      const result = await deleteFromCloudinary(public_id);
      if (
        !result?.result ||
        (result.result !== "ok" && result.result !== "not found")
      ) {
        throw new Error("Failed to delete variant thumbnail.");
      }
    }

    if (gallery_images) {
      const images =
        typeof gallery_images === "string"
          ? JSON.parse(gallery_images)
          : gallery_images;

      const public_ids = images.map((url) => getPublicIdFromUrl(url));

      const deletions = await Promise.all(
        public_ids.map((id) => deleteFromCloudinary(id))
      );
      if (
        deletions.some(
          (res) =>
            !res?.result || (res.result !== "ok" && res.result !== "not found")
        )
      ) {
        throw new Error("Failed to delete variant gallery images.");
      }
    }

    await client.commit();
    return res.status(200).json({
      success: true,
      message: "Variant deleted successfully.",
    });
  } catch (error) {
    await client.rollback();
    console.error("Delete variant error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to delete variant.",
    });
  } finally {
    client.release();
  }
};

const addVariant = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can add variants to their products.",
    });
  }

  const formattedData =
    typeof req.body.variant === "string"
      ? JSON.parse(req.body.variant)
      : req.body.variant;

  const variant = sanitizeInput(formattedData);
  const product_id = req.body.product_id;

  const [shopRows] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  if (!shopRows?.length) {
    return res
      .status(404)
      .json({ success: false, error: "Shop not found for this vendor." });
  }

  const shop_id = shopRows[0].id;

  const [productRows] = await pool.execute(
    "SELECT * FROM products WHERE id = ? AND shop_id = ?",
    [parseInt(product_id), shop_id]
  );

  if (!productRows?.length) {
    return res
      .status(404)
      .json({ success: false, error: "Product not found." });
  }

  let thumbnail = null;
  const gallery_images = [];
  const uploadedImages = [];

  req.files.forEach((file) => {
    if (file.fieldname === "thumbnail") {
      thumbnail = file.path;
    } else if (file.fieldname === "gallery_images") {
      gallery_images.push(file.path);
    }
  });

  const client = await pool.getConnection();

  try {
    await client.beginTransaction();

    // Insert variant
    const insertQuery = [];
    const values = [];
    const placeholders = [];

    for (const [key, value] of Object.entries(variant)) {
      insertQuery.push(`\`${key}\``);
      values.push(value);
      placeholders.push(`?`);
    }

    insertQuery.push("product_id");
    values.push(parseInt(product_id));
    placeholders.push("?");

    const [insertResult] = await client.execute(
      `INSERT INTO product_variants (${insertQuery.join(
        ", "
      )}) VALUES (${placeholders.join(", ")})`,
      values
    );

    if (insertResult.affectedRows === 0) {
      await client.rollback();
      return res
        .status(500)
        .json({ success: false, error: "Failed to add variant." });
    }

    const variant_id = insertResult.insertId;

    // Update product stock
    const [stockResult] = await client.execute(
      `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`,
      [variant.stock, product_id]
    );

    if (stockResult.affectedRows === 0) {
      await client.rollback();
      return res
        .status(500)
        .json({ success: false, error: "Failed to update product stock." });
    }

    // Upload images
    let thumbnailUrl = null;
    const gallery_imagesUrl = [];

    if (thumbnail) {
      const uploadResult = await uploadImageToCloudinary(thumbnail, tenantId);
      if (!uploadResult?.secure_url) {
        throw new Error("Failed to upload variant thumbnail.");
      }

      uploadedImages.push(uploadResult.public_id);
      thumbnailUrl = uploadResult.secure_url;
    }

    if (gallery_images?.length) {
      const uploads = await Promise.all(
        gallery_images.map((imgPath) =>
          uploadImageToCloudinary(imgPath, tenantId)
        )
      );

      const failed = uploads.some((res) => !res?.secure_url);
      if (failed) {
        throw new Error("Failed to upload variant gallery images.");
      }

      uploadedImages.push(...uploads.map((res) => res.public_id));
      gallery_imagesUrl.push(...uploads.map((res) => res.secure_url));
    }

    const [updateResult] = await client.execute(
      `UPDATE product_variants SET thumbnail = ?, gallery_images = ? WHERE id = ?`,
      [
        thumbnailUrl || defaultImageUrl,
        JSON.stringify(gallery_imagesUrl),
        variant_id,
      ]
    );

    if (updateResult.affectedRows === 0) {
      await client.rollback();
      return res
        .status(500)
        .json({ success: false, error: "Failed to update variant images." });
    }

    await client.commit();

    return res.status(200).json({
      success: true,
      message: "Variant added successfully.",
    });
  } catch (error) {
    await client.rollback();

    for (const publicId of uploadedImages) {
      try {
        await deleteFromCloudinary(publicId);
      } catch (cloudErr) {
        console.error(
          `Failed to delete Cloudinary image [${publicId}]:`,
          cloudErr.message
        );
      }
    }

    console.error("Variant add error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to add variant.",
    });
  } finally {
    if (thumbnail && fs.existsSync(thumbnail)) {
      fs.unlinkSync(thumbnail);
    }

    for (const image of gallery_images) {
      if (image && fs.existsSync(image)) {
        fs.unlinkSync(image);
      }
    }

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
    order = "DESC",
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
      `SELECT * FROM products p ${whereSQL} ORDER BY p.sort_order ${order} LIMIT ${parseInt(
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
      `SELECT * FROM product_variants
       WHERE product_id IN (${productIds.map(() => "?").join(",")})`,
      productIds
    );

    const variantMap = {};
    for (const v of variantRows) {
      if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
      variantMap[v.product_id].push(v);
    }

    // Step 7: Build final response
    const data = productRows.map((product) => {
      const variants = variantMap[product.id] || [];

      // Pick the first variant to use for main product values (if exists)
      const [mainVariant, ...otherVariants] = variants;

      return {
        id: product.id,
        product_name: product.product_name,
        slug: product.slug,
        sku: product.sku,
        thumbnail: mainVariant?.thumbnail,
        gallery_images:
          typeof mainVariant?.gallery_images === "string"
            ? JSON.parse(mainVariant.gallery_images)
            : mainVariant?.gallery_images,
        selling_price: Number(mainVariant?.selling_price),
        base_price: Number(mainVariant?.base_price),
        cost_price: Number(mainVariant?.cost_price),
        stock: product.stock_quantity,
        tax: product.tax_percentage,
        stock_alert_at: product.min_stock_alert,
        stock_unit: product.stock_unit,
        is_in_stock: product.is_in_stock,
        hsn: product.hsn_code,
        barcode: product.barcode,
        brand: product.brand,
        status: product.status,
        short_description: product.short_description,
        long_description: product.long_description,
        warehouse_location: product.warehouse_location,
        tags: product.tags,
        attributes: product.attributes,
        is_featured: product.is_featured,
        is_new_arrival: product.is_new_arrival,
        is_best_seller: product.is_best_seller,
        product_type: product.product_type,
        meta_title: product.meta_title,
        meta_description: product.meta_description,
        custom_fields: product.custom_fields,
        created_at: product.created_at,
        updated_at: product.updated_at,
        categories: categoryMap[product.id] || [],
        variants: otherVariants, // remaining variants only
      };
    });

    return res.status(200).json({
      success: true,
      message: "Products fetched successfully.",
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
      data: data,
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products.",
      error: error.message,
    });
  }
};

const addCategory = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendor can add categories.",
    });
  }

  const [shop_id] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [user_id]
  );

  if (!shop_id || shop_id.length === 0) {
    return res.status(404).json({
      success: false,
      message: "Shop not found.",
    });
  }

  const modifiedInput = sanitizeInput(req.body);
  const category = modifiedInput;

  const [categoryExists] = await pool.execute(
    "SELECT * FROM categories WHERE title = ? AND shop_id = ?",
    [category.title, shop_id[0].id]
  );

  if (categoryExists.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Category already exists.",
    });
  }

  const [countResult] = await pool.execute(
    "SELECT COUNT(*) AS total FROM categories WHERE shop_id = ?",
    [shop_id[0].id]
  );

  const sort_order = countResult[0].total + 1;

  const image = req.file ? req.file : null;

  try {
    const {
      title,
      description,
      slug,
      status = "active",
      meta_title,
      meta_description,
      parent_id,
    } = category;

    let validParentId = parent_id === "null" ? null : parent_id;
    const [result] = await pool.execute(
      `INSERT INTO categories 
       (title, image_url, slug, description, status, sort_order, meta_title, meta_description, parent_id, shop_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        defaultImageUrl,
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
      const uploadResult = await uploadImageToCloudinary(image.path, tenantId);
      if (uploadResult) {
        await pool.execute("UPDATE categories SET image_url = ? WHERE id = ?", [
          uploadResult.secure_url,
          result.insertId,
        ]);
      } else {
        throw new Error("Failed to upload image to Cloudinary.");
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
      order = "DESC",
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClauses = [];
    const values = [];

    // Filters
    if (status) {
      whereClauses.push("status = ?");
      values.push(status.toLowerCase());
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

const deleteCategory = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can delete products.",
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

  const modifiedInput = sanitizeInput(req.body);
  const { id } = modifiedInput;

  const [category] = await pool.query(`Select * from categories where id = ?`, [
    id,
  ]);

  if (!category || category.length === 0) {
    return res.status(404).json({
      success: false,
      message: "Category not found.",
    });
  }

  const image = category[0].image_url;

  try {
    const [result] = await pool.query(`Delete from categories where id = ?`, [
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete category.",
      });
    }

    if (image !== defaultImageUrl) {
      const public_id = getPublicIdFromUrl(image);
      await deleteFromCloudinary(public_id);
    }

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting category:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to delete category.",
      error: error.message,
    });
  }
};

const updateCategory = async (req, res) => {
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

  const modifiedInput = sanitizeInput(req.body);
  const { id } = modifiedInput;

  const [category] = await pool.query(`Select * from categories where id = ?`, [
    id,
  ]);

  if (!category || category.length === 0) {
    return res.status(404).json({
      success: false,
      message: "Category not found.",
    });
  }

  try {
    const updateQuery = [];
    const updatevValues = [];

    for (const [key, value] of Object.entries(modifiedInput)) {
      if (key === "id") continue;
      updateQuery.push(`${key} = ?`);
      updatevValues.push(value);
    }

    if (updateQuery.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update.",
      });
    }

    console.log(updateQuery);
    const [result] = await pool.query(
      `UPDATE categories SET ${updateQuery.join(", ")} WHERE id = ?`,
      [updatevValues, id]
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to update category.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category updated successfully.",
      category_id: id,
    });
  } catch (error) {
    console.error("Error updating category:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update category.",
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
  deleteProduct,
  getPaginatedproducts,
  getPaginatedCategories,
  getPaginatedBrands,
  deleteCategory,
  updateCategory,
  deleteVariant,
  addVariant,
};
