import app from "./app.js";
import dotenv from "dotenv";
import pools from "./assets/db/index.js"; // Ensure database connection is established

// Load environment variables from .env file
dotenv.config({
  path: "./.env",
});

const PORT = process.env.PORT || 5000;

Object.values(pools).forEach((pool) => {
  pool.getConnection((err, connection) => {
    if (err) {
      console.error("Error connecting to the database:", err);
    } else {
      console.log("Connected to the database");
      connection.release();
    }
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
