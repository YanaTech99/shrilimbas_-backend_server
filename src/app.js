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

app.use(
  express.json({
    limit: "16kb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "16kb",
  })
);

app.use(express.static("public"));

app.use(cookieParser());

// console.log("Cloudinary ENV:", {
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY ? "[OK]" : "[MISSING]",
//   api_secret: process.env.CLOUDINARY_API_SECRET ? "[OK]" : "[MISSING]",
// });

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

export default app;
