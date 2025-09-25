import { Router } from "express";
import { insertPage, updatePage, listPages, getPageById } from "../controller/pages.controller.js";
const router = Router();

router.route("/insertPage").post(insertPage);
router.route("/updatePage").put(updatePage);
router.route("/listPages").get(listPages);
router.route("/getPageById").get(getPageById);

export default router;