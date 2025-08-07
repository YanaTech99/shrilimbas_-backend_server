import { Router } from "express";
import {
  createOrder,
  verifyPayment,
} from "../controller/payment.controller.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";

const router = Router();

router.route("/create-order").post(authenticateToken, createOrder);
router.route("/verify-payment").post(authenticateToken, verifyPayment);

export default router;
