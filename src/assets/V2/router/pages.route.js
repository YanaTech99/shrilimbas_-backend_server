import { Router } from "express";
import { insertPage, updatePage, listPages, getPageById } from "../controller/pages.controller.js";
import { upload } from "../../middleware/multer.middleware.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";

const router = Router();

router.route("/insertPage").post(authenticateToken,upload.single("page_image"), insertPage);
router.route("/updatePage/:id").put(authenticateToken,upload.single("page_image"), updatePage);
router.route("/listPages").get(authenticateToken,listPages);
router.route("/getPageById").get(authenticateToken,getPageById);

export default router;