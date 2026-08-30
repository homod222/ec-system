import { Router, type IRouter, type Request } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  db,
  phoneLoginIdentitiesTable,
  phoneOtpChallengesTable,
} from "@workspace/db";
import {
  GetPhoneEnrollmentResponse,
  RequestPhoneEnrollmentBody,
  RequestPhoneEnrollmentResponse,
  VerifyPhoneEnrollmentBody,
  VerifyPhoneEnrollmentResponse,
} from "@workspace/api-zod";

type Sender = (to: string, otp: string) => Promise<{ ok: true } | { ok: false; error: string }>;
type Identity = { clerkUserId: string; firstName: string };

const OTP_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_PHONE = 4;
const MAX_PER_IP = 12;

function pepper() {
  const value = process.env.OTP_PEPPER || process.env.CLERK_SECRET_KEY;
  if (!value) throw new Error("OTP_PEPPER or CLERK_SECRET_KEY must be configured");
  return value;
}

function digest(value: string) {
  return createHash("sha256").update(`${pepper()}:${value}`).digest("hex");
}

export function normalizeKuwaitPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("00965")
    ? digits.slice(5)
    : digits.startsWith("965") && digits.length > 8
      ? digits.slice(3)
      : digits.replace(/^0+/, "");
  return /^[569]\d{7}$/.test(local) ? `965${local}` : null;
}

function firstName(name: string) {
  return name.trim().split(/\s+/u)[0]?.slice(0, 100) || "";
}

function requestIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function secureDigestEqual(expectedHex: string, actualHex: string) {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function isEnrollmentAdmin(userId: string) {
  const user = await clerkClient.users.getUser(userId);
  const metadata = user.publicMetadata as Record<string, unknown>;
  const privateMetadata = user.privateMetadata as Record<string, unknown>;
  const role = typeof metadata.role === "string" ? metadata.role.toLowerCase() : "";
  if (["owner", "superadmin", "admin", "nursery_admin"].includes(role)) return user;
  const scopedOwner = metadata.ownerId ?? metadata.owner_id;
  return (!scopedOwner && privateMetadata.staffId == null) ? user : null;
}

const defaultSender: Sender = async (to, otp) => {
  const { sendWhatsAppOtp } = await import("../lib/notifications");
  return sendWhatsAppOtp(to, otp);
};

export function createPhoneAuthRouter(sender: Sender = defaultSender): IRouter {
  const router = Router();

  async function createChallenge(req: Request, options: {
    purpose: "login" | "enrollment";
    phone: string;
    identity: Identity | null;
    requestedBy?: string;
  }) {
    const id = randomUUID();
    const otp = randomInt(100000, 1000000).toString();
    const phoneHash = digest(`phone:${options.phone}`);
    const ipHash = digest(`ip:${requestIp(req)}`);
    const since = new Date(Date.now() - WINDOW_MS);
    const inserted = await db.transaction(async tx => {
      for (const lockKey of [`phone:${phoneHash}`, `ip:${ipHash}`].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);
      }
      const [phoneRequests, ipRequests] = await Promise.all([
        tx.select({ id: phoneOtpChallengesTable.id }).from(phoneOtpChallengesTable)
          .where(and(eq(phoneOtpChallengesTable.normalizedPhoneHash, phoneHash), gte(phoneOtpChallengesTable.createdAt, since)))
          .limit(MAX_PER_PHONE),
        tx.select({ id: phoneOtpChallengesTable.id }).from(phoneOtpChallengesTable)
          .where(and(eq(phoneOtpChallengesTable.ipHash, ipHash), gte(phoneOtpChallengesTable.createdAt, since)))
          .limit(MAX_PER_IP),
      ]);
      if (phoneRequests.length >= MAX_PER_PHONE || ipRequests.length >= MAX_PER_IP) return false;
      await tx.insert(phoneOtpChallengesTable).values({
        id,
        purpose: options.purpose,
        normalizedPhoneHash: phoneHash,
        normalizedPhone: options.purpose === "enrollment" ? options.phone : null,
        ipHash,
        otpHash: digest(`otp:${id}:${otp}`),
        clerkUserId: options.identity?.clerkUserId ?? null,
        firstName: options.identity?.firstName ?? null,
        requestedBy: options.requestedBy ?? null,
        expiresAt: new Date(Date.now() + OTP_SECONDS * 1000),
      });
      return true;
    });
    if (!inserted) return null;
    if (options.identity || options.purpose === "enrollment") {
      const result = await sender(options.phone, otp);
      if (!result.ok) {
        await db.delete(phoneOtpChallengesTable).where(eq(phoneOtpChallengesTable.id, id));
        throw new Error("WhatsApp delivery failed");
      }
    }
    return { id, otp };
  }

  router.post("/auth/phone/request", (_req, res) => {
    res.status(410).json({ error: "Phone login retired" });
  });

  router.post("/auth/phone/verify", (_req, res) => {
    res.status(410).json({ error: "Phone login retired" });
  });

  router.get("/auth/phone/enrollment", async (req, res, next) => {
    try {
      const userId = getAuth(req).userId;
      if (!userId) return void res.status(401).json({ error: "Unauthorized" });
      if (!await isEnrollmentAdmin(userId)) return void res.status(403).json({ error: "Administrative access required" });
      const [identity] = await db.select().from(phoneLoginIdentitiesTable)
        .where(eq(phoneLoginIdentitiesTable.clerkUserId, userId)).limit(1);
      res.json(GetPhoneEnrollmentResponse.parse(identity
        ? { enrolled: true, phone: identity.normalizedPhone }
        : { enrolled: false }));
    } catch (error) { next(error); }
  });

  router.post("/auth/phone/enrollment/request", async (req, res, next) => {
    try {
      const userId = getAuth(req).userId;
      if (!userId) return void res.status(401).json({ error: "Unauthorized" });
      const user = await isEnrollmentAdmin(userId);
      if (!user) return void res.status(403).json({ error: "Administrative access required" });
      const body = RequestPhoneEnrollmentBody.safeParse(req.body);
      const phone = body.success ? normalizeKuwaitPhone(body.data.phone) : null;
      if (!phone) return void res.status(400).json({ error: "Invalid Kuwait mobile number" });
      const [existing] = await db.select().from(phoneLoginIdentitiesTable)
        .where(eq(phoneLoginIdentitiesTable.normalizedPhone, phone)).limit(1);
      if (existing && existing.clerkUserId !== userId) return void res.status(409).json({ error: "Phone already enrolled" });
      const name = firstName(user.firstName || "المالك");
      const challenge = await createChallenge(req, {
        purpose: "enrollment", phone, identity: { clerkUserId: userId, firstName: name }, requestedBy: userId,
      });
      if (!challenge) return void res.status(429).json({ error: "Try again later" });
      res.json(RequestPhoneEnrollmentResponse.parse({ challengeId: challenge.id, expiresInSeconds: OTP_SECONDS, recognized: true, firstName: name }));
    } catch (error) { next(error); }
  });

  router.post("/auth/phone/enrollment/verify", async (req, res, next) => {
    try {
      const userId = getAuth(req).userId;
      if (!userId) return void res.status(401).json({ error: "Unauthorized" });
      if (!await isEnrollmentAdmin(userId)) return void res.status(403).json({ error: "Administrative access required" });
      const body = VerifyPhoneEnrollmentBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid challenge" });
      const [challenge] = await db.select().from(phoneOtpChallengesTable).where(and(
        eq(phoneOtpChallengesTable.id, body.data.challengeId),
        eq(phoneOtpChallengesTable.purpose, "enrollment"),
        eq(phoneOtpChallengesTable.requestedBy, userId),
        isNull(phoneOtpChallengesTable.consumedAt),
        sql`${phoneOtpChallengesTable.expiresAt} > now()`,
        sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
      )).limit(1);
      if (!challenge || !challenge.normalizedPhone) {
        return void res.status(400).json({ error: "Invalid or expired code" });
      }
      if (!secureDigestEqual(challenge.otpHash, digest(`otp:${challenge.id}:${body.data.otp}`))) {
        const [attempted] = await db.update(phoneOtpChallengesTable)
          .set({ attempts: sql`${phoneOtpChallengesTable.attempts} + 1` })
          .where(and(
            eq(phoneOtpChallengesTable.id, challenge.id),
            eq(phoneOtpChallengesTable.purpose, "enrollment"),
            eq(phoneOtpChallengesTable.requestedBy, userId),
            isNull(phoneOtpChallengesTable.consumedAt),
            sql`${phoneOtpChallengesTable.expiresAt} > now()`,
            sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
          ))
          .returning({ attempts: phoneOtpChallengesTable.attempts });
        return void res.status(attempted?.attempts === MAX_ATTEMPTS ? 429 : 400).json({ error: "Invalid or expired code" });
      }
      await db.transaction(async tx => {
        const [consumed] = await tx.update(phoneOtpChallengesTable).set({ consumedAt: new Date() }).where(and(
          eq(phoneOtpChallengesTable.id, challenge.id),
          eq(phoneOtpChallengesTable.purpose, "enrollment"),
          eq(phoneOtpChallengesTable.requestedBy, userId),
          isNull(phoneOtpChallengesTable.consumedAt),
          sql`${phoneOtpChallengesTable.expiresAt} > now()`,
          sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
        )).returning({ id: phoneOtpChallengesTable.id });
        if (!consumed) throw new Error("Challenge already consumed");
        await tx.insert(phoneLoginIdentitiesTable).values({
          clerkUserId: userId,
          normalizedPhone: challenge.normalizedPhone!,
          firstName: challenge.firstName || "المالك",
        }).onConflictDoUpdate({
          target: phoneLoginIdentitiesTable.clerkUserId,
          set: { normalizedPhone: challenge.normalizedPhone!, firstName: challenge.firstName || "المالك", verifiedAt: new Date() },
        });
      });
      res.json(VerifyPhoneEnrollmentResponse.parse({ enrolled: true, phone: challenge.normalizedPhone }));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return void res.status(409).json({ error: "Phone already enrolled" });
      }
      next(error);
    }
  });

  return router;
}

export default createPhoneAuthRouter();
