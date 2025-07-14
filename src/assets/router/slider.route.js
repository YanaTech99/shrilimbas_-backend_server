import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { addSlider, deleteSlider } from "../controller/slider.controller.js";
import { upload } from "../middleware/multer.middleware.js";

const router = Router();

router
  .route("/addSlider")
  .post(authenticateToken, upload.array("sliderImages", 10), addSlider);

router.route("/deleteSlider").delete(authenticateToken, deleteSlider);

export default router;
