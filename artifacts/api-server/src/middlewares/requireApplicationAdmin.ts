import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

type Claims = Record<string, unknown>;

const administrativeRoles = new Set([
  "admin",
  "nursery_admin",
  "staff",
  "manager",
  "owner",
  "superadmin",
]);

function roleFromClaims(claims: Claims | null | undefined): string | undefined {
  const candidates = [
    claims?.role,
    (claims?.metadata as Claims | undefined)?.role,
    (claims?.publicMetadata as Claims | undefined)?.role,
    (claims?.public_metadata as Claims | undefined)?.role,
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === "string");
}

export const requireApplicationAdmin: RequestHandler = async (req, res, next) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    let role = roleFromClaims(auth.sessionClaims as Claims | null | undefined);
    if (!role) {
      const user = await clerkClient.users.getUser(auth.userId);
      role = roleFromClaims({
        publicMetadata: user.publicMetadata,
        privateMetadata: user.privateMetadata,
        role: user.publicMetadata?.role ?? user.privateMetadata?.role,
      });
    }

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