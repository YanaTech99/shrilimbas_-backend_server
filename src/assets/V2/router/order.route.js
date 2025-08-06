import { Router } from "express";
import {
  getOrderByCustomerID,
  getOrderByShopID,
  placeOrder,
  updateStatus,
} from "../controller/order.controller.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";
import { verifyRazorpay } from "../../middleware/razorpayVerify.middleware.js";

const router = Router();

router.route("/placeOrder").post(authenticateToken, verifyRazorpay, placeOrder);

router.route("/getOrderByShopID").get(authenticateToken, getOrderByShopID);

router.route("/updateStatus").patch(authenticateToken, updateStatus);

router
  .route("/getOrderByCustomerID")
  .get(authenticateToken, getOrderByCustomerID);

export default router;
