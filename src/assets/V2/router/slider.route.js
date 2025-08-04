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

router
  .route("/addSlider")
  .post(authenticateToken, upload.array("sliderImages", 10), addSlider);

router.route("/deleteSlider").delete(authenticateToken, deleteSlider);

router.route("/getSlider").get(authenticateToken, getSlider);

router.route("/updateSlider").patch(authenticateToken, updateSlider);

export default router;
