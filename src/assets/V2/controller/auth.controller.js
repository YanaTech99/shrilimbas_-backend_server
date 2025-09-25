import pools from "../../db/index.js";
import axios from "axios";
import {
  generateAccessToken,
  verifyAccessToken,
} from "../../utils/jwt.util.js";
import {
  sanitizeInput,
  validateUserInput,
} from "../../utils/validation.util.js";
import { generateOTP } from "../../utils/generateOTP.util.js";
import bcrypt from "bcrypt";
import { UAParser } from "ua-parser-js";
import { defaultProfileUrl } from "../../../constants.js";
import {poolUsername} from "../../helper/poolUsername.js";

const sendOTP = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[req.tenantId];
  const username = poolUsername[tenantId];

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

  const validUserTypes = ["CUSTOMER", "VENDOR", "DELIVERY_BOY", "ADMIN"];
  if (!validUserTypes.includes(user_type)) {
    return res.status(400).json({
      success: false,
      error: "Invalid user type",
    });
  }

  const [existingUser] = await pool.execute(
    `
    SELECT user_type FROM users
    WHERE phone = ?
    `,
    [phone_number]
  );
  console.log("user_type", user_type);
  console.log("existingUser", existingUser);

  if (existingUser.length > 0) {
    if (existingUser[0].user_type !== user_type) {
      return res.status(400).json({
        success: false,
        error: "Phone number already registered with another user type",
      });
    }
    // Same user_type -> allow OTP send for login
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

  const client = await pool.getConnection();

  try {
    const [checkOTPRecords] = await client.execute(
      `
      SELECT id FROM otp_requests
      WHERE phone_number = ? AND tenant_id = ?
      `,
      [phone_number, tenantId]
    );

    if(phone_number != "9999999999" && tenantId != "otkhzjwq" ){
      const messageParams = encodeURIComponent(`User,${otp},${username}`);
      const sendOTPEndpoint = `https://www.bhashsms.com/api/sendmsgutil.php?user=YanaTechnology_bwap&pass=123456&sender=BUZWAP&phone=${phone_number}&text=login_pin&priority=wa&stype=normal&params=${messageParams}`;
      console.log(sendOTPEndpoint);
      // Send OTP via API
      const sendResponse = await axios.get(sendOTPEndpoint);
      console.log("sendResponse", sendResponse.data);

    // Check API response (optional: customize as per API response structure)
    if (sendResponse.status !== 200 || sendResponse.data.includes("error")) {
      return res.status(500).json({
        success: false,
        error: "Failed to send OTP via SMS service",
      });
    }
    }

    if (checkOTPRecords.length > 0) {
      // Update existing OTP record
      const [updateResult] = await client.execute(
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
          error: "Failed to send OTP",
        });
      }

      return res.status(200).json({
        success: true,
        message: "OTP resent successfully",
        dev_otp: otp,
      });
    }

    // Insert new OTP record
    const [result] = await client.execute(
      `
      INSERT INTO otp_requests (
        phone_number, otp_code, tenant_id, 
        user_agent, browser_name, browser_version,
        os_name, os_version, device_type,
        ip_address, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        phone_number,
        hashedOtp,
        tenantId,
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
        error: "Failed to send OTP",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      dev_otp: otp,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Internal server error. Failed to send OTP",
    });
  } finally {
    client.release();
  }
};

const loginViaPhone = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[req.tenantId];
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

  const validUserTypes = ["CUSTOMER", "VENDOR", "DELIVERY_BOY", "ADMIN"];
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
        `INSERT INTO users (phone, user_type, tenant_id, is_active) VALUES (?, ?, ?, 1)`,
        [phone_number, user_type, tenantId]
      );

      const [newUserRows] = await client.execute(
        `SELECT * FROM users WHERE phone = ?`,
        [phone_number]
      );

      // insert into resepective profile table based on user type
      let profileTable = "";
      if (user_type === "VENDOR") {
        profileTable = "shops";
      } else if (user_type === "DELIVERY_BOY") {
        profileTable = "delivery_boys";
      } else if (user_type === "CUSTOMER") {
        profileTable = "customers";
      } else {
        profileTable = "";
      }

      if (profileTable !== "") {
        const [profileInsertResult] = await client.execute(
          `INSERT INTO ${profileTable} (user_id, ${
            user_type === "VENDOR" ? "logo_url" : "profile_image_url"
          }) VALUES (?, ?)`,
          [newUserRows[0].id, defaultProfileUrl]
        );

        if (profileInsertResult.affectedRows === 0) {
          await client.rollback();
          return res.status(500).json({
            success: false,
            error: "Failed to create user profile",
          });
        }
      }
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
      tenant_id: user.tenant_id,
    });

    const decoded = verifyAccessToken(token);

    await client.commit();

    return res.status(200).json({
      success: true,
      message,
      token,
      expiry: decoded.exp,
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
