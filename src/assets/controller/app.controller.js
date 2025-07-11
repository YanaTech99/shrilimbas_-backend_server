import pool from "../db/index.js";

const getSlidersByPosition = async (position) => {
  const client = await pool.getConnection();
  const [slider] = await client.query(
    `SELECT * FROM sliders WHERE position = ? AND status = 'active' AND is_visible = true ORDER BY sort_order LIMIT 1`,
    [position]
  );

  if (!slider.length) return null;

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
        SELECT * FROM sliders 
        WHERE position LIKE 'homepage%' AND status = 'active' AND is_visible = true 
        ORDER BY sort_order
      `),

      client.execute(`
        SELECT * FROM products
        WHERE is_best_seller = true AND status = 'active'
        ORDER BY sort_order LIMIT 10
      `),

      client.execute(`
        SELECT * FROM categories
        WHERE status = 'active' AND parent_id IS NULL
        ORDER BY sort_order
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
      [slidersHomepage],
      [bestDealProducts],
      [allCategories],
      [homeAppliances],
      [featuredProducts],
      [brands],
      [allProducts],
    ] = await Promise.all(queryPromises);

    const safe = (data) => (Array.isArray(data) ? data : []);

    return res.status(200).json({
      success: true,
      message: "App data fetched successfully",
      data: {
        topSlider: safe(topSlider),
        middleSlider: safe(midSlider),
        banner1: safe(bottomSlider),
        slidersHomepage: safe(slidersHomepage),
        featuredProducts: safe(featuredProducts),
        categories: safe(allCategories),
        categoriesAgain: safe(allCategories),
        homeAppliances: safe(homeAppliances),
        sliderHomeAppliances: safe(midSlider),
        bestDeals: safe(bestDealProducts),
        banner2: safe(bottomSlider),
        banner3: safe(bottomSlider),
        moreHomeAppliances: safe(homeAppliances),
        brands: safe(brands),
        categoriesFinal: safe(allCategories),
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
