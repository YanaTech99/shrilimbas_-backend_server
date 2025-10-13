// src/assets/V2/router/analytics.route.js
import { Router } from "express";
import {
  getDashboardAnalytics,
  getOrderStatistics,
  getCustomerAnalytics,
} from "../controller/analytics.controller.js";
import { authenticateToken } from "../../middleware/auth.middleware.js";

const router = Router();

// Dashboard Analytics - Main endpoint
router.route("/dashboard").get(authenticateToken, getDashboardAnalytics);

// Order Statistics by date range
router.route("/orders/statistics").get(authenticateToken, getOrderStatistics);

// Customer Analytics
router.route("/customers").get(authenticateToken, getCustomerAnalytics);

export default router;