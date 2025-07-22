import pools from "../db/index.js";

const getCartData = async (customer_id, tenantID) => {
  const pool = pools[tenantID];
  const connection = await pool.getConnection();

  try {
    const [result] = await connection.execute(
      `SELECT * FROM cart_items WHERE customer_id = ?`,
      [customer_id]
    );

    if (result.length === 0) {
      return {
        success: false,
        error: "Cart not found",
      };
    }

    // Map cart items to products
    const cartItems = await Promise.all(
      result.map(async (item) => {
        const [productRows] = await connection.execute(
          `SELECT * FROM products WHERE id = ?`,
          [item.product_id]
        );

        const product = productRows[0];

        return {
          id: product.id,
          product_name: product.product_name,
          thumbnail: product.thumbnail,
          short_description: product.short_description,
          stock_quantity: item.quantity,
          mrp: product.mrp,
          price_per_unit: item.price_per_unit,
          discount_per_unit: item.discount_per_unit,
          tax_per_unit: item.tax_per_unit,
          sku: item.sku,
          product_snapshot: item.product_snapshot,
          finalAmmount: product.selling_price,
        };
      })
    );

    return {
      success: true,
      cartItems,
    };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      error: "Internal server error",
    };
  } finally {
    connection.release();
  }
};

const getSlidersByPosition = async (position, tenantId) => {
  const pool = pools[tenantId];
  const client = await pool.getConnection();
  const [slider] = await client.query(
    `SELECT * FROM sliders WHERE position = ? AND status = 'active' AND is_visible = true ORDER BY sort_order LIMIT 1`,
    [position]
  );

  if (!slider.length) return [];

  const [items] = await client.query(
    `SELECT * FROM slider_items WHERE slider_id = ? AND is_active = true ORDER BY sort_order`,
    [slider[0].id]
  );

  return {
    ...slider[0],
    items,
  };
};

const modifyProductResponse = async (data, tenantId) => {
  const pool = pools[tenantId];
  const modifiedData = await Promise.all(
    data.map(async (product) => {
      const product_id = product.id;

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
      return {
        ...product,
        categories: categoriesArray,
        finalAmmount: product.selling_price,
      };
    })
  );

  return modifiedData;
};

const getAppData = async (req, res) => {
  const userId = req.userId;
  const tenantID = req.tenantId;
  const pool = pools[tenantID];
  const client = await pool.getConnection();
  let customer_id = null;
  if (userId) {
    customer_id = await client.query(`SELECT id FROM customers WHERE id = ?`, [
      userId,
    ]);

    if (!customer_id || customer_id.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }
  }

  try {
    const sliderPositions = [
      "homepage_top",
      "homepage_middle",
      "homepage_bottom",
    ];
    const sliderPromises = sliderPositions.map((position) =>
      getSlidersByPosition(position, tenantID)
    );

    const queryPromises = [
      client.execute(`
        SELECT * FROM products
        WHERE is_best_seller = true AND status = 'active'
        ORDER BY sort_order LIMIT 10
      `),

      client.execute(`
        SELECT * FROM categories
        WHERE status = 'active' AND parent_id IS NULL
        ORDER BY sort_order LIMIT 10
      `),

      client.execute(`
        SELECT * FROM products
        WHERE product_type = 'home_appliance' AND status = 'active'
        ORDER BY sort_order LIMIT 10
      `),

      client.execute(`
        SELECT * FROM products
        WHERE is_featured = true AND status = 'active'
        ORDER BY sort_order
      `),

      client.execute(`
        SELECT * FROM brands
        WHERE status = true
        ORDER BY sort_order
      `),

      client.execute(`
        SELECT * FROM products
        WHERE status = 'active'
        ORDER BY sort_order LIMIT 30
      `),
    ];

    const [topSlider, midSlider, bottomSlider] = await Promise.all(
      sliderPromises
    );

    const [
      [bestDealProducts],
      [allCategories],
      [homeAppliances],
      [featuredProducts],
      [brands],
      [allProducts],
    ] = await Promise.all(queryPromises);

    let cartData = [];
    if (userId) {
      cartData = await getCartData(customer_id[0][0].id, tenantID);

      if (!cartData.success) {
        return res.status(400).json({
          success: false,
          error: cartData.error,
        });
      }
    }

    const safe = (data) => {
      if (data === null) {
        return [];
      }

      return Array.isArray(data) || typeof data === "object" ? data : [];
    };

    return res.status(200).json({
      success: true,
      message: "App data fetched successfully",
      data: {
        topSlider: safe(topSlider),
        categories0: safe(allCategories),
        NewArrivalSlider: safe(midSlider),
        banner1: safe(bottomSlider),
        featuredProducts: await modifyProductResponse(
          featuredProducts,
          tenantID
        ),
        banner2: safe(bottomSlider),
        homeAppliances: await modifyProductResponse(homeAppliances, tenantID),
        banner3: safe(bottomSlider),
        bestDeals: await modifyProductResponse(bestDealProducts, tenantID),
        banner4: safe(bottomSlider),
        moreHomeAppliances: await modifyProductResponse(
          homeAppliances,
          tenantID
        ),
        brands: safe(brands),
        allProducts: await modifyProductResponse(allProducts, tenantID),
        cartData: cartData.cartItems,
      },
    });
  } catch (error) {
    console.error("Error in getAppData:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  } finally {
    client.release();
  }
};

export { getAppData };
