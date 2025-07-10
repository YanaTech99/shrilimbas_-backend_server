// import pool from '../db'
import { generateAccessToken } from "../utils/jwt.util.js";

const loginViaPhone = async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({
      success: false,
      error: "Phone number is required",
    });
  }

  try {
    const userQuery = await pool.query("SELECT * FROM users WHERE phone = $1", [
      phone_number,
    ]);

    let user = userQuery.rows[0];
    let message = "";

    if (!user) {
      // Create new user
      const insertUser = await pool.query(
        `INSERT INTO users (phone, is_active) 
         VALUES ($1, TRUE) RETURNING *`,
        [phone_number]
      );
      user = insertUser.rows[0];
      message = "Welcome new user";
    } else {
      message = "Welcome back user";
    }

    // Generate JWT
    const token = generateAccessToken({
      id: user.id,
      phone: user.phone,
    });

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
    console.error("Login error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

export { loginViaPhone };
