import { Router } from "express";
import {
  addBrands,
  addCategories,
  addProducts,
  updateShop,
} from "../controller/shop.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.route("/updateShop").patch(authenticateToken, updateShop);
router.route("/addBrand").post(authenticateToken, addBrands);
router.route("/addProduct").post(authenticateToken, addProducts);
router.route("/addCategory").post(authenticateToken, addCategories);

export default router;
