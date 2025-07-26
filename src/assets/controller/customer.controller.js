import pools from "../db/index.js";
import { sanitizeInput, validateUserInput } from "../utils/validation.util.js";
import {
  uploadImageToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinary.util.js";
import fs from "fs";
import { defaultProfileUrl } from "../../constants.js";

const updateProfile = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT * FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  if (
    req.body === undefined &&
    Object.keys(req.body).length === 0 &&
    !req.file
  ) {
    if (req.file.path) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({
      success: false,
      error: "No data provided",
    });
  }

  const modifiedInput = Object.entries(req.body).reduce((acc, [key, value]) => {
    if (key === "address") {
      value = typeof value === "string" ? JSON.parse(value) : value;
    }
    acc[key] = sanitizeInput(value);
    return acc;
  }, {});

  const {
    name,
    email,
    gender,
    date_of_birth,
    alternate_phone,
    firm_name,
    gst_number,
    address = {},
  } = modifiedInput;

  const profileImage = req.file;
  let uploadedImage = null;

  const { errors } = validateUserInput({
    username: name,
    email,
    phone: alternate_phone,
  });
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      errors,
    });
  }

  const updateQuery = [];

  if (name) updateQuery.push(`name = '${name}'`); // Update name if provided
  if (email) updateQuery.push(`email = '${email}'`); // Update email if provided
  if (gender) updateQuery.push(`gender = '${gender}'`); // Update gender if provided
  if (date_of_birth) updateQuery.push(`date_of_birth = '${date_of_birth}'`); // Update date_of_birth if provided
  if (alternate_phone)
    updateQuery.push(`alternate_phone = '${alternate_phone}'`); // Update alternate_phone if provided

  if (firm_name) updateQuery.push(`firm_name = '${firm_name}'`); // Update firm_name if provided
  if (gst_number) updateQuery.push(`gst_number = '${gst_number}'`); // Update gst_number if provided

  const client = await pool.getConnection();

  try {
    client.beginTransaction();

    if (updateQuery.length > 0) {
      const [result] = await client.query(
        `UPDATE customers SET ${updateQuery.join(", ")} WHERE id = ?`,
        [customer_id[0].id]
      );

      if (result.affectedRows === 0) {
        await client.rollback();
        return res.status(500).json({
          success: false,
          error: "Failed to update profile.",
        });
      }
    }

    if (address && Object.keys(address).length > 0) {
      const addressQuery = Object.entries(address)
        .map(([key, value]) => `${key} = '${value}'`)
        .join(", ");

      console.log(addressQuery);
      const [addressResult] = await client.query(
        `UPDATE addresses SET ${addressQuery} WHERE customer_id = ?`,
        [customer_id[0].id]
      );

      if (addressResult.affectedRows === 0) {
        await client.rollback();
        return res.status(500).json({
          success: false,
          error: "Failed to update address.",
        });
      }
    }

    if (profileImage && profileImage.path) {
      if (
        customer_id[0].profile_image_url &&
        customer_id[0].profile_image_url !== "" &&
        customer_id[0].profile_image_url !== defaultProfileUrl
      ) {
        const urlArray = customer_id[0].profile_image_url.split("/");
        const public_id =
          urlArray[urlArray.length - 2] +
          "/" +
          urlArray[urlArray.length - 1].split(".")[0];

        await deleteFromCloudinary(public_id);
      }

      const { secure_url, public_id } = await uploadImageToCloudinary(
        profileImage.path
      );

      uploadedImage = public_id;
      const [result] = await client.query(
        `UPDATE customers SET profile_image_url = '${secure_url}' WHERE id = ?`,
        [customer_id[0].id]
      );

      if (result.affectedRows === 0) {
        await client.rollback();
        await deleteFromCloudinary(public_id);
        return res.status(500).json({
          success: false,
          error: "Failed to update profile image.",
        });
      }
    }

    await client.commit();
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
    });
  } catch (error) {
    console.log(error);
    await client.rollback();
    deleteFromCloudinary(uploadedImage);
    return res.status(500).json({
      success: false,
      error: "Failed to update profile.",
    });
  } finally {
    if (profileImage && profileImage.path) fs.unlinkSync(profileImage.path);
    client.release();
  }
};

const addNewAddress = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const modifiedInput = sanitizeInput(req.body);

  const {
    address_line1,
    address_line2,
    landmark,
    city,
    state,
    postal_code,
    country,
    address_type,
  } = modifiedInput.address;

  const client = await pool.getConnection();

  try {
    client.beginTransaction();

    const insertQuery = [];
    const values = [];

    if (address_line1) insertQuery.push("address_line1");
    if (address_line2) insertQuery.push("address_line2");
    if (landmark) insertQuery.push("landmark");
    if (city) insertQuery.push("city");
    if (state) insertQuery.push("state");
    if (postal_code) insertQuery.push("postal_code");
    if (country) insertQuery.push("country");
    if (address_type) insertQuery.push("address_type");

    insertQuery.forEach((column, index) => {
      values.push(modifiedInput.address[column]);
    });

    insertQuery.push("customer_id");
    values.push(customer_id[0].id);

    const [result] = await client.query(
      `INSERT INTO addresses (${insertQuery.join(", ")}) VALUES (?)`,
      [values]
    );

    if (result.affectedRows === 0) {
      await client.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to add new address.",
      });
    }

    await client.commit();
    return res.status(200).json({
      success: true,
      message: "Address added successfully.",
    });
  } catch (error) {
    console.log(error);
    await client.rollback();
    return res.status(500).json({
      success: false,
      error: "Failed to add new address. Internal server error.",
    });
  } finally {
    client.release();
  }
};

