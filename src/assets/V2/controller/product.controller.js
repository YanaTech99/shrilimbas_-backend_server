import pools from "../../db/index.js";

// helper function to modify product response
const modifyProductResponse = async (data, tenantId) => {
  const pool = pools[tenantId];
  const modifiedData = await Promise.all(
    data.map(async (product) => {
      const product_id = product.id;

      // Parse JSON fields
      const fields = [
        "specifications",
        "tags",
        "attributes",
        "custom_fields",
        "gallery_images",
      ];

      for (const field of fields) {
        if (product[field]) {
          product[field] =
            typeof product[field] === "string"
              ? JSON.parse(product[field])
              : product[field];
        }
      }

      // Fetch categories
      const [categories] = await pool.execute(
        `
        SELECT title FROM categories
        WHERE id IN (
          SELECT category_id FROM product_categories
          WHERE product_id = ?
        )
      `,
        [product_id]
      );
      const categoriesArray = categories.map((category) => category.title);

      // fetch product variants
      const [variants] = await pool.execute(
        `SELECT * FROM product_variants WHERE product_id = ?`,
        [product_id]
      );

      product.thumbnail = variants[0]?.thumbnail || "";
      if (variants[0].gallery_images) {
        product.gallery_images =
          typeof variants[0].gallery_images === "string"
            ? JSON.parse(variants[0].gallery_images)
            : variants[0].gallery_images;
      } else {
        product.gallery_images = [];
      }

      product.variants = variants.map((variant) => {
        return {
          ...variant,
          gallery_images:
            typeof variant.gallery_images === "string"
              ? JSON.parse(variant.gallery_images)
              : variant.gallery_images || [],
        };
      });

      const price = parseFloat(product.selling_price) || 0;
      const tax = parseFloat(product.tax_percentage || 0);
      const discount = parseFloat(product.discount || 0);

      const total_price = price - discount + tax;

      return {
        ...product,
        categories: categoriesArray,
        finalAmmount: total_price,
      };
    })
  );

  return modifiedData;
};

const getPaginatedCategories = async (req, res) => {
  const pool = pools[req.tenantId];

  try {
    const {
      page = 1,
      limit = 10,
      status = true,
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
      whereClauses.push("is_active = ?");
      values.push(status);
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
      `SELECT * FROM categories ${whereSQL} ORDER BY ${sort_by} ${order} LIMIT ${limit} OFFSET ${offset}`,
      [...values]
    );

    return res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      per_page: parseInt(limit),
      total_pages: totalPages,
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

const getPaginatedBrands = async (req, res) => {
  const pool = pools[req.tenantId];

  try {
    const {
      page = 1,
      limit = 10,
      status = true,
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

const getPaginatedProducts = async (req, res) => {
  const pool = pools[req.tenantId];

  const { page = 1, limit = 10, search, category_id } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const filters = [
    "p.deleted_at IS NULL",
    "p.is_in_stock = TRUE",
    "p.is_active = TRUE",
    "p.is_deleted = FALSE",
  ];
  const values = [];

  try {
    // Apply filters
    if (search) {
      filters.push("(p.product_name LIKE ? OR p.slug LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }

    const whereSQL = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Fetch paginated products
    let [products] = await pool.execute(
      `SELECT p.* FROM products p
      ${whereSQL}
      ORDER BY p.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      [...values]
    );

    if (products.length === 0) {
      return res.json({
        success: true,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        data: [],
      });
    }

    const total = products.length;

    const response = await modifyProductResponse(products, req.tenantId);

    return res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: response,
    });
  } catch (err) {
    console.error("Customer product fetch error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products.",
      error: err.message,
    });
  }
};

export { getPaginatedCategories, getPaginatedBrands, getPaginatedProducts };
