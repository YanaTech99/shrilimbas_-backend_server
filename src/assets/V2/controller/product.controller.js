import pools from "../../db/index.js";

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
      message: "Categories fetched successfully.",
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
      error: "Failed to fetch categories.",
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
    // 🔹 Search filter
    if (search) {
      filters.push("(p.product_name LIKE ? OR p.slug LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }

    // 🔹 Filter by category
    if (category_id) {
      filters.push(
        "EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?)"
      );
      values.push(category_id);
    }

    const whereSQL = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // 🔹 1. Count total
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM products p ${whereSQL}`,
      values
    );

    if (total === 0) {
      return res.json({
        success: true,
        message: "Products not found",
        total: 0,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: 0,
        data: [],
      });
    }

    // 🔹 2. Fetch paginated products
    const [products] = await pool.query(
      `SELECT p.* FROM products p
       ${whereSQL}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...values, parseInt(limit), offset]
    );

    const productIds = products.map((p) => p.id);
    if (productIds.length === 0) {
      return res.json({ success: true, message: "No products", data: [] });
    }

    // 🔹 3. Fetch related data in bulk
    const [categories] = await pool.query(
      `SELECT pc.product_id, c.title 
       FROM product_categories pc
       JOIN categories c ON pc.category_id = c.id
       WHERE pc.product_id IN (?)`,
      [productIds]
    );

    const [variants] = await pool.query(
      `SELECT * FROM product_variants WHERE product_id IN (?) AND is_deleted = 0`,
      [productIds]
    );
    console.log("variants",variants);

    // 🔹 4. Map results
    const categoryMap = categories.reduce((acc, row) => {
      if (!acc[row.product_id]) acc[row.product_id] = [];
      acc[row.product_id].push(row.title);
      return acc;
    }, {});

    const variantMap = variants.reduce((acc, v) => {
      if (!acc[v.product_id]) acc[v.product_id] = [];
      acc[v.product_id].push({
        ...v,
        gallery_images:
          typeof v.gallery_images === "string"
            ? JSON.parse(v.gallery_images)
            : v.gallery_images || [],
      });
      return acc;
    }, {});

    // 🔹 5. Final response format
    const response = products.map((product) => {
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

      const productVariants = variantMap[product.id] || [];
      const mainVariant = productVariants[0];

      const price = parseFloat(mainVariant?.selling_price || 0);
      const tax = parseFloat(product.tax_percentage || 0);
      const discount = parseFloat(product.discount || 0);
      const total_price = price - discount + tax;

      return {
        ...product,
        categories: categoryMap[product.id] || [],
        thumbnail: mainVariant?.thumbnail || "",
        gallery_images: mainVariant?.gallery_images || [],
        variants: productVariants.map((v) => {
          const vPrice = parseFloat(v.selling_price) || 0;
          return {
            ...v,
            finalAmmount: vPrice - discount + tax,
          };
        }),
        finalAmmount: total_price,
      };
    });

    return res.json({
      success: true,
      message: "Products fetched successfully.",
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
      error: "Failed to fetch products.",
    });
  }
};

export { getPaginatedCategories, getPaginatedBrands, getPaginatedProducts };
