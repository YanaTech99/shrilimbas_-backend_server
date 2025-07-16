import { Router } from "express";
import {
  addBrand,
  addCategory,
  addProducts,
  getPaginatedBrands,
  getPaginatedCategories,
  getPaginatedproducts,
  updateAddress,
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

router.route("/addProduct").post(
  authenticateToken,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "gallery_images", maxCount: 5 },
    { name: "variant_thumbnail_0", maxCount: 1 },
  ]),
  addProducts
);

router
  .route("/addCategory")
  .post(authenticateToken, upload.single("categoryImage"), addCategory);

router.route("/getCategories").get(authenticateToken, getPaginatedCategories);
router.route("/getBrands").get(authenticateToken, getPaginatedBrands);
router.route("/getProducts").get(authenticateToken, getPaginatedproducts);

router
  .route("/updateProduct")
  .patch(authenticateToken, upload.single("thumbnail"), updateProduct);

export default router;
