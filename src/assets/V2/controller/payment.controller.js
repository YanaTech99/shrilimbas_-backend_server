import pools from "../../db/index.js";
import { razorpay } from "../../paymentConfig/index.js";

const createOrder = async (req, res) => {
  try {
    const { amount, currency = "INR", receipt } = req.body;

    if (!amount || !receipt) {
      return res
        .status(400)
        .json({ message: "Amount and receipt are required" });
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
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      },
    });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create order" });
  }
};

export { createOrder };
