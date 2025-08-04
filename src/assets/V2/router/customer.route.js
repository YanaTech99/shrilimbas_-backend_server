import { Router } from "express";
import {
  addNewAddress,
  deleteAddress,
  getAddresses,
  getCustomerProfile,
  updateAddress,
  updateProfile,
} from "../controller/customer.controller.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";
import { upload } from "../../middleware/multer.middleware.js";

const router = Router();

router
  .route("/updateProfile")
  .post(authenticateToken, upload.single("profileImage"), updateProfile);

router.route("/getCustomerProfile").get(authenticateToken, getCustomerProfile);
router.route("/getAddresses").get(authenticateToken, getAddresses);
router.route("/addNewAddress").post(authenticateToken, addNewAddress);
router.route("/updateAddress").patch(authenticateToken, updateAddress);
router.route("/deleteAddress").delete(authenticateToken, deleteAddress);

export default router;
