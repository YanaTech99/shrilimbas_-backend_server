import { Router } from "express";
import {
  addToCart,
  deleteFromCart,
  getCart,
} from "../controller/cart.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.route("/addToCart").post(authenticateToken, addToCart);
router.route("/getCart").get(authenticateToken, getCart);
router.route("/deleteFromCart").delete(authenticateToken, deleteFromCart);

export default router;
