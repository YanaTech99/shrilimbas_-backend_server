import pool from "../db/index.js";
import { generateAccessToken } from "../utils/jwt.util.js";
import { sanitizeInput, validateUserInput } from "../utils/validation.util.js";
import { generateOTP } from "../utils/generateOTP.util.js";
import bcrypt from "bcrypt";
import { UAParser } from "ua-parser-js";

const sendOTP = async (req, res) => {
  if (!req.body.phone_number) {
    return res.status(400).json({
      success: false,
      error: "Phone number is required",
    });
  }

  const modifiedInput = sanitizeInput(req.body);
  const { errors } = validateUserInput({ phone: modifiedInput.phone_number });
  if (Object.entries(errors).length > 0) {
    return res.status(400).json({
      success: false,
      errors,
    });
  }

  const { phone_number, user_type } = modifiedInput;

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

  const userAgent = req.headers["user-agent"] || "";
  const parser = new UAParser(userAgent);
  const ua = parser.getResult();

  // Generate 6-digit random OTP
  const otpInfo = generateOTP();
  const otp = otpInfo.otp;
  const expiry = otpInfo.expiresAt;

  // Hash the OTP using bcrypt
  const saltRounds = 10;
  const hashedOtp = await bcrypt.hash(otp, saltRounds);

  // Extract device/browser info
  const browserName = ua.browser.name || null;
  const browserVersion = ua.browser.version || null;
  const osName = ua.os.name || null;
  const osVersion = ua.os.version || null;
  const deviceType = ua.device.type || "desktop";
  const ipAddress = req.ip;

  // Craft message
  let deviceInfoMsg = "";
  if (browserName || osName) {
    deviceInfoMsg = `Trying to log in from ${browserName || "a browser"} on ${
      osName || "an OS"
    }`;
  }

  const message = `${deviceInfoMsg}. Your OTP is ${otp}.`;

  try {
    const [checkOTPRecords] = await pool.execute(
      `
      SELECT id FROM otp_requests
      WHERE phone_number = ?
      `,
      [phone_number]
    );

    if (checkOTPRecords.length > 0) {
      //update everything
      const [updateResult] = await pool.execute(
        `
        UPDATE otp_requests
        SET otp_code = ?,
        user_agent = ?, browser_name = ?, browser_version = ?,
        os_name = ?, os_version = ?, device_type = ?,
        ip_address = ?, expires_at = ?
        WHERE phone_number = ?
        `,
        [
          hashedOtp,
          userAgent,
          browserName,
          browserVersion,
          osName,
          osVersion,
          deviceType,
          ipAddress,
          expiry,
          phone_number,
        ]
      );

      if (!updateResult || updateResult.affectedRows === 0) {
        return res.status(500).json({
          success: false,
          message: "Failed to send OTP",
        });
      }

      return res.status(200).json({
        success: true,
        message: "OTP resent successfully",
        dev_otp: otp,
      });
    }

    // Insert into database
    const [result] = await pool.execute(
      `
      INSERT INTO otp_requests (
        phone_number, otp_code,
        user_agent, browser_name, browser_version,
        os_name, os_version, device_type,
        ip_address, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        phone_number,
        hashedOtp,
        userAgent,
        browserName,
        browserVersion,
        osName,
        osVersion,
        deviceType,
        ipAddress,
        expiry,
      ]
    );

    if (!result || result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP",
      });
    }

    // Send OTP via SMS logic will come here

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      dev_otp: otp,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Failed to send OTP",
    });
  }
};

const loginViaPhone = async (req, res) => {
  const modifiedInput = sanitizeInput(req.body);
  const { errors } = validateUserInput({ phone: modifiedInput.phone_number });
  if (Object.entries(errors).length > 0) {
    return res.status(400).json({
      success: false,
      errors,
    });
  }

  const { phone_number, user_type } = modifiedInput;

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
        `INSERT INTO ${profileTable} (${
          user_type === "CUSTOMER" ? "id" : "user_id"
        }, name, email) VALUES (?, 'Guest', 'example@example.com')`,
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

export { loginViaPhone, sendOTP };
