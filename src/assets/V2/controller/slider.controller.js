import pools from "../../db/index.js";
import fs from "fs";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../../utils/cloudinary.util.js";
import { sanitizeInput } from "../../utils/validation.util.js";
import { bannerImageFolder } from "../../../constants.js";
import { getPublicIdFromUrl } from "../../utils/extractPublicID.util.js";
import { removeLocalFiles } from "../../helper/removeLocalFiles.js";
import { error } from "console";

const addSlider = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: userId, user_type } = req.user;
  const imageFiles = req.files || [];

  if (user_type !== "VENDOR") {
    removeLocalFiles(imageFiles);
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can add sliders.",
    });
  }

  const [shopId] = await pool.query(`SELECT id FROM shops WHERE user_id = ?`, [
    userId,
  ]);
  if (!shopId || !shopId[0]) {
    removeLocalFiles(imageFiles);
    return res.status(404).json({
      success: false,
      error: "Shop not found for this vendor.",
    });
  }

  const connection = await pool.getConnection();
  let uploadedImages = [];

  try {
    const sliderData =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      name,
      position,
      autoplay,
      is_active = 1,
      start_date,
      end_date,
      items = [],
    } = sliderData;

    const type = JSON.parse(items).length > 1 ? "carousel" : "single";

    if (!name || !position) {
      return res.status(400).json({
        success: false,
        error: "Name and position are required fields.",
      });
    }

    await connection.beginTransaction();

    // get max sort order for the slider
    const [sortOrder] = await connection.execute(
      "SELECT IFNULL(MAX(sort_order), 0) + 1 AS sort_order FROM sliders WHERE shop_id = ?",
      [shopId[0].id]
    );

    // Insert into sliders table
    const [sliderResult] = await connection.execute(
      `INSERT INTO sliders
        (name, position, type, autoplay, is_active, start_date, end_date, sort_order, shop_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        position,
        type || "single",
        autoplay || 0,
        is_active,
        start_date || new Date(),
        end_date || null,
        sortOrder[0].sort_order || 1,
        shopId[0].id,
      ]
    );

    if (!sliderResult || !sliderResult.insertId) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to add slider.",
      });
    }

    const sliderId = sliderResult.insertId;

    // check if items is an array or a JSON string
    let itemArray = [];

    if (!Array.isArray(items)) {
      itemArray = JSON.parse(items);
    } else {
      itemArray = items;
    }

    // Insert slider items
    for (let i = 0; i < itemArray.length; i++) {
      const item = itemArray[i];
      const image = imageFiles[i];
      if (!image) {
        await connection.rollback();
        throw new Error(`Image file for item ${i + 1} is required.`);
      }

      if (!item.title) {
        await connection.rollback();
        throw new Error(`Title for item ${i + 1} is required.`);
      }

      const imagePath = image.path;

      const cloudinaryResult = await uploadImageToCloudinary(
        imagePath,
        tenantId,
        bannerImageFolder
      );
      const image_url = cloudinaryResult.secure_url;
      uploadedImages.push(cloudinaryResult.public_id);

      // max of sort order for slider items
      const [sortOrder] = await connection.execute(
        "SELECT IFNULL(MAX(sort_order), 0) + 1 AS sort_order FROM slider_items WHERE slider_id = ?",
        [sliderId]
      );

      const [sliderItemResult] = await connection.execute(
        `INSERT INTO slider_items
            (slider_id, title, subtitle, image_url, link_type, link_reference_id, link_url, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sliderId,
          item.title,
          item.subtitle || null,
          image_url || null,
          item.link_type || "none",
          item.link_reference_id || null,
          item.link_url || null,
          sortOrder[0].sort_order || 1,
          item.is_active || 1,
        ]
      );

      if (!sliderItemResult.affectedRows) {
        throw new Error("Failed to add slider item.");
      }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Slider added successfully.",
    });
  } catch (err) {
    await connection.rollback();

    //delete from cloudinary
    uploadedImages.forEach((image) => {
      deleteFromCloudinary(image);
    });

    console.error("Add slider error:", err.message);
    return res.status(500).json({
      success: false,
      error: "Failed to add slider.",
    });
  } finally {
    removeLocalFiles(imageFiles);
    connection.release();
  }
};

