import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { addSlider } from "../controller/slider.controller.js";
import { upload } from "../middleware/multer.middleware.js";

const router = Router();

router
  .route("/addSlider")
  .post(authenticateToken, upload.array("sliderImages", 10), addSlider);

export default router;
