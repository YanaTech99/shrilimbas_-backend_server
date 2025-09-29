import Razorpay from "razorpay";
import pools from "../db/index.js";

async function getRazorpayInstance(tenantId) {
  const pool = pools[tenantId];
  const connection = await pool.getConnection();

  const [rows] = await connection.query(
    `SELECT 
       CAST(AES_DECRYPT(UNHEX(razorpay_key_id_enc), ?) AS CHAR) AS key_id,
       CAST(AES_DECRYPT(UNHEX(razorpay_key_secret_enc), ?) AS CHAR) AS key_secret
     FROM razorpay_keys
     `,
    [process.env.RAZORPAY_HEX_KEY, process.env.RAZORPAY_HEX_KEY]
  );

  connection.release();

  if (rows.length === 0) {
    throw new Error("Razorpay keys not found for tenant " + tenantId);
  }

  console.log("rows---", rows);

  const { key_id, key_secret } = rows[0];

  return new Razorpay({
    key_id,
    key_secret,
  });
}

async function getRazorpayKeys(tenantId) {
  const pool = pools[tenantId];
  const connection = await pool.getConnection();

  const [rows] = await connection.query(
    `SELECT 
       CAST(AES_DECRYPT(UNHEX(razorpay_key_id_enc), ?) AS CHAR) AS key_id,
       CAST(AES_DECRYPT(UNHEX(razorpay_key_secret_enc), ?) AS CHAR) AS key_secret,
       razor_pay_logo
     FROM razorpay_keys
     `,
    [process.env.RAZORPAY_HEX_KEY, process.env.RAZORPAY_HEX_KEY]
  );

  connection.release();

  if (rows.length === 0) {
    throw new Error("Razorpay keys not found for tenant " + tenantId);
  }

  console.log("rows---", rows);

  const { key_id, key_secret, razor_pay_logo } = rows[0];

  return { key_id, key_secret, razor_pay_logo };
}

export { getRazorpayInstance, getRazorpayKeys };
