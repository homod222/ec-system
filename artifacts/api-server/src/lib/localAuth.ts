/**
 * Local authentication utilities — replaces Clerk.
 * Uses Node.js built-in crypto (scrypt for passwords, HMAC-SHA256 for JWT).
 */
import { randomBytes, scrypt, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import type { Request, RequestHandler } from "express";

const scryptAsync = promisify(scrypt);

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  const stored = Buffer.from(key, "hex");
  return derived.length === stored.length && timingSafeEqual(derived, stored);
}

// ---------------------------------------------------------------------------
// JWT (HMAC-SHA256, no external deps)
// ---------------------------------------------------------------------------

function jwtSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("SESSION_SECRET or JWT_SECRET must be configured");
  return secret;
}

function base64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf8");
}

export interface JwtPayload {
  sub: string;        // account id (public_auth_accounts.id as string)
  role: string;
  ownerId: string | null;
  iat: number;
  exp: number;
}

const JWT_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function signJwt(payload: Omit<JwtPayload, "iat" | "exp">, expiresInSeconds = JWT_EXPIRES_SECONDS): string {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(full));
  const signature = createHmac("sha256", jwtSecret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac("sha256", jwtSecret()).update(`${header}.${body}`).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(base64urlDecode(body)) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Locals {
      auth?: JwtPayload;
    }
  }
}

/** Parses JWT from Authorization header and populates res.locals.auth. Does NOT reject unauthenticated requests. */
export const jwtMiddleware: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const payload = verifyJwt(header.slice(7));
    if (payload) {
      res.locals.auth = payload;
    }
  }
  next();
};

/** Helper to read auth from request (analogous to old getAuth) */
export function getLocalAuth(req: Request): JwtPayload | null {
  return req.res?.locals.auth ?? null;
}

/** Middleware that requires valid auth */
export const requireLocalAuth: RequestHandler = (req, res, next) => {
  const auth = getLocalAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};
