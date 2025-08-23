import pools from "../../db/index.js";
import { removeLocalFiles } from "../../helper/removeLocalFiles.js";
import { logoImageFolder } from "../../../constants.js";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../../utils/cloudinary.util.js";

const updateSettings = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id, user_type } = req.user;
  const logoImage = req.file;

  if (user_type !== "ADMIN") {
    removeLocalFiles(logoImage);
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only admin can update settings.",
    });
  }

  const allowedFields = [
    `app_name`,
    `owner_name`,
    `phone`,
    `email`,
    `address`,
    `facebook_link`,
    `instagram_link`,
    `youtube_link`,
    `app_status`,
    `allowed_image_size`,
    `mailjet_api_key`,
    `mailjet_secret_key`,
    `mailjet_sender_email`,
    `mailjet_sender_name`,
    `razorpay_key_id`,
    `razorpay_key_secret`,
  ];

  const settings = req.body;
  const insertColumns = [];
  const insertValues = [];
  let uploadedImage = null;

  try {
    for (const field of allowedFields) {
      if (field in settings) {
        insertColumns.push(field);
        insertValues.push(settings[field]);
      }
    }

    if (logoImage) {
      const { public_id, secure_url } = await uploadImageToCloudinary(
        logoImage.path,
        tenantId,
        logoImageFolder
      );
      uploadedImage = public_id;
      insertColumns.push(`logo_url`);
      insertValues.push(secure_url);
    }

    if (insertColumns.length > 0) {
      // Generate placeholders
      const placeholders = insertColumns.map(() => "?").join(", ");
      // Generate ON DUPLICATE KEY UPDATE part
      const updatePlaceholders = insertColumns
        .map((col) => `${col} = VALUES(${col})`)
        .join(", ");

      const query = `
        INSERT INTO app_settings (user_id, ${insertColumns.join(", ")})
        VALUES (?, ${placeholders})
        ON DUPLICATE KEY UPDATE ${updatePlaceholders}
      `;

      const [result] = await pool.query(query, [user_id, ...insertValues]);

      if (result.affectedRows === 0) {
        throw new Error("Failed to update settings");
      }
    }

    return res.json({
      success: true,
      message: "Settings updated successfully",
    });
  } catch (error) {
    if (uploadedImage) {
      await deleteFromCloudinary(uploadedImage);
    }
    console.error("Error updating settings:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to update settings" });
  } finally {
    removeLocalFiles(logoImage);
  }
};

const getSettings = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id, user_type } = req.user;
  const [settings] = await pool.query(
    `SELECT * FROM app_settings WHERE user_id = ?`,
    [user_id]
  );
  if (settings.length === 0) {
    return res
      .status(404)
      .json({ success: false, error: "Settings not found." });
  }
  return res.status(200).json({ success: true, data: settings[0] });
};

export { updateSettings, getSettings };
