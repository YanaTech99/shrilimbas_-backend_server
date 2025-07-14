import pool from "../db/index.js";
import fs from "fs";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinary.util.js";

const addSlider = async (req, res) => {
  const { id: userId, user_type } = req.user;
  if (user_type !== "VENDOR") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Only vendors can add sliders.",
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

  const connection = await pool.getConnection();
  const imageFiles = req.files || [];
  let uploadedImages = [];

  try {
    const sliderData = req.body;
    const {
      name,
      position,
      type,
      autoplay,
      status,
      is_visible,
      start_date,
      end_date,
      sort_order,
      items = [],
    } = sliderData;

    if (!name || !position) {
      return res.status(400).json({
        success: false,
        message: "Name and position are required fields.",
      });
    }

    await connection.beginTransaction();

    // Insert into sliders table
    const [sliderResult] = await connection.execute(
      `INSERT INTO sliders
        (name, position, type, autoplay, status, is_visible, start_date, end_date, sort_order, shop_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        position,
        type || "single",
        autoplay || 0,
        status || "active",
        is_visible ?? 0,
        start_date || new Date(),
        end_date || null,
        sort_order || 0,
        shopId[0].id,
      ]
    );

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

      const imagePath = image.path;

      const cloudinaryResult = await uploadImageToCloudinary(imagePath);
      const image_url = cloudinaryResult.secure_url;
      uploadedImages.push(cloudinaryResult.public_id);

      await connection.execute(
        `INSERT INTO slider_items
            (slider_id, title, subtitle, image_url, link_type, link_reference_id, link_url, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sliderId,
          item.title || null,
          item.subtitle || null,
          image_url || null,
          item.link_type || "none",
          item.link_reference_id || null,
          item.link_url || null,
          item.sort_order || 0,
          item.is_active ?? true,
        ]
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Slider added successfully.",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Add slider error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to add slider.",
      error: err.message,
    });
  } finally {
    imageFiles.forEach((file, index) => {
      fs.unlinkSync(file.path); // Delete the uploaded image file
      deleteFromCloudinary(uploadedImages[index]); // Delete from Cloudinary
    });
    connection.release();
  }
};

const deleteSlider = async (req, res) => {
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

  const client = await pool.getConnection();

  try {
    const { sliderId } = req.body;
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

export { addSlider, deleteSlider };
