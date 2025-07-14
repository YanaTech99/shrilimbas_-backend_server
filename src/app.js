import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

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

// Import routes
import authRoutes from "./assets/router/auth.route.js";
import appRoutes from "./assets/router/app.route.js";
import shopRoutes from "./assets/router/shop.route.js";
import sliderRoutes from "./assets/router/slider.route.js";
import productRoutes from "./assets/router/product.route.js";
import orderRoutes from "./assets/router/order.route.js";
import cartRoutes from "./assets/router/cart.route.js";

// define routes
app.use("/api/auth", authRoutes);
app.use("/api/app", appRoutes);
app.use("/api/shop", shopRoutes);
app.use("/api/slider", sliderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cart", cartRoutes);

export default app;
