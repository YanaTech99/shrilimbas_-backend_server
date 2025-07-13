import { Router } from "express";
import {
  getOrderByCustomerID,
  placeOrder,
} from "../controller/order.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.route("/placeOrder").post(authenticateToken, placeOrder);

router
  .route("/getOrderByCustomerID")
  .get(authenticateToken, getOrderByCustomerID);

export default router;