const deleteAddress = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const modifiedInput = sanitizeInput(req.body);
  const { address_id } = modifiedInput;

  const client = await pool.getConnection();

  try {
    client.beginTransaction();

    const [result] = await client.query(
      `DELETE FROM addresses WHERE id = ? AND customer_id = ?`,
      [address_id, customer_id[0].id]
    );

    if (result.affectedRows === 0) {
      await client.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to delete address.",
      });
    }

    await client.commit();
    return res.status(200).json({
      success: true,
      message: "Address deleted successfully.",
    });
  } catch (error) {
    await client.rollback();
    return res.status(500).json({
      success: false,
      error: "Failed to delete address.",
    });
  } finally {
    client.release();
  }
};

const updateAddress = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const modifiedInput = sanitizeInput(req.body);

  const { address_id } = modifiedInput;
  const {
    address_line1,
    address_line2,
    landmark,
    city,
    state,
    postal_code,
    country,
    address_type,
  } = modifiedInput.address;

  const client = await pool.getConnection();

  try {
    client.beginTransaction();

    const updateQuery = [];

    if (address_line1) updateQuery.push(`address_line1 = '${address_line1}'`);
    if (address_line2) updateQuery.push(`address_line2 = '${address_line2}'`);
    if (landmark) updateQuery.push(`landmark = '${landmark}'`);
    if (city) updateQuery.push(`city = '${city}'`);
    if (state) updateQuery.push(`state = '${state}'`);
    if (postal_code) updateQuery.push(`postal_code = '${postal_code}'`);
    if (country) updateQuery.push(`country = '${country}'`);
    if (address_type) updateQuery.push(`address_type = '${address_type}'`);

    const [result] = await client.query(
      `UPDATE addresses SET ${updateQuery.join(
        ", "
      )} WHERE id = ? AND customer_id = ?`,
      [address_id, customer_id[0].id]
    );

    if (result.affectedRows === 0) {
      await client.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to update address.",
      });
    }

    await client.commit();
    return res.status(200).json({
      success: true,
      message: "Address updated successfully.",
    });
  } catch (error) {
    await client.rollback();
    return res.status(500).json({
      success: false,
      error: "Failed to update address. Inernal server error.",
    });
  } finally {
    client.release();
  }
};

const getCustomerProfile = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const client = await pool.getConnection();

  try {
    // get addresse in form of array of objects and merge with customer data
    const [customer] = await client.query(
      `SELECT * FROM customers WHERE id = ?`,
      [customer_id[0].id]
    );

    const [userPhone] = await client.query(
      `SELECT phone FROM users WHERE id = ?`,
      [user_id]
    );

    customer[0].phone = userPhone[0].phone;

    if (!customer || customer.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    let [addresses] = await client.query(
      `SELECT * FROM addresses WHERE customer_id = ?`,
      [customer_id[0].id]
    );

    addresses = addresses.map((address) => {
      return Object.fromEntries(
        Object.entries(address).map(([key, value]) => [
          key,
          value === null ? "" : value,
        ])
      );
    });

    const customerData = Object.fromEntries(
      Object.entries(customer[0]).map(([key, value]) => [
        key,
        value === null ? "" : value,
      ])
    );

    return res.status(200).json(
      Object.assign(
        {},
        {
          success: true,
          message: "Customer profile fetched successfully.",
          data: {
            ...customerData,
            addresses,
          },
        }
      )
    );
  } catch (error) {
    console.error("Error in getCustomerProfile:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
};

const getAddresses = async (req, res) => {
  const pool = pools[req.tenantId];
  const { id: user_id } = req.user;
  const [customer_id] = await pool.query(
    `SELECT id FROM customers WHERE id = ?`,
    [user_id]
  );

  if (!customer_id || customer_id.length === 0) {
    return res.status(404).json({
      success: false,
      error: "Customer not found",
    });
  }

  const client = await pool.getConnection();

  try {
    const [result] = await client.query(
      `SELECT * FROM addresses WHERE customer_id = ?`,
      [customer_id[0].id]
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Addresses not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Addresses fetched successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error in getAddresses:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
};

export {
  updateProfile,
  addNewAddress,
  updateAddress,
  getCustomerProfile,
  getAddresses,
  deleteAddress,
};
