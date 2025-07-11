import { Router } from "express";
import { getAppData } from "../controller/app.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.route("/getAppData").get(getAppData);

export default router;
