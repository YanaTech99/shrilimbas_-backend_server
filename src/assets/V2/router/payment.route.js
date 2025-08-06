import { Router } from "express";
import { createOrder } from "../controller/payment.controller.js";

const router = Router();

router.route("/create-order").post(createOrder);

export default router;
