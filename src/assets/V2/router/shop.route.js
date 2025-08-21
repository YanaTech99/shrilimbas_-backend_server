import { Router } from "express";
import {
  addBrand,
  addCategory,
  addProducts,
  addVariant,
  deleteCategory,
  deleteProduct,
  deleteVariant,
  getPaginatedBrands,
  getPaginatedCategories,
  getPaginatedproducts,
  getShopProfile,
  getUsers,
  softDeleteCategory,
  softDeleteProduct,
  softDeleteVariant,
  updateAddress,
  updateCategory,
  updateProduct,
  updateShop,
} from "../controller/shop.controller.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";
import { upload } from "../../middleware/multer.middleware.js";

const router = Router();

router
  .route("/updateShop")
  .patch(authenticateToken, upload.single("shopLogo"), updateShop);

router.route("/getShop").get(authenticateToken, getShopProfile);

router.route("/updateAddress").patch(authenticateToken, updateAddress);

router
  .route("/addBrand")
  .post(authenticateToken, upload.single("brandImage"), addBrand);

router.route("/addProduct").post(authenticateToken, upload.any(), addProducts);

router.route("/deleteProduct").delete(authenticateToken, deleteProduct);

router.route("/getProducts").get(authenticateToken, getPaginatedproducts);

router
  .route("/updateProduct")
  .patch(authenticateToken, upload.any(), updateProduct);

router.route("/addVariant").post(authenticateToken, upload.any(), addVariant);

router.route("/deleteVariant").delete(authenticateToken, deleteVariant);

router
  .route("/addCategory")
  .post(authenticateToken, upload.single("categoryImage"), addCategory);

router.route("/getCategories").get(authenticateToken, getPaginatedCategories);
router.route("/getBrands").get(authenticateToken, getPaginatedBrands);

router.route("/deleteCategory").delete(authenticateToken, deleteCategory);
router
  .route("/updateCategory")
  .patch(authenticateToken, upload.single("categoryImage"), updateCategory);

router.route("/getUsers").get(authenticateToken, getUsers);

router.route("/softDeleteProduct").delete(authenticateToken, softDeleteProduct);
router.route("/softDeleteVariant").delete(authenticateToken, softDeleteVariant);
router
  .route("/softDeleteCategory")
  .delete(authenticateToken, softDeleteCategory);

export default router;
