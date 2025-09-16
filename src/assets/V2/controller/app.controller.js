import pools from "../../db/index.js";

const getSlidersByPosition = async (position, connection) => {
  const [slider] = await connection.query(
    `SELECT id, name, position, type, sort_order FROM sliders WHERE position = ? AND is_active = true ORDER BY sort_order LIMIT 1`,
    [position]
  );
  if (!slider.length) return [];

  const [items] = await connection.query(
    `SELECT id, slider_id, title, subtitle, image_url, link_type, link_reference_id, link_url, sort_order FROM slider_items WHERE slider_id = ? AND is_active = true ORDER BY sort_order`,
    [slider[0].id]
  );

  return {
    ...slider[0],
    items,
  };
};

const getCartData = async (customer_id, connection) => {
  // Fetch all cart items for the customer
  const [cartItems] = await connection.execute(
    `SELECT * FROM cart_items WHERE customer_id = ?`,
    [customer_id]
  );
  if (cartItems.length === 0) return [];

  // Collect unique product_ids and variant_ids from cart
  const productIds = [...new Set(cartItems.map((item) => item.product_id))];
  const variantIds = cartItems
    .filter((item) => item.product_variant_id !== null)
    .map((item) => item.product_variant_id);

  // Fetch all products in one query
  const [productsRows] = await connection.query(
    `SELECT id, product_name, short_description FROM products WHERE id IN (?)`,
    [productIds]
  );

  // Fetch all variants in one query (only if there are variantIds)
  let variantsRows = [];
  if (variantIds.length > 0) {
    [variantsRows] = await connection.query(
      `SELECT * FROM product_variants WHERE id IN (?)`,
      [variantIds]
    );
  }

  // Create maps for fast lookup
  const productsMap = new Map();
  productsRows.forEach((p) => productsMap.set(p.id, p));

  const variantsMap = new Map();
  variantsRows.forEach((v) => variantsMap.set(v.id, v));

  // Map cart items with their products and variants
  const cartData = cartItems.map((item) => {
    const product = productsMap.get(item.product_id) || {};
    const variant = item.product_variant_id
      ? variantsMap.get(item.product_variant_id)
      : null;

    return {
      id: product.id,
      product_name: product.product_name,
      thumbnail: variant?.thumbnail,
      short_description: product.short_description,
      quantity: item.quantity,
      mrp: variant?.selling_price,
      price_per_unit: item.price_per_unit,
      discount_per_unit: item.discount_per_unit,
      tax_per_unit: item.tax_per_unit,
      sku: item.sku,
      product_snapshot: item.product_snapshot,
      variants: variant ? [variant] : [],
      finalAmmount: variant?.selling_price,
    };
  });

  return cartData;
};

const modifyProductResponse = (products, variantsMap, categoriesMap) => {
  return products.map((product) => {
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

    const categoriesArray = categoriesMap.get(product.id) || [];
    const productVariants = variantsMap.get(product.id) || [];
    const firstVariant = productVariants[0] || {};

    // Safely set product thumbnail
    product.thumbnail = firstVariant.thumbnail || null;

    // Parse first variant's gallery_images or fallback to empty array
    product.gallery_images =
      firstVariant.gallery_images
        ? typeof firstVariant.gallery_images === "string"
          ? JSON.parse(firstVariant.gallery_images)
          : firstVariant.gallery_images
        : [];

    const tax = parseFloat(product.tax_percentage || 0);
    const discount = parseFloat(product.discount || 0);

    // Map variants properly with correct per-variant finalAmmount
    const variants = productVariants.map((variant) => {
      const vPrice = parseFloat(variant.selling_price) || 0;
      const finalAmmount = vPrice - discount + tax;

      const vIsInStock = variant.stock > 0 ? 1 : 0;

      return {
        ...variant,
        finalAmmount,
        is_in_stock: vIsInStock,
        gallery_images:
          typeof variant.gallery_images === "string"
            ? JSON.parse(variant.gallery_images)
            : variant.gallery_images || [],
      };
    });

    // Set product-level finalAmmount as the first variant's computed amount or 0
    const productFinalAmmount =
      variants.length > 0 ? variants[0].finalAmmount : 0;

    return {
      ...product,
      categories: categoriesArray,
      variants,
      finalAmmount: productFinalAmmount,
    };
  });
};

