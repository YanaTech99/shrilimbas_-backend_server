import pool from "../db/index.js";
import { generateAccessToken } from "../utils/jwt.util.js";

const loginViaPhone = async (req, res) => {
  const { phone_number, user_type } = req.body;

  if (!phone_number) {
    return res.status(400).json({
      success: false,
      error: "Phone number is required",
    });
  }

  if (!user_type) {
    return res.status(400).json({
      success: false,
      error: "User type is required",
    });
  }

  const validUserTypes = ["CUSTOMER", "VENDOR", "DELIVERY_BOY"];
  if (!validUserTypes.includes(user_type)) {
    return res.status(400).json({
      success: false,
      error: "Invalid user type",
    });
  }

  const client = await pool.getConnection();

  try {
    await client.beginTransaction();

    const [userRows] = await client.execute(
      "SELECT * FROM users WHERE phone = ?",
      [phone_number]
    );

    let user;
    let message = "";

    if (!userRows || userRows.length === 0) {
      // Create new user
      const [insertResult] = await client.execute(
        `INSERT INTO users (phone, user_type, full_name, is_active) VALUES (?, ?, 'Guest', 1)`,
        [phone_number, user_type]
      );

      const [newUserRows] = await client.execute(
        `SELECT * FROM users WHERE phone = ?`,
        [phone_number]
      );

      // insert into resepective profile table based on user type
      let profileTable = "customers";
      if (user_type === "VENDOR") {
        profileTable = "shops";
      } else if (user_type === "DELIVERY_BOY") {
        profileTable = "delivery_boys";
      }

      const [profileInsertResult] = await client.execute(
        `INSERT INTO ${profileTable} (user_id, name, email) VALUES (?, 'Guest', 'example@example.com')`,
        [newUserRows[0].id]
      );

      user = newUserRows[0];
      message = "Welcome new user";
    } else {
      user = userRows[0];
      message = "Welcome back user";
    }

    // Generate JWT (assumes you have this function available)
    const token = generateAccessToken({
      id: user.id,
      phone: user.phone,
      user_type: user.user_type,
    });

    await client.commit();

    return res.status(200).json({
      success: true,
      message,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        full_name: user.full_name,
      },
    });
  } catch (err) {
    await client.rollback();
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
};

export { loginViaPhone };
