import pool from "../db/index.js";

const getSlidersByPosition = async (position) => {
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

const getAppData = async (req, res) => {
  const client = await pool.getConnection();

  try {
    const sliderPositions = [
      "homepage_top",
      "homepage_middle",
      "homepage_bottom",
    ];
    const sliderPromises = sliderPositions.map((position) =>
      getSlidersByPosition(position)
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
        ORDER BY sort_order LIMIT 10
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

    const safe = (data) => {
      if (data === null) {
        console.log(data);
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
        featuredProducts: safe(featuredProducts),
        banner2: safe(bottomSlider),
        homeAppliances: safe(homeAppliances),
        banner3: safe(bottomSlider),
        bestDeals: safe(bestDealProducts),
        banner4: safe(bottomSlider),
        moreHomeAppliances: safe(homeAppliances),
        brands: safe(brands),
        allProducts: safe(allProducts),
      },
    });
  } catch (error) {
    console.error("Error in getAppData:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  } finally {
    client.release();
  }
};

export { getAppData };
