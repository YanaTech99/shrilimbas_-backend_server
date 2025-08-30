import pools from "../../db/index.js";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../../utils/cloudinary.util.js";
import { removeLocalFiles } from "../../helper/removeLocalFiles.js";
import { getPublicIdFromUrl } from "../../utils/extractPublicID.util.js";
import { defaultProfileUrl, delivery_boyFolder } from "../../../constants.js";

const updateProfile = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id } = req.user;

  const files = req.files || {}; // Expect multiple files from multer
  const client = await pool.getConnection();

  try {
    const [rows] = await pool.query(
      `SELECT * FROM delivery_boys WHERE user_id = ? LIMIT 1`,
      [user_id]
    );

    if (!rows || rows.length === 0) {
      removeLocalFiles(Object.values(files).flat());
      return res.status(404).json({
        success: false,
        error: "Delivery boy not found",
      });
    }

    const deliveryBoy = rows[0];

    if (
      (!req.body || Object.keys(req.body).length === 0) &&
      Object.keys(files).length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: "No data provided",
      });
    }

    // Valid fields for DB update
    const validFields = [
      "name",
      "email",
      "gender",
      "date_of_birth",
      "alternate_phone",
      "address",
      "city",
      "state",
      "country",
      "postal_code",
      "latitude",
      "longitude",
      "vehicle_type",
      "vehicle_number",
      "vehicle_model",
      "vehicle_color",
      "vehicle_insurance_number",
      "vehicle_insurance_validity",
      "driving_license_number",
      "driving_license_expiry",
      "bank_account_holder_name",
      "bank_account_number",
      "bank_name",
      "bank_branch",
      "bank_ifsc_code",
      "notes",
      "is_active",
    ];

    const updateQuery = [];
    const updateValues = [];

    // push valid fields from body
    for (const [key, value] of Object.entries(req.body)) {
      if (validFields.includes(key)) {
        if (key === "is_active") {
          updateQuery.push(`${key} = ?`);
          updateValues.push(parseInt(value));
        } else {
          updateQuery.push(`${key} = ?`);
          updateValues.push(value);
        }
      }
    }

    // Cloudinary uploads for multiple image fields
    const imageFields = {
      profile_image_url: files.profile_image?.[0],
      photo_id: files.photo_id?.[0],
      license: files.license?.[0],
      vehicle_rc: files.vehicle_rc?.[0],
    };

    const uploadedImages = [];

    for (const [field, file] of Object.entries(imageFields)) {
      if (file && file.path) {
        // Delete old image if exists
        if (deliveryBoy[field] && deliveryBoy[field] !== defaultProfileUrl) {
          const parts = deliveryBoy[field].split("/");
          const oldPublicId =
            parts[parts.length - 4] +
            "/" +
            parts[parts.length - 3] +
            "/" +
            parts[parts.length - 2] +
            "/" +
            parts[parts.length - 1].split(".")[0];
          console.log(oldPublicId);
          await deleteFromCloudinary(oldPublicId);
        }

        const { secure_url, public_id } = await uploadImageToCloudinary(
          file.path,
          tenantId,
          delivery_boyFolder[file.fieldname]
        );

        uploadedImages.push(public_id);

        updateQuery.push(`${field} = ?`);
        updateValues.push(secure_url);
      }
    }

    if (updateQuery.length === 0) {
      removeLocalFiles(Object.values(files).flat());
      return res.status(400).json({
        success: false,
        error: "No valid fields provided for update",
      });
    }

    updateValues.push(deliveryBoy.id); // for WHERE clause

    await client.beginTransaction();

    const [result] = await client.query(
      `UPDATE delivery_boys SET ${updateQuery.join(", ")} WHERE id = ?`,
      updateValues
    );

    if (result.affectedRows === 0) {
      await client.rollback();
      // Clean up uploaded images if rollback
      for (const img of uploadedImages) {
        await deleteFromCloudinary(img);
      }
      return res.status(500).json({
        success: false,
        error: "Failed to update profile",
      });
    }

    await client.commit();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error(error);
    await client.rollback();

    for (const img of uploadedImages) {
      await deleteFromCloudinary(img);
    }

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    removeLocalFiles(Object.values(files).flat());
    client.release();
  }
};

