import pools from "../../db/index.js";
import fs from "fs";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../../utils/cloudinary.util.js";

import { sanitizeInput } from "../../utils/validation.util.js";
import {
  categoryImageFolder,
  defaultImageUrl,
  productImageFolder,
  profileImageFolder,
} from "../../../constants.js";
import { getPublicIdFromUrl } from "../../utils/extractPublicID.util.js";
import { removeLocalFiles } from "../../helper/removeLocalFiles.js";

const updateShop = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: userId } = req.user;
  const image = req.file || null;
  let uploadedImage = null;

  const [shop] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [userId]
  );

  const shopId = shop[0]?.id;
  if (!shopId) {
    removeLocalFiles(image);
    return res.status(404).json({ success: false, error: "Shop not found." });
  }

  const updateFields = req.body;
  let address = null;
  if (updateFields.address) {
    address =
      typeof updateFields.address === "string"
        ? JSON.parse(updateFields.address)
        : updateFields.address;
    delete updateFields.address;
  }

  const allowedFields = [
    "name",
    "description",
    "license_number",
    "is_active",
    "email",
    "contact_alternate_phone",
    "is_verified",
    "is_featured",
    "categories",
    "working_hours",
    "is_open",
  ];

  // Filter out only valid fields
  const fieldsToUpdate = Object.keys(updateFields).filter((field) =>
    allowedFields.includes(field)
  );
  if (Object.keys(updateFields).length !== 0 && fieldsToUpdate.length === 0) {
    removeLocalFiles(image);
    return res
      .status(400)
      .json({ success: false, error: "No valid fields to update." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let logo_url = null;
    if (image) {
      const { secure_url, public_id } = await uploadImageToCloudinary(
        image.path,
        tenantId,
        profileImageFolder
      );
      uploadedImage = public_id;
      logo_url = secure_url;
    }

    if (fieldsToUpdate.length > 0) {
      const setClause = fieldsToUpdate.map((field) => `\`${field}\` = ?`);
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

      if (logo_url) {
        values.push(logo_url);
        setClause.push("`logo_url` = ?");
      }

      const sql = `UPDATE shops SET ${setClause.join(
        ", "
      )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      const [result] = await connection.execute(sql, [...values, shopId]);

      if (result.affectedRows === 0) {
        throw new Error("Failed to update shop.");
      }
    }

    if (address) {
      const [addressResult] = await connection.execute(
        `SELECT id FROM addresses WHERE shop_id = ?`,
        [shopId]
      );

      const addressId = addressResult[0]?.id;
      const addressFields = Object.keys(address);
      const addressValues = Object.values(address).map((value) => {
        if (typeof value === "object") {
          return JSON.stringify(value);
        }
        return value;
      });

      const updateQuery = `UPDATE addresses SET ${addressFields
        .map((field) => `\`${field}\` = ?`)
        .join(", ")} WHERE shop_id = ?`;

      const insertQuery = `INSERT INTO addresses (${addressFields
        .map((field) => `\`${field}\``)
        .join(", ")}, shop_id) VALUES (${addressFields
        .map(() => "?")
        .join(", ")}, ?)`;

      addressValues.push(shopId);

      const [result] = await connection.execute(
        addressId ? updateQuery : insertQuery,
        addressValues
      );

      if (result.affectedRows === 0) {
        throw new Error("Failed to update address.");
      }
    }

    await connection.commit();

    return res
      .status(200)
      .json({ success: true, message: "Shop updated successfully." });
  } catch (error) {
    console.error("Error updating shop:", error);
    await connection.rollback();
    await deleteFromCloudinary(uploadedImage);
    return res
      .status(500)
      .json({ success: false, error: "Internal Server Error" });
  } finally {
    if (image) {
      removeLocalFiles(image);
    }
    connection.release();
  }
};

const getShopProfile = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [shop] = await pool.query(
    `SELECT * FROM shops WHERE user_id = ? AND is_active = true`,
    [user_id]
  );

  if (!shop || shop.length === 0) {
    return res.status(404).json({ success: false, error: "Shop not found" });
  }

  // get address
  const [address] = await pool.query(
    `SELECT * FROM addresses WHERE shop_id = ?`,
    [shop[0].id]
  );

  const shopData = shop[0];

  const response = {
    id: shopData.id,
    name: shopData.name || "",
    description: shopData.description || "",
    logo_url: shopData.logo_url || "",
    license_number: shopData.license_number || "",
    status: shopData.is_active,
    email: shopData.email || "",
    contact_alternate_phone: shopData.contact_alternate_phone || "",
    is_verified: shopData.is_verified,
    is_featured: shopData.is_featured,
    working_hours: JSON.parse(shopData.working_hours) || {},
    is_open: shopData.is_open,
    address: {
      address_line1: address[0]?.address_line1 || "",
      address_line2: address[0]?.address_line2 || "",
      landmark: address[0]?.landmark || "",
      city: address[0]?.city || "",
      state: address[0]?.state || "",
      postal_code: address[0]?.postal_code || "",
      country: address[0]?.country || "",
      latitude: address[0]?.latitude || "",
      longitude: address[0]?.longitude || "",
    },
  };

  return res.status(200).json({
    success: true,
    message: "Profile data get successfully",
    data: response,
  });
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

  const modifiedInput = req.body;

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
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can add brands.",
    });
  }

  const brand = req.body;
  const image = req.file || null;

  try {
    // Get vendor's active shop
    const [shops] = await pool.execute(
      "SELECT id FROM shops WHERE user_id = ? AND is_active = 1 LIMIT 1",
      [user_id]
    );

    if (shops.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Active shop not found for this vendor.",
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
        error: "Brand title is required.",
      });
    }

    let image_url = null;

    const [result] = await pool.execute(
      `INSERT INTO brands 
       (title, slug, description, is_active, sort_order, meta_title, meta_description, shop_id)
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
      const uploadResult = await uploadImageToCloudinary(
        image.path,
        tenantId,
        categoryImageFolder
      );
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
      error: "Failed to add brand.",
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
    "SELECT id FROM shops WHERE user_id = ? AND is_active = 1 LIMIT 1",
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
      whereClauses.push("is_active = ?");
      values.push(status === "active" ? 1 : 0);
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
      message: "Brands fetched successfully.",
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
      error: "Failed to fetch brands.",
    });
  }
};

