import pool from "../db/index.js";

const getPaginatedCategories = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
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
  const { page = 1, limit = 10, search, category_id, brand_id } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const filters = [
    "p.deleted_at IS NULL",
    "p.status = 'active'",
    "p.is_in_stock = TRUE",
  ];
  const values = [];

  try {
    // Apply filters
    if (search) {
      filters.push("(p.product_name LIKE ? OR p.slug LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }

    if (brand_id) {
      filters.push("p.brand_id = ?");
      values.push(brand_id);
    }

    const whereSQL = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) AS total FROM products p ${whereSQL}`,
      values
    );

    const total = countResult[0].total;

    // Fetch paginated products
    const [products] = await pool.execute(
      `SELECT
        p.id, p.product_name, p.slug, p.thumbnail, p.mrp, p.selling_price,
        b.name AS brand
      FROM products p
      JOIN brands b ON p.brand_id = b.id
      ${whereSQL}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
      [...values, parseInt(limit), offset]
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

    const productIds = products.map((p) => p.id);

    // Optional: filter by category
    if (category_id) {
      const [categoryFiltered] = await pool.execute(
        `SELECT DISTINCT product_id FROM product_categories WHERE category_id = ?`,
        [category_id]
      );
      const validIds = new Set(categoryFiltered.map((r) => r.product_id));
      products = products.filter((p) => validIds.has(p.id));
    }

    // Fetch categories
    const [categoryRows] = await pool.execute(
      `SELECT pc.product_id, c.title
       FROM product_categories pc
       JOIN categories c ON pc.category_id = c.id
       WHERE pc.product_id IN (${productIds.map(() => "?").join(",")})`,
      productIds
    );

    const categoryMap = {};
    for (const row of categoryRows) {
      if (!categoryMap[row.product_id]) categoryMap[row.product_id] = [];
      categoryMap[row.product_id].push(row.title);
    }

    // Fetch variants
    const [variantRows] = await pool.execute(
      `SELECT
         product_id, sku, color, size, selling_price
       FROM product_variants
       WHERE product_id IN (${productIds.map(() => "?").join(",")})
         AND is_deleted = FALSE
         AND is_visible = TRUE
         AND is_available = TRUE`,
      productIds
    );

    const variantMap = {};
    for (const variant of variantRows) {
      if (!variantMap[variant.product_id]) variantMap[variant.product_id] = [];
      variantMap[variant.product_id].push(variant);
    }

    // Assemble response
    const response = products.map((product) => ({
      id: product.id,
      product_name: product.product_name,
      slug: product.slug,
      thumbnail: product.thumbnail,
      mrp: product.mrp,
      selling_price: product.selling_price,
      brand: product.brand,
      categories: categoryMap[product.id] || [],
      variants: variantMap[product.id] || [],
    }));

    return res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
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