const getOrders = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [deliveryBoy] = await pool.query(
    `SELECT * FROM delivery_boys WHERE user_id = ?`,
    [user_id]
  );

  if (!deliveryBoy || deliveryBoy.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Delivery boy not found",
    });
  }

  try {
    if (deliveryBoy[0].is_active === 0) {
      return res.status(400).json({
        success: false,
        error: "You are offline",
      });
    }

    // join user data to orders
    const [orders] = await pool.query(
      `SELECT 
      orders.id,
      orders.order_number,
      orders.order_date,
      orders.delivery_window,
      orders.delivery_address,
      orders.delivery_city,
      orders.delivery_state,
      orders.delivery_country,
      orders.delivery_postal_code,
      orders.delivery_latitude,
      orders.delivery_longitude,
      orders.delivery_instructions,
      orders.payment_method,
      orders.payment_status,
      orders.total_amount,
      orders.notes,
      users.id AS customer_id,
      users.phone AS customer_phone,
      customers.name AS customer_name,
      customers.alternate_phone AS customer_alternate_phone
      FROM orders
      JOIN users ON orders.user_id = users.id
      JOIN customers ON customers.user_id = users.id
      WHERE orders.delivery_boy_id IS NULL;
      `
    );

    const totalOrders = orders.length;

    if (orders.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Currently no orders found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Orders fetched successfully",
      totalOrders,
      orders,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

const acceptOrder = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const { order_id } = req.body;

  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const [rows] = await connection.query(
      `
      SELECT 
        db.id AS delivery_boy_id, db.is_active, db.status,
        o.id AS order_id, o.total_amount, o.delivery_address, o.delivery_city,
        o.delivery_state, o.delivery_country, o.delivery_postal_code,
        o.delivery_latitude, o.delivery_longitude
      FROM delivery_boys db
      JOIN users u ON u.id = db.user_id
      JOIN orders o ON o.id = ? AND o.delivery_boy_id IS NULL
      WHERE u.id = ?
      `,
      [order_id, user_id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: "Delivery boy or order not found",
      });
    }

    const deliveryBoy = rows[0];
    if (deliveryBoy.is_active === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: "You are offline" });
    }

    await connection.query(
      `
      UPDATE orders o
      JOIN delivery_boys db ON db.id = ?
      SET o.delivery_boy_id = ?, db.status = 'ON_DELIVERY'
      WHERE o.id = ? AND o.delivery_boy_id IS NULL
      `,
      [deliveryBoy.delivery_boy_id, deliveryBoy.delivery_boy_id, order_id]
    );

    const [db_account] = await connection.query(
      `
      INSERT INTO db_account (
        delivery_boy_id, order_id, order_status, accept_time, total_amount,
        delivery_address, delivery_city, delivery_state, delivery_country,
        delivery_postal_code, delivery_latitude, delivery_longitude,
        created_at, updated_at
      )
      SELECT
        ?, ?, 'pending', NOW(), o.total_amount,
        o.delivery_address, o.delivery_city, o.delivery_state, o.delivery_country,
        o.delivery_postal_code, o.delivery_latitude, o.delivery_longitude,
        NOW(), NOW() FROM orders o WHERE o.id = ?
      `,
      [deliveryBoy.delivery_boy_id, order_id, order_id]
    );

    if (db_account.affectedRows === 0) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error: "Error accepting order",
      });
    }

    await connection.commit();
    return res
      .status(200)
      .json({ success: true, message: "Order accepted successfully" });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  } finally {
    connection.release();
  }
};

const completeOrder = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const { order_id } = req.body;

  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const [rows] = await connection.query(
      `
      SELECT db.id AS delivery_boy_id, db.is_active, o.total_amount
      FROM delivery_boys db
      JOIN users u ON u.id = db.user_id
      JOIN orders o ON o.id = ? AND o.delivery_boy_id = db.id
      WHERE u.id = ?
      `,
      [order_id, user_id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: "Order not found or not assigned to you",
      });
    }

    const deliveryBoyId = rows[0].delivery_boy_id;
    const orderAmount = rows[0].total_amount;

    if (rows[0].is_active === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: "You are offline" });
    }

    await connection.query(
      `
      UPDATE orders o
      JOIN db_account dba ON dba.order_id = o.id
      SET 
        o.order_status = 'delivered',
        o.delivery_date = NOW(),
        dba.order_status = 'completed',
        dba.delivery_date = NOW(),
        dba.delivery_time = NOW()
      WHERE o.id = ? AND o.delivery_boy_id = ?
      `,
      [order_id, deliveryBoyId]
    );

    await connection.query(
      `
      UPDATE delivery_boys
      SET status = 'AVAILABLE',
          total_deliveries = total_deliveries + 1
      WHERE id = ?
      `,
      [deliveryBoyId]
    );

    await connection.commit();
    return res
      .status(200)
      .json({ success: true, message: "Order completed successfully" });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  } finally {
    connection.release();
  }
};

const getEarnings = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;

  const [deliveryBoy] = await pool.query(
    `SELECT id, total_earnings, total_deliveries FROM delivery_boys WHERE user_id = ?`,
    [user_id]
  );

  if (!deliveryBoy || deliveryBoy.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Delivery boy not found",
    });
  }

  const [earnings] = await pool.query(
    `SELECT * FROM db_account WHERE delivery_boy_id = ?`,
    [deliveryBoy[0].id]
  );

  if (!earnings || earnings.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Earnings not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Earnings fetched successfully",
    total_orders: earnings.length,
    data: earnings,
    total_earnings: deliveryBoy[0].total_earnings,
    total_deliveries: deliveryBoy[0].total_deliveries,
  });
};

const getProfile = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;

  const [deliveryBoy] = await pool.query(
    `SELECT * FROM delivery_boys WHERE user_id = ?`,
    [user_id]
  );

  if (!deliveryBoy || deliveryBoy.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Delivery boy not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Profile fetched successfully",
    data: deliveryBoy[0],
  });
};

const getActiveOrders = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;

  const [deliveryBoy] = await pool.query(
    `SELECT * FROM delivery_boys WHERE user_id = ?`,
    [user_id]
  );

  if (!deliveryBoy || deliveryBoy.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Delivery boy not found",
    });
  }

  const [orders] = await pool.query(
    `SELECT * FROM orders WHERE delivery_boy_id = ?`,
    [deliveryBoy[0].id]
  );

  if (!orders || orders.length === 0) {
    return res.status(200).json({
      success: true,
      message: "No active orders found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Orders fetched successfully",
    data: orders,
  });
};

export {
  updateProfile,
  getOrders,
  acceptOrder,
  completeOrder,
  getEarnings,
  getProfile,
  getActiveOrders,
};
