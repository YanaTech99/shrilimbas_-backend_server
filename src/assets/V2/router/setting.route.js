import { Router } from "express";
import {
  getSettings,
  updateSettings,
} from "../controller/setting.controller.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";
import { upload } from "../../middleware/multer.middleware.js";

const router = Router();

router.route("/getSettings").get(authenticateToken, getSettings);
router
  .route("/updateSettings")
  .patch(authenticateToken, upload.single("logo"), updateSettings);

export default router;
