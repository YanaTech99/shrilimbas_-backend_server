import pools from "../db/index.js";

const multiTenantMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  let tenantId = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      tenantId = decoded.tenant_id;
    } catch (err) {
      return res.status(403).json({ error: "Invalid token" });
    }
  } else {
    // Guest request: get tenant from header
    tenantId = req.headers["tenant-id"];
  }

  if (!tenantId || !pools[tenantId]) {
    return res.status(400).json({ error: "Unknown tenant" });
  }

  req.tenantId = tenantId;
  next();
};

export { multiTenantMiddleware };