const getAppData = async (req, res) => {
  const userId = req.userId;
  const tenantID = req.tenantId;
  const pool = pools[tenantID];
  const connection = await pool.getConnection();

  try {
    let customer_id = null;
    if (userId) {
      const [customerRows] = await connection.query(
        `SELECT id FROM customers WHERE user_id = ?`,
        [userId]
      );
      if (customerRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Customer not found",
        });
      }
      customer_id = customerRows[0].id;
    }

    const sliderPositions = [
      "homepage_top",
      "homepage_middle",
      "homepage_bottom",
    ];
    const sliderPromises = sliderPositions.map((pos) =>
      getSlidersByPosition(pos, connection)
    );

    const productsQueries = [
      `SELECT * FROM products WHERE is_best_seller = true AND is_active = true ORDER BY sort_order LIMIT 10`,
      `SELECT id, title, description, image_url FROM categories WHERE is_active = true AND parent_id IS NULL ORDER BY sort_order DESC LIMIT 10`,
      `SELECT * FROM products WHERE product_type = 'home_appliance' AND is_active = true ORDER BY sort_order LIMIT 10`,
      `SELECT * FROM products WHERE is_featured = true AND is_active = true ORDER BY sort_order`,
      `SELECT id, title, description, image_url FROM brands WHERE is_active = true ORDER BY sort_order`,
      `SELECT * FROM products WHERE is_active = true ORDER BY sort_order DESC LIMIT 30`,
    ];

    const [
      topSlider,
      midSlider,
      bottomSlider,
      [bestDealProducts],
      [allCategories],
      [homeAppliances],
      [featuredProducts],
      [brands],
      [allProducts],
    ] = await Promise.all([
      ...sliderPromises,
      ...productsQueries.map((q) => connection.query(q)),
    ]);

    // Deduplicate products by ID
    const allFetchedProducts = [
      ...bestDealProducts,
      ...homeAppliances,
      ...featuredProducts,
      ...allProducts,
    ];

    const uniqueProductsMap = new Map();
    allFetchedProducts.forEach((prod) => {
      if (!uniqueProductsMap.has(prod.id)) {
        uniqueProductsMap.set(prod.id, prod);
      }
    });
    const uniqueProducts = Array.from(uniqueProductsMap.values());

    const productIds = uniqueProducts.map((p) => p.id);

    // Fetch variants and deduplicate by variant ID
    const variantsRows =
      productIds.length > 0
        ? (
            await connection.query(
              `SELECT * FROM product_variants WHERE product_id IN (?)`,
              [productIds]
            )
          )[0]
        : [];

    // Deduplicate variants by variant ID (not product_id)
    const uniqueVariantsMap = new Map();
    variantsRows.forEach((variant) => {
      if (!uniqueVariantsMap.has(variant.id)) {
        uniqueVariantsMap.set(variant.id, variant);
      }
    });
    const uniqueVariants = Array.from(uniqueVariantsMap.values());

    const categoriesRows =
      productIds.length > 0
        ? (
            await connection.query(
              `SELECT c.title, pc.product_id FROM categories c JOIN product_categories pc ON c.id = pc.category_id WHERE pc.product_id IN (?)`,
              [productIds]
            )
          )[0]
        : [];

    // Group unique variants by product_id
    const variantsMap = new Map();
    for (const variant of uniqueVariants) {
      if (variant.product_id) {
        if (!variantsMap.has(variant.product_id)) {
          variantsMap.set(variant.product_id, []);
        }
        variantsMap.get(variant.product_id).push(variant);
      }
    }

    const categoriesMap = new Map();
    for (const cat of categoriesRows) {
      if (cat.product_id) {
        if (!categoriesMap.has(cat.product_id)) {
          categoriesMap.set(cat.product_id, []);
        }
        categoriesMap.get(cat.product_id).push(cat.title);
      }
    }

    const modifiedProducts = modifyProductResponse(
      uniqueProducts,
      variantsMap,
      categoriesMap
    );

    const modifiedFeatured = modifiedProducts.filter((p) => p.is_featured);
    const modifiedBestDeals = modifiedProducts.filter((p) => p.is_best_seller);
    const modifiedHomeAppliances = modifiedProducts.filter(
      (p) => p.product_type === "home_appliance"
    );
    const modifiedAllProducts = modifiedProducts;

    let cartItems = [];
    if (userId && customer_id) {
      cartItems = await getCartData(customer_id, connection);
    }

    const safe = (data) => (data == null ? [] : data);

    return res.status(200).json({
      success: true,
      message: "App data fetched successfully",
      data: {
        topSlider: topSlider || {},
        categories0: safe(allCategories),
        NewArrivalSlider: midSlider || {},
        banner1: bottomSlider || {},
        featuredProducts: modifiedFeatured,
        bestDeals: modifiedBestDeals,
        homeAppliances: modifiedHomeAppliances,
        cartItems,
        brands,
        allProducts: modifiedAllProducts,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Something went wrong",
    });
  } finally {
    connection.release();
  }
};

const searchFilterData = async (req, res) => {
  const pool = pools[req.tenantId];
  const { searchString } = req.query;

  try {
    if (!searchString) {
      return res.status(400).json({
        success: false,
        message: "Search string is required",
      });
    }

    const searchTerm = `%${searchString}%`;

    // 🔹 1. Get matching products
    const [products] = await pool.query(
      `SELECT * FROM products p
       WHERE p.product_name LIKE ?
       OR JSON_SEARCH(p.tags, 'one', ?) IS NOT NULL
       AND p.deleted_at IS NULL AND p.is_in_stock = TRUE AND p.is_active = TRUE AND p.is_deleted = FALSE
       ORDER BY p.created_at DESC
       LIMIT 100`, // Limit to prevent huge responses
      [searchTerm, `%${searchString}%`]
    );

    const total = products.length;

    if (total === 0) {
      return res.json({
        success: true,
        message: "Products not found",
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 1,
        data: [],
      });
    }

    const productIds = products.map((p) => p.id);

    // 🔹 2. Get related categories
    const [categories] = await pool.query(
      `SELECT pc.product_id, c.title 
       FROM product_categories pc
       JOIN categories c ON pc.category_id = c.id
       WHERE pc.product_id IN (?)`,
      [productIds]
    );

    // 🔹 3. Get variants
    const [variants] = await pool.query(
      `SELECT * FROM product_variants WHERE product_id IN (?)`,
      [productIds]
    );

    // 🔹 4. Build maps
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

    // 🔹 5. Format products like in getPaginatedProducts
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
      message: "Search filter applied successfully",
      total,
      page: 1,
      limit: 100,
      totalPages: 1,
      data: response,
    });
  } catch (err) {
    console.error("Error in searchFilterData:", err.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch products.",
    });
  }
};



export { getAppData, searchFilterData };
