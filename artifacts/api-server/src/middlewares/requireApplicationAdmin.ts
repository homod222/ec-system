import type { RequestHandler } from "express";
import { getLocalAuth } from "../lib/localAuth";

const administrativeRoles = new Set([
  "admin",
  "nursery_admin",
  "staff",
  "manager",
  "owner",
  "superadmin",
]);

export const requireApplicationAdmin: RequestHandler = async (req, res, next) => {
  const auth = getLocalAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const role = auth.role?.toLowerCase();
    if (!role || !administrativeRoles.has(role)) {
      res.status(403).json({ error: "Administrative access required" });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "Failed to resolve administrative role");
    next(error);
  }
};