import { Router } from "express";
import { getAppData, searchFilterData } from "../controller/app.controller.js";

const router = Router();

router.route("/getAppData").get(getAppData);
router.route("/searchFilterData").get(searchFilterData);

export default router;
