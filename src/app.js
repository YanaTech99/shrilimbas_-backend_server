import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { multiTenantMiddleware } from "./assets/middleware/multiTenant.middlerware.js";

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

app.use(express.static("public"));

app.use(cookieParser());

// Import routes
import authRoutes from "./assets/router/auth.route.js";
import appRoutes from "./assets/router/app.route.js";
import shopRoutes from "./assets/router/shop.route.js";
import sliderRoutes from "./assets/router/slider.route.js";
import productRoutes from "./assets/router/product.route.js";
import orderRoutes from "./assets/router/order.route.js";
import cartRoutes from "./assets/router/cart.route.js";
import customerRoutes from "./assets/router/customer.route.js";

// define routes
app.use("/api/v1/auth", multiTenantMiddleware, authRoutes);
app.use("/api/v1/app", multiTenantMiddleware, appRoutes);
app.use("/api/v1/shop", multiTenantMiddleware, shopRoutes);
app.use("/api/v1/slider", sliderRoutes);
app.use("/api/v1/products", multiTenantMiddleware, productRoutes);
app.use("/api/v1/orders", multiTenantMiddleware, orderRoutes);
app.use("/api/v1/cart", multiTenantMiddleware, cartRoutes);
app.use("/api/v1/customer", multiTenantMiddleware, customerRoutes);

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
