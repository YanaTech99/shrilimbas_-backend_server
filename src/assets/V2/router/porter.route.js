import { Router } from "express";
import {
  handlePorterWebhook,
  getOrderTracking,
  getLiveLocation,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controller/porter.controller.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";

const router = Router();

router.route("/webhook").post(handlePorterWebhook);

router.route("/tracking/:order_number").get(authenticateToken, getOrderTracking);

router.route("/live-location/:order_number").get(authenticateToken, getLiveLocation);

router.route("/notifications").get(authenticateToken, getNotifications);

router.route("/notifications/:notification_id/read").patch(authenticateToken, markNotificationRead);

router.route("/notifications/mark-all-read").patch(authenticateToken, markAllNotificationsRead);

export default router;
