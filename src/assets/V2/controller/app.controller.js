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
    // Parse JSON fields only once
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

    // Attach categories from map
    const categoriesArray = categoriesMap.get(product.id) || [];

    // Attach variants from map
    const productVariants = variantsMap.get(product.id) || [];

    // Use first variant for some fields fallback
    const firstVariant = productVariants[0] || {};

    // attach thumbnail from first variant
    product.thumbnail = firstVariant.thumbnail;

    // Parse gallery_images for first variant
    if (firstVariant.gallery_images) {
      product.gallery_images =
        typeof firstVariant.gallery_images === "string"
          ? JSON.parse(firstVariant.gallery_images)
          : firstVariant.gallery_images;
    } else {
      product.gallery_images = [];
    }

    // Calculate final amount
    const price = parseFloat(firstVariant.selling_price) || 0;
    const tax = parseFloat(product.tax_percentage || 0);
    const discount = parseFloat(product.discount || 0);
    const total_price = price - discount + tax;

    // Map variants with extra fields
    const variants = productVariants.map((variant) => {
      const vPrice = parseFloat(variant.selling_price) || 0;
      const vIsInStock = variant.stock > 0 ? 1 : 0;

      return {
        ...variant,
        finalAmmount: total_price,
        is_in_stock: vIsInStock,
        gallery_images:
          typeof variant.gallery_images === "string"
            ? JSON.parse(variant.gallery_images)
            : variant.gallery_images || [],
      };
    });

    return {
      ...product,
      categories: categoriesArray,
      variants,
      finalAmmount: total_price,
    };
  });
};

const getAppData = async (req, res) => {
  const userId = req.userId;
  const tenantID = req.tenantId;
  const pool = pools[tenantID];
  const connection = await pool.getConnection();

  try {
    // Get customer_id if userId exists
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

    // Parallel fetch sliders, categories, products, brands
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

    // Run slider and main queries parallelly
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

    // Collect all unique product IDs for batch variant & category fetch
    const allProductLists = [
      bestDealProducts,
      homeAppliances,
      featuredProducts,
      allProducts,
    ];

    const productIdsSet = new Set();
    allProductLists.forEach((list) =>
      list.forEach((prod) => productIdsSet.add(prod.id))
    );
    const productIds = Array.from(productIdsSet);

    // Fetch all variants for these products in one query
    const [variantsRows] = await connection.query(
      `SELECT v.*, p.*
       FROM product_variants v
       JOIN products p ON v.product_id = p.id
       WHERE v.product_id IN (?)`,
      [productIds]
    );

    // Fetch categories for products in one query
    const [categoriesRows] = await connection.query(
      `SELECT c.title, pc.product_id
       FROM categories c
       JOIN product_categories pc ON c.id = pc.category_id
       WHERE pc.product_id IN (?)`,
      [productIds]
    );

    // Map variants by product_id
    const variantsMap = new Map();
    for (const variant of variantsRows) {
      if (!variantsMap.has(variant.product_id)) {
        variantsMap.set(variant.product_id, []);
      }
      variantsMap.get(variant.product_id).push(variant);
    }

    // Map categories by product_id
    const categoriesMap = new Map();
    for (const cat of categoriesRows) {
      if (!categoriesMap.has(cat.product_id)) {
        categoriesMap.set(cat.product_id, []);
      }
      categoriesMap.get(cat.product_id).push(cat.title);
    }

    // Modify products with variants & categories in-memory, no DB call inside loop
    const modifiedFeatured = modifyProductResponse(
      featuredProducts,
      variantsMap,
      categoriesMap
    );
    const modifiedBestDeals = modifyProductResponse(
      bestDealProducts,
      variantsMap,
      categoriesMap
    );
    const modifiedHomeAppliances = modifyProductResponse(
      homeAppliances,
      variantsMap,
      categoriesMap
    );
    const modifiedAllProducts = modifyProductResponse(
      allProducts,
      variantsMap,
      categoriesMap
    );

    // Get cart data if user logged in
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
      message: err.message,
    });
  } finally {
    connection.release();
  }
};

export { getAppData };
