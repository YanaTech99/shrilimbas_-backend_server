import { Router } from "express";
import { loginViaPhone } from "../controller/auth.controller.js";

const router = Router();

router.route("/loginViaPhone").post(loginViaPhone);

export default router;
