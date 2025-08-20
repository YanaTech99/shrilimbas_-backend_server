import pools from "../../db/index.js";
import { razorpay } from "../../paymentConfig/index.js";
import crypto from "crypto";
import { saveTransaction } from "../../helper/saveTransaction.js";

const createOrder = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const { id: user_id } = req.user;

  try {
    const {
      amount,
      currency = "INR",
      order_id,
      provider = "razorpay",
      email = "",
    } = req.body;

    if (!amount || !order_id) {
      return res.status(400).json({
        success: false,
        error: "Amount is required",
      });
    }

    const [existingOrder] = await pool.execute(
      `SELECT order_number FROM orders WHERE id = ?`,
      [order_id]
    );

    if (!existingOrder || existingOrder.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const receipt = existingOrder[0].order_number;

    const options = {
      amount: Number(amount) * 100, // amount in paise
      currency,
      receipt,
    };

    const order = await razorpay.orders.create(options);

    if (!order.error) {
      const transactionData = {
        provider: provider,
        payment_order_id: order.id,
        receipt,
        amount: Number(amount),
        currency,
        payment_method: "online",
        order_id,
        user_id,
        email,
        contact: "",
      };

      const savedTransaction = await saveTransaction(pool, transactionData);

      if (!savedTransaction.success) {
        return res.status(200).json({
          success: true,
          message: "Order is created but Failed to save transaction",
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Order created successfully",
      data: {
        id: order.id,
        amount: order.amount / 100, // convert back to rupees
        currency: order.currency,
        receipt: order.receipt,
        status: order.status,
        created_at: order.created_at,
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to create order" });
  }
};

const verifyPayment = async (req, res) => {
  const tenantId = req.tenantId;
  const pool = pools[tenantId];
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    order_id,
    status,
  } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res
      .status(400)
      .json({ success: false, error: "Missing payment data" });
  }

  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid Razorpay signature" });
  }

  let message = "";
  // update transaction details
  const [existingTransaction] = await pool.execute(
    `SELECT * FROM transactions WHERE order_id = ?`,
    [order_id]
  );

  if (!existingTransaction || existingTransaction.length === 0) {
    console.error("Transaction not found");
    message += "transaction not found ";
  }
  const transaction_id = existingTransaction[0].id;

  const [updateTransaction] = await pool.execute(
    `UPDATE transactions SET status = 'paid', transaction_id = ? WHERE id = ?`,
    [razorpay_payment_id, transaction_id]
  );

  if (updateTransaction.affectedRows === 0) {
    console.error("Transaction not updated");
    message += "transaction not updated ";
  }

  // update order details
  const [updateOrder] = await pool.execute(
    `UPDATE orders SET order_status = 'shipped', payment_method = ?, payment_status = 'paid', payment_id = ? WHERE id = ?`,
    [existingTransaction[0].payment_method, transaction_id, order_id]
  );

  if (updateOrder.affectedRows === 0) {
    console.error("Order not updated");
    message += "order not updated ";
  }

  return res
    .status(200)
    .json({ success: true, message: `Payment verified. ${message}` });
};

export { createOrder, verifyPayment };
