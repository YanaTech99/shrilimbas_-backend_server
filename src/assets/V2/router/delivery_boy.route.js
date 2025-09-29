import { Router } from "express";
import {
  getOrders,
  updateProfile,
  acceptOrder,
  completeOrder,
  getEarnings,
  getProfile,
  getActiveOrders,
  getDeliveryBoyList,
  deliveryBoyVerification,
} from "../controller/delivery_boy.controller.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";
import { upload } from "../../middleware/multer.middleware.js";

const router = Router();

router.route("/updateProfile").patch(
  authenticateToken,
  upload.fields([
    { name: "profile_image", maxCount: 1 },
    { name: "photo_id", maxCount: 1 },
    { name: "license", maxCount: 1 },
    { name: "vehicle_rc", maxCount: 1 },
  ]),
  updateProfile
);

router.route("/getOrders").get(authenticateToken, getOrders);

router.route("/acceptOrder").post(authenticateToken, acceptOrder);

router.route("/completeOrder").post(authenticateToken, completeOrder);

router.route("/getEarnings").get(authenticateToken, getEarnings);

router.route("/getProfile").get(authenticateToken, getProfile);

router.route("/getActiveOrders").get(authenticateToken, getActiveOrders);

router.route("/getDeliveryBoyList").get(authenticateToken, getDeliveryBoyList);

router.route("/deliveryBoyVerification").post(authenticateToken, deliveryBoyVerification);

export default router;
