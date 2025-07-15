import { Router } from "express";
import {
  loginViaPhone,
  sendOTP,
  verifyOTP,
} from "../controller/auth.controller.js";

const router = Router();

router.route("/loginViaPhone").post(loginViaPhone);
router.route("/sendOTP").post(sendOTP);
router.route("/verifyOTP").post(verifyOTP);

export default router;
