import { Router } from "express";
import {
  getPaginatedBrands,
  getPaginatedCategories,
  getPaginatedProducts,
  getCategoryProductById
} from "../controller/product.controller.js";

const router = Router();

router.route("/getCategories").get(getPaginatedCategories);
router.route("/getBrands").get(getPaginatedBrands);
router.route("/getProducts").get(getPaginatedProducts);
router.route("/getCategoryProductById").get(getCategoryProductById);

export default router;
