import { Router } from "express";
import {
  addBrand,
  addCategory,
  addProducts,
  deleteCategory,
  deleteProduct,
  getPaginatedBrands,
  getPaginatedCategories,
  getPaginatedproducts,
  updateAddress,
  updateCategory,
  updateProduct,
  updateShop,
} from "../controller/shop.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/multer.middleware.js";

const router = Router();

router.route("/updateShop").patch(authenticateToken, updateShop);

router.route("/updateAddress").patch(authenticateToken, updateAddress);

router
  .route("/addBrand")
  .post(authenticateToken, upload.single("brandImage"), addBrand);

router.route("/addProduct").post(authenticateToken, upload.any(), addProducts);

router.route("/deleteProduct").delete(authenticateToken, deleteProduct);

router.route("/getProducts").get(authenticateToken, getPaginatedproducts);

router
  .route("/addCategory")
  .post(authenticateToken, upload.single("categoryImage"), addCategory);

router.route("/getCategories").get(authenticateToken, getPaginatedCategories);
router.route("/getBrands").get(authenticateToken, getPaginatedBrands);

router
  .route("/updateProduct")
  .patch(authenticateToken, upload.single("thumbnail"), updateProduct);

router.route("/deleteCategory").delete(authenticateToken, deleteCategory);
router.route("/updateCategory").patch(authenticateToken, updateCategory);

export default router;