const deleteSlider = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: userId, user_type } = req.user;
  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can delete sliders.",
    });
  }

  const [shopId] = await pool.query(`SELECT id FROM shops WHERE user_id = ?`, [
    userId,
  ]);
  if (!shopId || !shopId[0]) {
    return res.status(404).json({
      success: false,
      message: "Shop not found for this vendor.",
    });
  }

  const modifiedInput = sanitizeInput(req.body);

  const { sliderId } = modifiedInput;

  const [sliderImages] = await pool.query(
    `SELECT image_url FROM slider_items WHERE slider_id = ?`,
    [sliderId]
  );

  const client = await pool.getConnection();

  try {
    const [result] = await client.query(
      `DELETE FROM sliders WHERE id = ? AND shop_id = ?`,
      [sliderId, shopId[0].id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Slider not found.",
      });
    }

    sliderImages.forEach(async (image) => {
      const publicId = getPublicIdFromUrl(image.image_url);
      await deleteFromCloudinary(publicId);
    });

    return res.status(200).json({
      success: true,
      message: "Slider deleted successfully.",
    });
  } catch (err) {
    console.error("Delete slider error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to delete slider.",
      error: err.message,
    });
  } finally {
    client.release();
  }
};

const getSlider = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;
  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can add sliders.",
    });
  }

  const [shopId] = await pool.query(`SELECT id FROM shops WHERE user_id = ?`, [
    user_id,
  ]);
  if (!shopId || !shopId[0]) {
    return res.status(404).json({
      success: false,
      message: "Shop not found for this vendor.",
    });
  }

  const modifiedInput =
    Object.entries(req.query).length !== 0 ? sanitizeInput(req.query) : {};
  const filters = modifiedInput;

  const { position, type, status, search, limit = 10, page = 1 } = filters;

  const validPositions = [
    "homepage_top",
    "homepage_middle",
    "homepage_bottom",
    "category_top",
    "category_sidebar",
    "product_page_top",
    "cart_page",
    "checkout_page",
    "popup",
    "offer_zone",
    "search_page",
    "global_footer",
  ];

  if (position && validPositions.includes(position) === false) {
    return res.status(400).json({
      success: false,
      message: "Invalid position.",
    });
  }

  const whereClause = [];

  if (position) {
    whereClause.push(`position = '${position}'`);
  }

  if (type) {
    whereClause.push(`type = '${type}'`);
  }

  if (status) {
    whereClause.push(`is_active = '${status === "active" ? 1 : 0}'`);
  }

  if (search) {
    whereClause.push(`name LIKE '%${search}%'`);
  }

  whereClause.push(`shop_id = '${shopId[0].id}'`);

  const whereClauseString = whereClause.join(" AND ");

  // count total results
  const [countResult] = await pool.query(
    `SELECT COUNT(*) AS total FROM sliders WHERE ${whereClauseString}`
  );
  const total = countResult[0].total;
  const totalPages = Math.ceil(total / limit);

  const offset = (page - 1) * limit;
  const [sliders] = await pool.query(
    `SELECT * FROM sliders WHERE ${whereClauseString} ORDER BY sort_order LIMIT ${limit} OFFSET ${offset}`
  );

  if (sliders.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Slider not found",
    });
  }

  // get slider items and add with slider
  const sliderIds = sliders.map((slider) => slider.id);
  const [result] = await pool.query(
    `SELECT * FROM slider_items WHERE slider_id IN (?) AND is_active = true ORDER BY sort_order`,
    [sliderIds]
  );

  for (let i = 0; i < sliders.length; i++) {
    sliders[i].items = result.filter(
      (item) => item.slider_id === sliders[i].id
    );
  }

  if (result.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Sliders not found",
    });
  } else {
    return res.status(200).json({
      success: true,
      message: "Sliders fetched successfully",
      data: sliders,
      pagination: {
        total,
        limit,
        page,
        totalPages,
      },
    });
  }
};

