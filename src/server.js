import app from "./app.js";
import dotenv from "dotenv";
import pool from "./assets/db/index.js"; // Ensure database connection is established

// Load environment variables from .env file
dotenv.config({
  path: "./.env",
});

const PORT = process.env.PORT;

pool
  .getConnection()
  .then((connection) => {
    console.log("✅ MySQL DB connected successfully");

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });

    connection.release();
  })
  .catch((err) => {
    console.error("❌ MySQL DB connection failed:", err.message);
  });