const addProducts = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;
  const productFilesArray = req.files || [];

  if (user_type !== "VENDOR") {
    removeLocalFiles(productFilesArray);
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can add products.",
    });
  }

  const [shops] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (shops.length === 0) {
    removeLocalFiles(productFilesArray);
    return res.status(404).json({
      success: false,
      error: "Active shop not found for this vendor.",
    });
  }

  // console.log(req.body);
  const shop_id = shops[0].id;
  const formattedData =
    typeof req.body.product === "string"
      ? JSON.parse(req.body.product)
      : req.body;

  const product = formattedData;
  const variants =
    typeof product.variants === "string"
      ? JSON.parse(product.variants)
      : product.variants;

  // Group multer.any() files by fieldname
  const productFiles = {};
  for (const file of productFilesArray) {
    if (!productFiles[file.fieldname]) {
      productFiles[file.fieldname] = [];
    }
    productFiles[file.fieldname].push(file);
  }

  const requiredFields = ["product_name", "sku", "category_ids", "variants"];
  for (const field of requiredFields) {
    if (!product[field]) {
      removeLocalFiles(productFilesArray);
      return res.status(400).json({
        success: false,
        error: `Missing required field: ${field}`,
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
      } else if (field === "is_active") {
        value = parseInt(product[field]);
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
    if (productResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to insert product.",
      });
    }

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
          error: "Failed to insert product categories.",
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
        "min_stock_alert",
        "is_active",
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

        const thumbnailFile = productFiles[`variant_thumbnail_${i + 1}`]?.[0];
        let thumbnailUpload = null;
        if (thumbnailFile && thumbnailFile.path) {
          thumbnailUpload = await uploadImageToCloudinary(
            thumbnailFile.path,
            tenantId,
            productImageFolder
          );
          cloudinaryUploads.push(thumbnailUpload.public_id);
        }

        const variantGalleryUrls = [];
        const galleryFiles =
          productFiles[`variant_gallery_images_${i + 1}`] || [];

        for (const g of galleryFiles) {
          const uploaded = await uploadImageToCloudinary(
            g.path,
            tenantId,
            productImageFolder
          );
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
          error: "Failed to insert product variants.",
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
      error: "Failed to add product.",
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
      error: "Forbidden: Only vendors can update their products.",
    });
  }

  const [shopRows] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (!shopRows.length) {
    return res.status(404).json({
      success: false,
      error: "Active shop not found for this vendor.",
    });
  }

  const shop_id = shopRows[0].id;
  const formattedData =
    typeof req.body.product === "string"
      ? JSON.parse(req.body.product)
      : req.body;

  const product = formattedData;
  const product_id = product.product_id;

  if (!product_id) {
    return res
      .status(400)
      .json({ success: false, error: "Product ID is required." });
  }

  const [existingProductRows] = await pool.execute(
    "SELECT * FROM products WHERE id = ? AND shop_id = ?",
    [product_id, shop_id]
  );

  if (!existingProductRows.length) {
    return res.status(404).json({
      success: false,
      error: "Product not found.",
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
      "is_active",
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
          "min_stock_alert",
          "is_active",
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
            tenantId,
            productImageFolder
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
            const uploaded = await uploadImageToCloudinary(
              file.path,
              tenantId,
              productImageFolder
            );
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
      error: "Failed to update product.",
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
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
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
  const variantImages = req.files || [];

  if (user_type !== "VENDOR") {
    removeLocalFiles(variantImages);
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can add variants to their products.",
    });
  }

  const formattedData =
    typeof req.body.variant === "string"
      ? JSON.parse(req.body.variant)
      : req.body.variant;

  const variant = formattedData;
  const product_id = req.body.product_id;

  const [shopRows] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (!shopRows?.length) {
    removeLocalFiles(variantImages);
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
    removeLocalFiles(variantImages);
    return res
      .status(404)
      .json({ success: false, error: "Product not found." });
  }

  let thumbnail = null;
  const gallery_images = [];
  const uploadedImages = [];

  variantImages.forEach((file) => {
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
      const uploadResult = await uploadImageToCloudinary(
        thumbnail,
        tenantId,
        productImageFolder
      );
      if (!uploadResult?.secure_url) {
        throw new Error("Failed to upload variant thumbnail.");
      }

      uploadedImages.push(uploadResult.public_id);
      thumbnailUrl = uploadResult.secure_url;
    }

    if (gallery_images?.length) {
      const uploads = await Promise.all(
        gallery_images.map((imgPath) =>
          uploadImageToCloudinary(imgPath, tenantId, productImageFolder)
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
    removeLocalFiles(variantImages);
    client.release();
  }
};

const getPaginatedproducts = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }

  const {
    page = 1,
    limit = 10,
    status = "",
    brand_id,
    category_id,
    search,
    order = "DESC",
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  try {
    // 🔹 Get vendor shop
    const [[shop]] = await pool.execute(
      "SELECT id FROM shops WHERE user_id = ? AND is_active = 1 LIMIT 1",
      [user_id]
    );
    if (!shop)
      return res
        .status(404)
        .json({ success: false, error: "No active shop found" });

    // 🔹 Build dynamic WHERE
    let whereSQL = `p.shop_id = ? AND p.deleted_at IS NULL`;
    const whereValues = [shop.id];

    if (status) {
      whereSQL += " AND p.is_active = ?";
      whereValues.push(status === "active" ? 1 : 0);
    }
    if (brand_id) {
      whereSQL += " AND p.brand_id = ?";
      whereValues.push(brand_id);
    }
    if (search) {
      whereSQL += " AND (p.product_name LIKE ? OR p.sku LIKE ?)";
      whereValues.push(`%${search}%`, `%${search}%`);
    }
    if (category_id) {
      whereSQL +=
        " AND EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?)";
      whereValues.push(category_id);
    }

    // 🔹 One query for products + count + categories + variants
    const [rows] = await pool.query(
      `
      WITH products_cte AS (
        SELECT p.*
        FROM products p
        WHERE ${whereSQL}
        ORDER BY p.sort_order ${order}
        LIMIT ? OFFSET ?
      )
      SELECT 
        p.id,
        p.product_name,
        p.slug,
        p.sku,
        p.stock_quantity,
        p.tax_percentage,
        p.min_stock_alert,
        p.stock_unit,
        p.is_in_stock,
        p.hsn_code,
        p.barcode,
        p.brand_id AS brand,
        p.status,
        p.short_description,
        p.long_description,
        p.warehouse_location,
        p.tags,
        p.attributes,
        p.specifications,
        p.is_featured,
        p.is_new_arrival,
        p.is_best_seller,
        p.is_active,
        p.product_type,
        p.meta_title,
        p.meta_description,
        p.custom_fields,
        p.created_at,
        p.updated_at,

        -- categories as JSON array
        (
          SELECT JSON_ARRAYAGG(c.title) 
          FROM product_categories pc 
          JOIN categories c ON pc.category_id = c.id
          WHERE pc.product_id = p.id
        ) as categories,

        -- variants as JSON array
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', v.id,
              'sku', v.sku,
              'barcode', v.barcode,
              'color', v.color,
              'size', v.size,
              'material', v.material,
              'selling_price', v.selling_price,
              'cost_price', v.cost_price,
              'base_price', v.base_price,
              'cost_price', v.cost_price,
              'stock', v.stock,
              'min_stock_alert', v.min_stock_alert,
              'thumbnail', v.thumbnail,
              'gallery_images', v.gallery_images,
              'is_active', v.is_active,
              'is_deleted', v.is_deleted,
              'created_at', v.created_at,
              'updated_at', v.updated_at
            )
          )
          FROM product_variants v 
          WHERE v.product_id = p.id AND v.deleted_at IS NULL
        ) as variants,

        -- total count
        (SELECT COUNT(*) FROM products p WHERE ${whereSQL}) as total

      FROM products_cte p
      `,
      [...whereValues, parseInt(limit), offset, ...whereValues]
    );

    if (!rows.length) {
      return res.json({
        success: true,
        message: "No products found",
        pagination: {
          total: 0,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: 0,
        },
        data: [],
      });
    }

    const total = rows[0].total;

    const data = rows.map((product) => {
      const variants =
        typeof product.variants === "string"
          ? JSON.parse(product.variants || "[]")
          : product.variants || [];
      const [mainVariant, ...otherVariants] = variants;

      return {
        id: product.id,
        product_name: product.product_name,
        slug: product.slug,
        sku: product.sku,
        total_stock: product.stock_quantity,
        thumbnail: mainVariant ? mainVariant.thumbnail : null,
        selling_price: mainVariant ? mainVariant.selling_price : null,
        tax_percentage: product.tax_percentage,
        min_stock_alert: product.min_stock_alert,
        stock_unit: product.stock_unit,
        is_in_stock: product.is_in_stock,
        hsn_code: product.hsn_code || "",
        barcode: product.barcode || "",
        brand: product.brand || "",
        status: product.status || "",
        short_description: product.short_description || "",
        long_description: product.long_description || "",
        warehouse_location: product.warehouse_location || "",
        tags:
          product.tags && typeof product.tags === "string"
            ? JSON.parse(product.tags)
            : product.tags || [],
        attributes:
          product.attributes && typeof product.attributes === "string"
            ? JSON.parse(product.attributes)
            : product.attributes || {},
        specifications:
          product.specifications && typeof product.specifications === "string"
            ? JSON.parse(product.specifications)
            : product.specifications || {},
        is_featured: product.is_featured || false,
        is_new_arrival: product.is_new_arrival || false,
        is_best_seller: product.is_best_seller || false,
        is_active: product.is_active || false,
        product_type: product.product_type || "",
        meta_title: product.meta_title || "",
        meta_description: product.meta_description || "",
        custom_fields:
          product.custom_fields && typeof product.custom_fields === "string"
            ? JSON.parse(product.custom_fields)
            : product.custom_fields || {},
        created_at: product.created_at,
        updated_at: product.updated_at,
        categories:
          typeof product.categories === "string"
            ? JSON.parse(product.categories || "[]")
            : product.categories || [],
        variants,
      };
    });

    return res.json({
      success: true,
      message: "Products fetched successfully",
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
      data,
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const addCategory = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;
  const image = req.file ? req.file : null;

  if (user_type !== "VENDOR") {
    removeLocalFiles(image);
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendor can add categories.",
    });
  }

  const [shop] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (!shop || shop.length === 0) {
    removeLocalFiles(image);
    return res.status(404).json({
      success: false,
      error: "Shop not found.",
    });
  }

  const shop_id = shop[0].id;

  const modifiedInput = req.body;
  const category = modifiedInput;

  if (!category.title || category.title.trim() === "") {
    removeLocalFiles(image);
    return res.status(400).json({
      success: false,
      error: "Category title is required.",
    });
  }

  const [categoryExists] = await pool.execute(
    "SELECT * FROM categories WHERE title = ? AND shop_id = ?",
    [category.title, shop_id]
  );

  if (categoryExists.length > 0) {
    removeLocalFiles(image);
    return res.status(400).json({
      success: false,
      error: "Category already exists.",
    });
  }

  const [countResult] = await pool.execute(
    "SELECT COUNT(*) AS total FROM categories WHERE shop_id = ?",
    [shop_id]
  );

  const sort_order = countResult[0].total + 1;

  try {
    const {
      title,
      description,
      slug,
      is_active = "1",
      meta_title,
      meta_description,
      parent_id,
    } = category;

    let validParentId = parent_id === "null" ? null : parent_id;
    const [result] = await pool.execute(
      `INSERT INTO categories 
       (title, image_url, slug, description, is_active, sort_order, meta_title, meta_description, parent_id, shop_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        defaultImageUrl,
        slug,
        description || null,
        is_active === "1" ? true : false,
        sort_order,
        meta_title || null,
        meta_description || null,
        validParentId || null,
        shop_id,
      ]
    );

    if (image && image !== null) {
      const uploadResult = await uploadImageToCloudinary(
        image.path,
        tenantId,
        categoryImageFolder
      );
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
    removeLocalFiles(image);
  }
};

const getPaginatedCategories = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;

  try {
    // 🔹 1. Find shop
    const [[shop]] = await pool.execute(
      "SELECT id FROM shops WHERE user_id = ? AND is_active = 1 LIMIT 1",
      [user_id]
    );
    if (!shop) {
      return res.status(404).json({ success: false, error: "Shop not found." });
    }
    const shop_id = shop.id;

    // 🔹 2. Query params
    const {
      page = 1,
      status = "active",
      title,
      parent_id,
      search,
      sort_by = "sort_order",
      order = "DESC",
    } = req.query;

    const offset = (parseInt(page) - 1) * (parseInt(req.query.limit) || 10);
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;

    // 🔹 3. Dynamic filters
    let whereSQL = `shop_id = ? AND is_deleted = 0`;
    const values = [shop_id];

    if (status) {
      whereSQL += " AND is_active = ?";
      values.push(status === "active" ? 1 : 0);
    }
    if (title) {
      whereSQL += " AND title LIKE ?";
      values.push(`%${title}%`);
    }
    if (parent_id) {
      whereSQL += " AND parent_id = ?";
      values.push(parent_id);
    }
    if (search) {
      whereSQL += " AND (title LIKE ? OR slug LIKE ? OR description LIKE ?)";
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // 🔹 4. Safer sort whitelist
    const validSortFields = ["sort_order", "title", "created_at", "updated_at"];
    const sortField = validSortFields.includes(sort_by)
      ? sort_by
      : "sort_order";
    const sortOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC";

    // 🔹 5. Single query with CTE (count + data)
    const [rows] = await pool.query(
      `
      WITH categories_cte AS (
        SELECT c.*
        FROM categories c
        WHERE ${whereSQL}
        ORDER BY ${sortField} ${sortOrder}
        LIMIT ? OFFSET ?
      )
      SELECT 
        (SELECT COUNT(*) FROM categories WHERE ${whereSQL}) as total,
        c.*
      FROM categories_cte c
      `,
      [...values, limit, offset, ...values] // values repeated for subquery
    );

    if (!rows.length) {
      return res.json({
        success: true,
        message: "No categories found.",
        pagination: {
          total: 0,
          page: parseInt(page),
          per_page: limit,
          total_pages: 0,
        },
        data: [],
      });
    }

    const total = rows[0].total;
    const categories = rows.map((r) => {
      const { total, ...rest } = r; // remove total from row
      return rest;
    });

    return res.json({
      success: true,
      message: "Categories fetched successfully.",
      pagination: {
        total,
        page: parseInt(page),
        per_page: limit,
        total_pages: Math.ceil(total / limit),
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
      error: "Forbidden: Only vendors can delete products.",
    });
  }

  const [shops] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (shops.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Active shop not found for this vendor.",
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
      error: "Category not found.",
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
        error: "Failed to delete category.",
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
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;
  const image = req.file || null;

  if (user_type !== "VENDOR") {
    removeLocalFiles(image);
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can add products.",
    });
  }

  const [shops] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (shops.length === 0) {
    removeLocalFiles(image);
    return res.status(404).json({
      success: false,
      error: "Active shop not found for this vendor.",
    });
  }

  const shop_id = shops[0].id;

  const modifiedInput = req.body;
  const { id } = modifiedInput;

  const [category] = await pool.query(`Select * from categories where id = ?`, [
    id,
  ]);

  if (!category || category.length === 0) {
    removeLocalFiles(image);
    return res.status(404).json({
      success: false,
      error: "Category not found.",
    });
  }

  try {
    const updateQuery = [];
    const updateValues = [];

    for (const [key, value] of Object.entries(modifiedInput)) {
      if (key === "id" || key === "categoryImage") continue;

      if (key === "status") {
        updateQuery.push(`is_active = ?`);
        updateValues.push(value);
        continue;
      }

      updateQuery.push(`${key} = ?`);
      updateValues.push(value);
    }

    updateValues.push(id);

    if (updateQuery.length > 0) {
      const [result] = await pool.query(
        `UPDATE categories SET ${updateQuery.join(", ")} WHERE id = ?`,
        updateValues
      );

      if (result.affectedRows === 0) {
        return res.status(500).json({
          success: false,
          error: "Failed to update category.",
        });
      }
    }

    if (image && image !== null) {
      const uploadResult = await uploadImageToCloudinary(
        image.path,
        tenantId,
        categoryImageFolder
      );
      if (uploadResult) {
        await pool.execute("UPDATE categories SET image_url = ? WHERE id = ?", [
          uploadResult.secure_url,
          id,
        ]);
      } else {
        throw new Error("Failed to upload image to Cloudinary.");
      }
    }

    // Delete the old images from Cloudinary
    if (category[0].image_url !== defaultImageUrl) {
      const public_id = getPublicIdFromUrl(category[0].image_url);
      await deleteFromCloudinary(public_id);
    }

    return res.status(200).json({
      success: true,
      message: "Category updated successfully.",
      category_id: id,
    });
  } catch (error) {
    console.error("Error updating category:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update category.",
    });
  } finally {
    if (image && image !== null) {
      removeLocalFiles(image);
    }
  }
};

const getUsers = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      error: "Invalid user type.",
    });
  }

  try {
    // 🔹 1. Verify shop
    const [[shop]] = await pool.execute(
      "SELECT id FROM shops WHERE user_id = ? AND is_active = 1 LIMIT 1",
      [user_id]
    );
    if (!shop) {
      return res
        .status(404)
        .json({ success: false, error: "Active shop not found." });
    }

    // 🔹 2. Query params
    const {
      status,
      search = "",
      sort_by = "created_at",
      order = "DESC",
    } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // 🔹 3. Dynamic filters
    let whereSQL = "u.id != ?";
    const values = [user_id];

    if (status) {
      whereSQL += " AND u.is_active = ?";
      values.push(status === "active" ? 1 : 0);
    }

    if (search) {
      whereSQL += " AND u.full_name LIKE ?";
      values.push(`%${search}%`);
    }

    // 🔹 4. Sort whitelist
    const validSortFields = ["created_at", "updated_at", "full_name"];
    const sortField = validSortFields.includes(sort_by)
      ? sort_by
      : "created_at";
    const sortOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC";

    // 🔹 5. Single query for count + data (CTE)
    const [rows] = await pool.query(
      `
      WITH users_cte AS (
        SELECT u.*
        FROM users u
        WHERE ${whereSQL}
        ORDER BY u.${sortField} ${sortOrder}
        LIMIT ? OFFSET ?
      )
      SELECT 
        (SELECT COUNT(*) FROM users u WHERE ${whereSQL}) as total,
        u.*
      FROM users_cte u
      `,
      [...values, limit, offset, ...values] // `values` reused for count subquery
    );

    if (!rows.length) {
      return res.json({
        success: true,
        message: "No users found.",
        pagination: { total: 0, page, limit, total_pages: 0 },
        users: [],
      });
    }

    const total = rows[0].total;
    const users = rows.map((r) => {
      const { total, ...rest } = r; // strip "total" from each row
      return rest;
    });

    return res.json({
      success: true,
      message: "Users fetched successfully.",
      users,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users.",
      error: error.message,
    });
  }
};

const softDeleteProduct = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can delete products.",
    });
  }

  const [shops] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (shops.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Active shop not found for this vendor.",
    });
  }

  const shop_id = shops[0].id;
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({
      success: false,
      error: "Product ID is required.",
    });
  }

  try {
    await pool.execute("UPDATE products SET is_deleted = 1 WHERE id = ?", [id]);
    return res.status(200).json({
      success: true,
      message: "Product deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting product:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to delete product.",
    });
  }
};

const softDeleteVariant = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can delete products.",
    });
  }

  const [shops] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (shops.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Active shop not found for this vendor.",
    });
  }

  const shop_id = shops[0].id;
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({
      success: false,
      error: "Variant ID is required.",
    });
  }

  try {
    await pool.execute(
      "UPDATE product_variants SET is_deleted = 1 WHERE id = ?",
      [id]
    );
    return res.status(200).json({
      success: true,
      message: "Variant deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting variant:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to delete variant.",
    });
  }
};

const softDeleteCategory = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;

  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can delete products.",
    });
  }

  const [shops] = await pool.execute(
    "SELECT id FROM shops WHERE user_id = ? AND is_active = true LIMIT 1",
    [user_id]
  );

  if (shops.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Active shop not found for this vendor.",
    });
  }

  const shop_id = shops[0].id;
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({
      success: false,
      error: "Category ID is required.",
    });
  }

  try {
    await pool.execute("UPDATE categories SET is_deleted = 1 WHERE id = ?", [
      id,
    ]);
    return res.status(200).json({
      success: true,
      message: "Category deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to delete category.",
    });
  }
};

export {
  updateShop,
  getShopProfile,
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
  getUsers,
  softDeleteProduct,
  softDeleteVariant,
  softDeleteCategory,
};