const updateSlider = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;
  const imageFiles = req.files || [];

  if (user_type !== "VENDOR") {
    removeLocalFiles(imageFiles);
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only vendors can add sliders.",
    });
  }

  const [shopId] = await pool.query(`SELECT id FROM shops WHERE user_id = ?`, [
    user_id,
  ]);
  if (!shopId || !shopId[0]) {
    removeLocalFiles(imageFiles);
    return res.status(404).json({
      success: false,
      error: "Shop not found for this vendor.",
    });
  }

  req.body.items =
    typeof req.body.items === "string"
      ? JSON.parse(req.body.items)
      : req.body.items;
  const modifiedInput = sanitizeInput(req.body);
  const {
    id: sliderId,
    name,
    position,
    type,
    autoplay,
    is_active,
    start_date,
    end_date,
    items = [],
  } = modifiedInput;

  const uploadedImages = [];
  const oldImages = [];

  const [slider] = await pool.query(
    `SELECT * FROM sliders WHERE id = ? AND shop_id = ?`,
    [sliderId, shopId[0].id]
  );

  if (!slider.length) {
    removeLocalFiles(imageFiles);
    return res.status(404).json({
      success: false,
      error: "Slider not found.",
    });
  }

  const client = await pool.getConnection();

  try {
    client.beginTransaction();

    const updateClause = [];
    if (name) updateClause.push(`name = '${name}'`);
    if (position) updateClause.push(`position = '${position}'`);
    if (type) updateClause.push(`type = '${type}'`);
    if (autoplay) updateClause.push(`autoplay = '${autoplay}'`);
    if (is_active) updateClause.push(`is_active = '${is_active}'`);
    if (start_date) updateClause.push(`start_date = '${start_date}'`);
    if (end_date) updateClause.push(`end_date = '${end_date}'`);

    if (updateClause.length > 0) {
      const updateClauseString = updateClause.join(", ");
      const [result] = await client.query(
        `UPDATE sliders SET ${updateClauseString} WHERE id = ? AND shop_id = ?`,
        [sliderId, shopId[0].id]
      );

      if (result.affectedRows === 0) {
        await client.rollback();
        return res.status(404).json({
          success: false,
          error: "Failed to update slider.",
        });
      }
    }

    let itemsArray = [];
    if (items) {
      itemsArray = typeof items === "string" ? JSON.parse(items) : items;
    }

    if (itemsArray.length > 0) {
      for (let index = 0; index < itemsArray.length; index++) {
        const {
          id,
          title,
          subtitle,
          link_type,
          link_url,
          is_active,
          link_reference_id,
        } = itemsArray[index];

        const image = imageFiles.find(
          (file) => file.fieldname === `slider_image_${index + 1}`
        );

        if (id) {
          // Existing item -> UPDATE
          const [sliderItems] = await client.query(
            `SELECT id, image_url FROM slider_items WHERE id = ? AND slider_id = ?`,
            [id, sliderId]
          );

          if (!sliderItems || sliderItems.length === 0) {
            await client.rollback();
            return res.status(404).json({
              success: false,
              error: "Slider item not found.",
            });
          }

          const updateClause = [];
          if (image) oldImages.push(sliderItems[0].image_url);

          if (title) updateClause.push(`title = '${title}'`);
          if (subtitle) updateClause.push(`subtitle = '${subtitle}'`);
          if (link_type) updateClause.push(`link_type = '${link_type}'`);
          if (link_url) updateClause.push(`link_url = '${link_url}'`);
          if (is_active !== undefined)
            updateClause.push(`is_active = '${is_active}'`);
          if (link_reference_id)
            updateClause.push(`link_reference_id = '${link_reference_id}'`);

          if (updateClause.length > 0) {
            const updateClauseString = updateClause.join(", ");
            const [result] = await client.query(
              `UPDATE slider_items SET ${updateClauseString} WHERE id = ? AND slider_id = ?`,
              [id, sliderId]
            );

            if (result.affectedRows === 0) {
              await client.rollback();
              return res.status(404).json({
                success: false,
                error: "Failed to update slider item.",
              });
            }
          }

          if (image) {
            const cloudinaryResult = await uploadImageToCloudinary(
              image.path,
              tenantId,
              bannerImageFolder
            );
            const image_url = cloudinaryResult.secure_url;
            uploadedImages.push(cloudinaryResult.public_id);

            if (image_url) {
              await client.query(
                `UPDATE slider_items SET image_url = ? WHERE id = ? AND slider_id = ?`,
                [image_url, id, sliderId]
              );
            }
          }
        } else {
          // New item -> INSERT
          let image_url = null;
          if (image) {
            const cloudinaryResult = await uploadImageToCloudinary(
              image.path,
              tenantId,
              bannerImageFolder
            );
            image_url = cloudinaryResult.secure_url;
            uploadedImages.push(cloudinaryResult.public_id);
          }

          const [insertResult] = await client.query(
            `INSERT INTO slider_items 
        (slider_id, title, subtitle, link_type, link_url, is_active, link_reference_id, image_url) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              sliderId,
              title || "",
              subtitle || "",
              link_type || "none",
              link_url || "",
              is_active !== undefined ? is_active : 1,
              link_reference_id || null,
              image_url,
            ]
          );

          if (insertResult.affectedRows === 0) {
            await client.rollback();
            return res.status(500).json({
              success: false,
              error: `Failed to add new banner ${index}.`,
            });
          }

          await client.query(
            `UPDATE sliders SET type = 'carousel' WHERE id = ?`,
            [sliderId]
          );
        }
      }
    }

    oldImages.forEach(async (image) => {
      const public_id = getPublicIdFromUrl(image);
      console.log(public_id);
      await deleteFromCloudinary(public_id, tenantId);
    });

    await client.commit();

    return res.status(200).json({
      success: true,
      message: "Slider updated successfully.",
    });
  } catch (error) {
    await client.rollback();
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to update slider.",
    });
  } finally {
    removeLocalFiles(imageFiles);
    client.release();
  }
};

export { addSlider, deleteSlider, getSlider, updateSlider };
