import bcrypt from "bcrypt";
import pools from "../db/index.js";

const verifyOTP = async (req, res, next) => {
  const tenantId = req.tenantId;
  const pool = pools[req.tenantId];
  const { phone_number, otp_code, user_type } = req.body;

  // temporary logic for testing
  const [existingUser] = await pool.execute(
    `
    SELECT user_type FROM users
    WHERE phone = ?
    `,
    [phone_number]
  );
  console.log(existingUser);

  if (existingUser.length > 0 && existingUser[0].user_type !== user_type) {
    return res.status(400).json({
      success: false,
      error: "User already exists",
    });
  }

  // if (otp_code === "123456") {
  //   return next();
  // } else {
  //   return res.status(400).json({
  //     success: false,
  //     error: "Invalid OTP",
  //   });
  // }

  try {
    // Fetch the latest OTP record for the phone number
    const [rows] = await pool.execute(
      `
      SELECT * FROM otp_requests
      WHERE phone_number = ? AND tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [phone_number, tenantId]
    );

    const otpRecord = rows[0];

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "OTP was not sent",
      });
    }

    // Check if max attempts exceeded
    if (otpRecord.attempt_count >= 3) {
      await pool.execute(
        `DELETE FROM otp_requests WHERE phone_number = ? AND`,
        [phone_number, tenantId]
      );
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Try again later.",
      });
    }

    // Update attempt count
    await pool.execute(
      `
      UPDATE otp_requests
      SET attempt_count = attempt_count + 1
      WHERE id = ?
    `,
      [otpRecord.id]
    );

    // Check if already used
    if (otpRecord.is_used) {
      await pool.execute(
        `DELETE FROM otp_requests WHERE phone_number = ? AND tenant_id = ?`,
        [phone_number, tenantId]
      );
      return res.status(400).json({
        success: false,
        message: "OTP has already been used.",
      });
    }

    // Check if expired
    const now = new Date();
    if (new Date(otpRecord.expires_at) < now) {
      await pool.execute(
        `DELETE FROM otp_requests WHERE phone_number = ? AND tenant_id = ?`,
        [phone_number, tenantId]
      );
      return res.status(400).json({
        success: false,
        message: "OTP has expired.",
      });
    }

    // Check OTP match
    const isMatch = await bcrypt.compare(otp_code, otpRecord.otp_code);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP.",
      });
    }

    // Mark OTP as used and verified
    await pool.execute(
      `
      UPDATE otp_requests
      SET is_used = TRUE, is_verified = TRUE
      WHERE id = ?
    `,
      [otpRecord.id]
    );

    // You can proceed to log in the user or create an account
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

export { verifyOTP };
