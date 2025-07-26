import jwt from "jsonwebtoken";
import pools from "../db/index.js";

const authenticateToken = async (req, res, next) => {
  const pool = pools[req.tenantId];
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null)
    return res.status(401).json({ success: false, error: "No token provided" });

  const decoded = jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err)
      return res.status(403).json({ success: false, error: "Invalid token" });
    return user;
  });

  const client = await pool.getConnection();
  try {
    const [user] = await client.query(
      `SELECT id, user_type FROM users WHERE id = ? AND is_active = 1`,
      [decoded.id]
    );

    if (!user || user.length === 0)
      return res.status(404).json({ success: false, error: "User not found" });

    req.user = user[0];
    next();
  } catch (error) {
    console.error("Error in authenticateToken:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  } finally {
    client.release();
  }
};

export { authenticateToken };
