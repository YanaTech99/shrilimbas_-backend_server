import { Router } from "express";
import { loginViaPhone, sendOTP } from "../controller/auth.controller.js";
import { verifyOTP } from "../middleware/otpVerification.middleware.js";

const router = Router();

router.route("/loginViaPhone").post(verifyOTP, loginViaPhone);
router.route("/sendOTP").post(sendOTP);

export default router;
