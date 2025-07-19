import pools from "../db/index.js";
import fs from "fs";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinary.util.js";
import { sanitizeInput } from "../utils/validation.util.js";

const addSlider = async (req, res) => {
  const pool = pools[req.tenantId];
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

    //delete from cloudinary
    uploadedImages.forEach((image) => {
      deleteFromCloudinary(image);
    });

    console.error("Add slider error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to add slider.",
      error: err.message,
    });
  } finally {
    imageFiles.forEach((file, index) => {
      if (file.path) {
        fs.unlinkSync(file.path); // Delete the uploaded image file
      }
    });
    connection.release();
  }
};

const deleteSlider = async (req, res) => {
  const pool = pools[req.tenantId];
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

    sliderImages.forEach((image) => {
      const publicId = image.image_url.split("/").pop().split(".")[0];
      deleteFromCloudinary(publicId);
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

  const modifiedInput = sanitizeInput(req.query);
  const filters = modifiedInput;

  const { position, type, scheduled_only, is_active } = filters;

  const whereClause = [];

  if (position) {
    whereClause.push(`position = '${position}'`);
  }

  if (type) {
    whereClause.push(`type = '${type}'`);
  }

  if (scheduled_only) {
    whereClause.push(`scheduled_only = '${scheduled_only}'`);
  }

  if (is_active) {
    whereClause.push(`is_active = '${is_active}'`);
  }

  if (whereClause.length > 0) {
    whereClause.push(`shop_id = '${shop_id[0].id}'`);
  }

  if (whereClause.length > 0) {
    const whereClauseString = whereClause.join(" AND ");
    const [result] = await pool.query(
      `SELECT * FROM sliders WHERE ${whereClauseString}`
    );
    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Slider not found",
      });
    } else {
      return res.status(200).json({
        success: true,
        message: "Slider retrieved successfully",
        data: result,
      });
    }
  }
};

const updateSlider = async (req, res) => {
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

  const modifiedInput = sanitizeInput(req.body);
  const {
    sliderId,
    name,
    position,
    type,
    autoplay,
    status,
    is_visible,
    start_date,
    end_date,
    items = [],
  } = modifiedInput;

  const [slider] = await pool.query(
    `SELECT * FROM sliders WHERE id = ? AND shop_id = ?`,
    [sliderId, shopId[0].id]
  );

  if (!slider.length) {
    return res.status(404).json({
      success: false,
      message: "Slider not found.",
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
    if (status) updateClause.push(`status = '${status}'`);
    if (is_visible) updateClause.push(`is_visible = '${is_visible}'`);
    if (start_date) updateClause.push(`start_date = '${start_date}'`);
    if (end_date) updateClause.push(`end_date = '${end_date}'`);

    if (updateClause.length > 0) {
      const updateClauseString = updateClause.join(", ");
      const [result] = await client.query(
        `UPDATE sliders SET ${updateClauseString} WHERE id = ? AND shop_id = ?`,
        [sliderId, shopId[0].id]
      );

      if (result.affectedRows === 0) {
        client.rollback();
        return res.status(404).json({
          success: false,
          message: "Failed to update slider.",
        });
      }
    }

    let itemsArray = [];

    if (items) {
      itemsArray = typeof items === "string" ? JSON.parse(items) : items;
    }

    if (items.length > 0) {
      items.forEach(async (item) => {
        const {
          id,
          title,
          subtitle,
          link_type,
          link_url,
          is_active,
          link_reference_id,
        } = item;

        const [sliderItems] = await client.query(
          `SELECT id FROM slider_items WHERE id = ? AND slider_id = ?`,
          [id, sliderId]
        );

        if (!sliderItems || sliderItems.length === 0) {
          await client.rollback();
          return res.status(404).json({
            success: false,
            message: "Slider item not found.",
          });
        }

        const updateClause = [];

        if (title) updateClause.push(`title = '${title}'`);
        if (subtitle) updateClause.push(`subtitle = '${subtitle}'`);
        if (link_type) updateClause.push(`link_type = '${link_type}'`);
        if (link_url) updateClause.push(`link_url = '${link_url}'`);
        if (is_active) updateClause.push(`is_active = '${is_active}'`);
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
              message: "Failed to update slider item.",
            });
          }
        }
      });
    }

    client.commit();

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
    client.release();
  }
};

export { addSlider, deleteSlider, getSlider, updateSlider };
