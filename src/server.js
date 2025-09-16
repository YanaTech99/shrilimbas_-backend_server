import app from "./app.js";
import dotenv from "dotenv";
import pools from "./assets/db/index.js"; // Make sure this is properly exporting pools

dotenv.config({
  path: "./.env",
});


const PORT = process.env.PORT || 5000;

Object.entries(pools).forEach(async ([poolName, pool]) => {
  try {
    const connection = await pool.getConnection();
    console.log(`[${poolName}] Connected to the database`);
    connection.release();
  } catch (err) {
    console.error(`[${poolName}] Database connection error:`, err);
  }
});

app.listen(PORT, (err) => {
  if (err) {
    console.error("Server failed to start:", err);
  } else {
    console.log(`Server running on port ${PORT}`);
  }
});
