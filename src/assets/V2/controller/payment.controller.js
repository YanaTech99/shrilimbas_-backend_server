import pools from "../../db/index.js";
import { razorpay } from "../../paymentConfig/index.js";

const createOrder = async (req, res) => {
  try {
    const { amount, currency = "INR", receipt = "Receipt" } = req.body;

    if (!amount) {
      return res.status(400).json({ message: "Amount is required" });
    }

    const options = {
      amount: amount * 100, // amount in paise
      currency,
      receipt,
    };

    const order = await razorpay.orders.create(options);

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
      .json({ success: false, message: "Failed to create order" });
  }
};

export { createOrder };
