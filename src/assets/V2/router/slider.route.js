import { Router } from "express";
import { authenticateToken } from "../../middleware/auth.middleware.js";
import {
  addSlider,
  deleteSlider,
  getSlider,
  updateSlider,
} from "../controller/slider.controller.js";
import { upload } from "../../middleware/multer.middleware.js";

const router = Router();

router.route("/addSlider").post(authenticateToken, upload.any(), addSlider);

router.route("/deleteSlider").delete(authenticateToken, deleteSlider);

router.route("/getSlider").get(authenticateToken, getSlider);

router
  .route("/updateSlider")
  .patch(authenticateToken, upload.any(), updateSlider);

export default router;
