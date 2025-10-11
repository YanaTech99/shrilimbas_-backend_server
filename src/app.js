import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { multiTenantMiddleware } from "./assets/middleware/multiTenant.middlerware.js";
import morgan from "morgan";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use((req, res, next) => {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    express.json({ limit: "16kb" })(req, res, next);
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    express.urlencoded({ extended: true, limit: "16kb" })(req, res, next);
  } else {
    next();
  }
});

app.use(morgan("dev"))

app.use(express.static("public"));

app.use(cookieParser());

// ****************** V1 API ******************

// Import routes
import authRoutes from "./assets/V1/router/auth.route.js";
import appRoutes from "./assets/V1/router/app.route.js";
import shopRoutes from "./assets/V1/router/shop.route.js";
import sliderRoutes from "./assets/V1/router/slider.route.js";
import productRoutes from "./assets/V1/router/product.route.js";
import orderRoutes from "./assets/V1/router/order.route.js";
import cartRoutes from "./assets/V1/router/cart.route.js";
import customerRoutes from "./assets/V1/router/customer.route.js";

// define routes
app.use("/api/v1/auth", multiTenantMiddleware, authRoutes);
app.use("/api/v1/app", multiTenantMiddleware, appRoutes);
app.use("/api/v1/shop", multiTenantMiddleware, shopRoutes);
app.use("/api/v1/slider", sliderRoutes);
app.use("/api/v1/products", multiTenantMiddleware, productRoutes);
app.use("/api/v1/orders", multiTenantMiddleware, orderRoutes);
app.use("/api/v1/cart", multiTenantMiddleware, cartRoutes);
app.use("/api/v1/customer", multiTenantMiddleware, customerRoutes);

// ****************** V1 API ******************

// ****************** V2 API ******************

// Import routes
import authRoutesV2 from "./assets/V2/router/auth.route.js";
import appRoutesV2 from "./assets/V2/router/app.route.js";
import cartRoutesV2 from "./assets/V2/router/cart.route.js";
import customerRoutesV2 from "./assets/V2/router/customer.route.js";
import orderRoutesV2 from "./assets/V2/router/order.route.js";
import productRoutesV2 from "./assets/V2/router/product.route.js";
import sliderRoutesV2 from "./assets/V2/router/slider.route.js";
import shopRoutesV2 from "./assets/V2/router/shop.route.js";
import paymentRoutesV2 from "./assets/V2/router/payment.route.js";
import settingRoutesV2 from "./assets/V2/router/setting.route.js";
import deliveryBoyRoutesV2 from "./assets/V2/router/delivery_boy.route.js";
import pagesRoutesV2 from "./assets/V2/router/pages.route.js";
import porterRoutesV2 from "./assets/V2/router/porter.route.js";

// define routes
app.use("/api/v2/auth", multiTenantMiddleware, authRoutesV2);
app.use("/api/v2/app", multiTenantMiddleware, appRoutesV2);
app.use("/api/v2/shop", multiTenantMiddleware, shopRoutesV2);
app.use("/api/v2/slider", multiTenantMiddleware, sliderRoutesV2);
app.use("/api/v2/products", multiTenantMiddleware, productRoutesV2);
app.use("/api/v2/orders", multiTenantMiddleware, orderRoutesV2);
app.use("/api/v2/cart", multiTenantMiddleware, cartRoutesV2);
app.use("/api/v2/customer", multiTenantMiddleware, customerRoutesV2);
app.use("/api/v2/payment", multiTenantMiddleware, paymentRoutesV2);
app.use("/api/v2/setting", multiTenantMiddleware, settingRoutesV2);
app.use("/api/v2/delivery-boy", multiTenantMiddleware, deliveryBoyRoutesV2);
app.use("/api/v2/pages", multiTenantMiddleware, pagesRoutesV2);
app.use("/api/v2/porter", multiTenantMiddleware, porterRoutesV2);
// ****************** V2 API ******************

// ✅ Error-handling middleware
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.error("Invalid JSON received:", err.message);
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  // For all other errors
  next(err);
});

export default app;
