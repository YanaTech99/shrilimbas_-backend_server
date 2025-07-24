import { Router } from "express";
import { loginViaPhone, sendOTP } from "../controller/auth.controller.js";
import { verifyOTP } from "../middleware/otpVerification.middleware.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.route("/loginViaPhone").post(verifyOTP, loginViaPhone);
router.route("/sendOTP").post(sendOTP);

// router.route("/me").get(authenticateToken, (req, res) => {
//   return res.status(200).json({
//     success: true,
//     message: "Authenticated",
//     data: req.user,
//   });
// });

export default router;
