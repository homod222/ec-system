import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  db,
  guardiansTable,
  pool,
  phoneLoginIdentitiesTable,
  phoneOtpChallengesTable,
  publicAuthAccountsTable,
  nurserySettingsTable,
  staffTable,
} from "@workspace/db";
import {
  RequestPublicRegistrationBody,
  RequestPublicRegistrationResponse,
  VerifyPublicRegistrationBody,
  VerifyPublicRegistrationResponse,
  SignInWithPhonePasswordBody,
  SignInWithPhonePasswordResponse,
  RequestPhoneLoginBody,
  VerifyPhoneLoginBody,
  RequestPhoneLoginResponse,
  VerifyPhoneLoginResponse,
  GetPhoneEnrollmentResponse,
} from "@workspace/api-zod";

type Sender = (to: string, otp: string) => Promise<{ ok: true } | { ok: false; error: string }>;
type Identity = { clerkUserId: string; firstName: string };

const OTP_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_PHONE = 4;
const MAX_PER_IP = 12;
const DEFAULT_REGISTRATION_RESPONSE_FLOOR_MS = 700;

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

function registrationResponseFloorMs() {
  const configured = Number(process.env.REGISTRATION_RESPONSE_FLOOR_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return process.env.NODE_ENV === "test" ? 20 : DEFAULT_REGISTRATION_RESPONSE_FLOOR_MS;
}

function clerkRegistrationErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("errors" in error)) return null;
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;
  for (const item of errors) {
    if (typeof item === "object" && item !== null && "code" in item && typeof item.code === "string") {
      if (item.code.includes("password")) return "password_policy";
      if (item.code.includes("identifier") || item.code.includes("email")) return "email_exists";
    }
  }
  return "identity_provider_rejected";
}

async function resolveIdentity(phone: string): Promise<Identity | null> {
  const owners = await db.select().from(phoneLoginIdentitiesTable)
    .where(eq(phoneLoginIdentitiesTable.normalizedPhone, phone));
  return owners.length === 1
    ? { clerkUserId: owners[0].clerkUserId, firstName: owners[0].firstName }
    : null;
}

function normalizedDbPhone(column: typeof guardiansTable.phone | typeof staffTable.phone) {
  return sql`
    CASE
      WHEN regexp_replace(${column}, '\\D', '', 'g') LIKE '00965%'
        THEN '965' || substring(regexp_replace(${column}, '\\D', '', 'g') FROM 6)
      WHEN regexp_replace(${column}, '\\D', '', 'g') LIKE '965%'
        AND length(regexp_replace(${column}, '\\D', '', 'g')) > 8
        THEN regexp_replace(${column}, '\\D', '', 'g')
      ELSE '965' || ltrim(regexp_replace(${column}, '\\D', '', 'g'), '0')
    END`;
}

async function resolvePublicOwnerId(): Promise<string | null> {
  const configured = process.env.PUBLIC_SITE_OWNER_ID?.trim();
  if (configured) return configured;
  const nurseries = await db.select({ ownerId: nurserySettingsTable.ownerId })
    .from(nurserySettingsTable)
    .groupBy(nurserySettingsTable.ownerId)
    .limit(2);
  return nurseries.length === 1 ? nurseries[0].ownerId : null;
}

async function resolveLegacyPublicClerkUserId(phone: string): Promise<string | null> {
  const ownerId = await resolvePublicOwnerId();
  if (!ownerId) return null;
  const result = await pool.query<{ clerk_user_id: string }>(`
    SELECT DISTINCT clerk_user_id
    FROM (
      SELECT clerk_user_id
      FROM guardians
      WHERE owner_id = $1
        AND clerk_user_id IS NOT NULL
        AND CASE
          WHEN regexp_replace(phone, '\\D', '', 'g') LIKE '00965%'
            THEN '965' || substring(regexp_replace(phone, '\\D', '', 'g') FROM 6)
          WHEN regexp_replace(phone, '\\D', '', 'g') LIKE '965%'
            AND length(regexp_replace(phone, '\\D', '', 'g')) > 8
            THEN regexp_replace(phone, '\\D', '', 'g')
          ELSE '965' || ltrim(regexp_replace(phone, '\\D', '', 'g'), '0')
        END = $2
      UNION ALL
      SELECT clerk_user_id
      FROM staff
      WHERE owner_id = $1
        AND account_status = 'active'
        AND clerk_user_id IS NOT NULL
        AND CASE
          WHEN regexp_replace(phone, '\\D', '', 'g') LIKE '00965%'
            THEN '965' || substring(regexp_replace(phone, '\\D', '', 'g') FROM 6)
          WHEN regexp_replace(phone, '\\D', '', 'g') LIKE '965%'
            AND length(regexp_replace(phone, '\\D', '', 'g')) > 8
            THEN regexp_replace(phone, '\\D', '', 'g')
          ELSE '965' || ltrim(regexp_replace(phone, '\\D', '', 'g'), '0')
        END = $2
    ) candidates
    LIMIT 2
  `, [ownerId, phone]);
  return result.rows.length === 1 ? result.rows[0].clerk_user_id : null;
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
    purpose: "login" | "enrollment" | "registration";
    phone: string;
    identity: Identity | null;
    deliver?: boolean;
    backgroundDelivery?: boolean;
    requestedBy?: string;
    fullName?: string;
    email?: string;
    accountType?: "guardian" | "staff";
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
        normalizedPhone: options.purpose === "login" || options.deliver === false ? null : options.phone,
        ipHash,
        otpHash: digest(`otp:${id}:${otp}`),
        clerkUserId: options.identity?.clerkUserId ?? null,
        firstName: options.identity?.firstName ?? null,
        fullName: options.fullName ?? null,
        email: options.email ?? null,
        accountType: options.accountType ?? null,
        requestedBy: options.requestedBy ?? null,
        expiresAt: new Date(Date.now() + OTP_SECONDS * 1000),
      });
      return true;
    });
    if (!inserted) return null;
    if (options.deliver !== false && (options.identity || options.purpose !== "login")) {
      const deliver = async () => {
        try {
          const result = await sender(options.phone, otp);
          if (!result.ok) {
            await db.delete(phoneOtpChallengesTable).where(eq(phoneOtpChallengesTable.id, id));
          }
        } catch {
          await db.delete(phoneOtpChallengesTable).where(eq(phoneOtpChallengesTable.id, id)).catch(() => undefined);
        }
      };
      if (options.backgroundDelivery) {
        void deliver();
      } else {
        const result = await sender(options.phone, otp);
        if (!result.ok) {
          await db.delete(phoneOtpChallengesTable).where(eq(phoneOtpChallengesTable.id, id));
          throw new Error("WhatsApp delivery failed");
        }
      }
    }
    return { id, otp };
  }

  async function acceptPasswordAttempt(req: Request, phone: string) {
    const id = randomUUID();
    const phoneHash = digest(`phone:${phone}`);
    const ipHash = digest(`ip:${requestIp(req)}`);
    const since = new Date(Date.now() - WINDOW_MS);
    return db.transaction(async tx => {
      for (const lockKey of [`password-phone:${phoneHash}`, `password-ip:${ipHash}`].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);
      }
      const [phoneAttempts, ipAttempts] = await Promise.all([
        tx.select({ id: phoneOtpChallengesTable.id }).from(phoneOtpChallengesTable).where(and(
          eq(phoneOtpChallengesTable.purpose, "password_login"),
          eq(phoneOtpChallengesTable.normalizedPhoneHash, phoneHash),
          gte(phoneOtpChallengesTable.createdAt, since),
        )).limit(MAX_PER_PHONE),
        tx.select({ id: phoneOtpChallengesTable.id }).from(phoneOtpChallengesTable).where(and(
          eq(phoneOtpChallengesTable.purpose, "password_login"),
          eq(phoneOtpChallengesTable.ipHash, ipHash),
          gte(phoneOtpChallengesTable.createdAt, since),
        )).limit(MAX_PER_IP),
      ]);
      if (phoneAttempts.length >= MAX_PER_PHONE || ipAttempts.length >= MAX_PER_IP) return false;
      await tx.insert(phoneOtpChallengesTable).values({
        id,
        purpose: "password_login",
        normalizedPhoneHash: phoneHash,
        ipHash,
        otpHash: digest(`password-attempt:${id}`),
        expiresAt: new Date(Date.now() + WINDOW_MS),
        consumedAt: new Date(),
      });
      return true;
    });
  }

  router.post("/auth/register/request", async (req, res, next) => {
    try {
      const body = RequestPublicRegistrationBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Valid phone, triple full name, email, and account type are required" });
      const phone = normalizeKuwaitPhone(body.data.phone);
      if (!phone) return void res.status(400).json({ error: "Invalid Kuwait mobile number" });
      const responseStartedAt = Date.now();
      const fullName = body.data.fullName.trim().replace(/\s+/gu, " ");
      const email = body.data.email.trim().toLowerCase();
      const publicOwnerId = await resolvePublicOwnerId();
      const existing = await db.select({ id: publicAuthAccountsTable.id }).from(publicAuthAccountsTable)
        .where(sql`${publicAuthAccountsTable.normalizedPhone} = ${phone} or lower(${publicAuthAccountsTable.email}) = ${email}`)
        .limit(1);
      let eligible = Boolean(publicOwnerId) && existing.length === 0;
      if (eligible && publicOwnerId && body.data.accountType === "guardian") {
        const matchingGuardians = await db.select({
          clerkUserId: guardiansTable.clerkUserId,
        }).from(guardiansTable)
          .where(and(
            eq(guardiansTable.ownerId, publicOwnerId),
            eq(normalizedDbPhone(guardiansTable.phone), phone),
          ))
          .limit(2);
        if (matchingGuardians.length !== 1 || matchingGuardians[0].clerkUserId) {
          eligible = false;
        }
      } else if (eligible && publicOwnerId) {
        const matchingStaff = await db.select({ id: staffTable.id }).from(staffTable)
          .where(and(
            eq(staffTable.ownerId, publicOwnerId),
            eq(normalizedDbPhone(staffTable.phone), phone),
          ))
          .limit(2);
        if (matchingStaff.length > 1) {
          eligible = false;
        }
        if (eligible && matchingStaff.length === 1) {
          const [member] = await db.select({
            clerkUserId: staffTable.clerkUserId,
            accountStatus: staffTable.accountStatus,
          }).from(staffTable).where(eq(staffTable.id, matchingStaff[0].id)).limit(1);
          if (!member || member.clerkUserId || !["unlinked", "pending_verification"].includes(member.accountStatus)) {
            eligible = false;
          }
        }
      }
      const challenge = await createChallenge(req, {
        purpose: "registration",
        phone,
        identity: null,
        deliver: eligible,
        backgroundDelivery: eligible,
        fullName: eligible ? fullName : undefined,
        email: eligible ? email : undefined,
        accountType: eligible ? body.data.accountType : undefined,
        requestedBy: eligible ? publicOwnerId ?? undefined : undefined,
      });
      if (!challenge) return void res.status(429).json({ error: "Try again later" });
      const remainingDelay = registrationResponseFloorMs() - (Date.now() - responseStartedAt);
      if (remainingDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingDelay));
      }
      res.json(RequestPublicRegistrationResponse.parse({
        challengeId: challenge.id,
        expiresInSeconds: OTP_SECONDS,
      }));
    } catch (error) { next(error); }
  });

  router.post("/auth/register/verify", async (req, res, next) => {
    try {
      const body = VerifyPublicRegistrationBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid verification details" });
      const [challenge] = await db.select().from(phoneOtpChallengesTable).where(and(
        eq(phoneOtpChallengesTable.id, body.data.challengeId),
        eq(phoneOtpChallengesTable.purpose, "registration"),
        isNull(phoneOtpChallengesTable.consumedAt),
        sql`${phoneOtpChallengesTable.expiresAt} > now()`,
        sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
      )).limit(1);
      if (!challenge?.normalizedPhone || !challenge.fullName || !challenge.email ||
          !["guardian", "staff"].includes(challenge.accountType ?? "")) {
        return void res.status(400).json({ error: "Invalid or expired code" });
      }
      const publicOwnerId = await resolvePublicOwnerId();
      if (!publicOwnerId || challenge.requestedBy !== publicOwnerId) {
        return void res.status(409).json({ error: "Registration is unavailable; contact the nursery administration" });
      }
      if (!secureDigestEqual(challenge.otpHash, digest(`otp:${challenge.id}:${body.data.otp}`))) {
        const [attempted] = await db.update(phoneOtpChallengesTable)
          .set({ attempts: sql`${phoneOtpChallengesTable.attempts} + 1` })
          .where(and(
            eq(phoneOtpChallengesTable.id, challenge.id),
            isNull(phoneOtpChallengesTable.consumedAt),
            sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
          )).returning({ attempts: phoneOtpChallengesTable.attempts });
        return void res.status(attempted?.attempts === MAX_ATTEMPTS ? 429 : 400)
          .json({ error: "Invalid or expired code" });
      }
      const accountType = challenge.accountType as "guardian" | "staff";
      let guardianMatches: (typeof guardiansTable.$inferSelect)[] = [];
      let staffMatches: (typeof staffTable.$inferSelect)[] = [];
      let newStaffOwnerId: string | null = null;
      if (accountType === "guardian") {
        guardianMatches = await db.select().from(guardiansTable).where(
          and(
            eq(guardiansTable.ownerId, publicOwnerId),
            eq(normalizedDbPhone(guardiansTable.phone), challenge.normalizedPhone),
          ),
        ).limit(2);
        if (guardianMatches.length !== 1 || guardianMatches[0].clerkUserId) {
          return void res.status(409).json({ error: "Guardian record is unavailable; contact the nursery administration" });
        }
      } else {
        staffMatches = await db.select().from(staffTable).where(
          and(
            eq(staffTable.ownerId, publicOwnerId),
            eq(normalizedDbPhone(staffTable.phone), challenge.normalizedPhone),
          ),
        ).limit(2);
        if (staffMatches.length > 1) {
          return void res.status(409).json({ error: "Staff phone is ambiguous; contact the nursery administration" });
        }
        if (staffMatches.length === 1) {
          if (staffMatches[0].clerkUserId ||
              !["unlinked", "pending_verification"].includes(staffMatches[0].accountStatus)) {
            return void res.status(409).json({ error: "Staff record is unavailable; contact the nursery administration" });
          }
        } else {
          newStaffOwnerId = publicOwnerId;
        }
      }
      const [consumed] = await db.update(phoneOtpChallengesTable).set({ consumedAt: new Date() }).where(and(
        eq(phoneOtpChallengesTable.id, challenge.id),
        eq(phoneOtpChallengesTable.purpose, "registration"),
        isNull(phoneOtpChallengesTable.consumedAt),
        sql`${phoneOtpChallengesTable.expiresAt} > now()`,
      )).returning({ id: phoneOtpChallengesTable.id });
      if (!consumed) return void res.status(409).json({ error: "Registration is already being completed" });

      const names = challenge.fullName.split(/\s+/u);
      let created;
      try {
        created = await clerkClient.users.createUser({
          emailAddress: [challenge.email],
          password: body.data.password,
          firstName: names[0],
          lastName: names.slice(1).join(" "),
          publicMetadata: { role: "pending", accountStatus: "pending" },
        });
      } catch (error) {
        await db.update(phoneOtpChallengesTable).set({ consumedAt: null }).where(and(
          eq(phoneOtpChallengesTable.id, challenge.id),
          eq(phoneOtpChallengesTable.purpose, "registration"),
          sql`${phoneOtpChallengesTable.consumedAt} is not null`,
          sql`${phoneOtpChallengesTable.expiresAt} > now()`,
        ));
        const clerkErrorCode = clerkRegistrationErrorCode(error);
        if (clerkErrorCode === "password_policy") {
          return void res.status(400).json({
            code: clerkErrorCode,
            error: "Password must be 4–15 characters",
          });
        }
        if (clerkErrorCode === "email_exists") {
          return void res.status(409).json({
            code: clerkErrorCode,
            error: "Email is already registered",
          });
        }
        if (clerkErrorCode) {
          return void res.status(422).json({
            code: clerkErrorCode,
            error: "The identity provider rejected the registration",
          });
        }
        throw error;
      }
      const status = "pending" as const;
      let ownerId: string | null = null;
      let guardianId: number | null = null;
      let staffId: number | null = null;
      let createdStaffId: number | null = null;
      try {
        if (accountType === "guardian") {
          const [linked] = await db.update(guardiansTable).set({ clerkUserId: created.id }).where(and(
            eq(guardiansTable.id, guardianMatches[0].id),
            eq(guardiansTable.ownerId, publicOwnerId),
            sql`${guardiansTable.clerkUserId} is null`,
          )).returning();
          if (!linked) {
            throw new Error("Guardian record was linked concurrently");
          }
          ownerId = linked.ownerId;
          guardianId = linked.id;
        } else {
          if (staffMatches.length === 1 && !staffMatches[0].clerkUserId &&
              ["unlinked", "pending_verification"].includes(staffMatches[0].accountStatus)) {
            const [linked] = await db.update(staffTable).set({
              clerkUserId: created.id,
              accountStatus: "pending_verification",
              otpHash: null,
              otpExpiresAt: null,
              otpAttempts: 0,
            }).where(and(
              eq(staffTable.id, staffMatches[0].id),
              eq(staffTable.ownerId, publicOwnerId),
              sql`${staffTable.clerkUserId} is null`,
            )).returning();
            if (linked) {
              ownerId = linked.ownerId;
              staffId = linked.id;
            } else {
              throw new Error("Staff record was linked concurrently");
            }
          } else if (staffMatches.length === 0 && newStaffOwnerId) {
            const [createdStaff] = await db.insert(staffTable).values({
              ownerId: newStaffOwnerId,
              name: challenge.fullName,
              role: "pending",
              email: challenge.email,
              phone: challenge.normalizedPhone,
              clerkUserId: created.id,
              accountStatus: "pending_verification",
            }).returning();
            createdStaffId = createdStaff.id;
            ownerId = createdStaff.ownerId;
            staffId = createdStaff.id;
          }
        }
        await db.insert(publicAuthAccountsTable).values({
          normalizedPhone: challenge.normalizedPhone,
          clerkUserId: created.id,
          fullName: challenge.fullName,
          email: challenge.email,
          accountType,
          accountStatus: status,
          ownerId,
          guardianId,
          staffId,
        });
        await clerkClient.users.updateUserMetadata(created.id, {
          publicMetadata: { role: "pending", ownerId, accountStatus: "pending" },
          privateMetadata: staffId ? { staffId } : {},
        });
      } catch (error) {
        await Promise.all([
          db.delete(publicAuthAccountsTable)
            .where(eq(publicAuthAccountsTable.clerkUserId, created.id)),
          db.update(guardiansTable).set({ clerkUserId: null })
            .where(eq(guardiansTable.clerkUserId, created.id)),
          db.update(staffTable).set({ clerkUserId: null, accountStatus: "unlinked" })
            .where(and(
              eq(staffTable.clerkUserId, created.id),
              eq(staffTable.accountStatus, "pending_verification"),
            )),
          createdStaffId
            ? db.delete(staffTable).where(eq(staffTable.id, createdStaffId))
            : Promise.resolve(),
        ]).catch(() => undefined);
        await clerkClient.users.deleteUser(created.id).catch(() => undefined);
        throw error;
      }
      const token = await clerkClient.signInTokens.createSignInToken({ userId: created.id, expiresInSeconds: 60 });
      res.json(VerifyPublicRegistrationResponse.parse({ ticket: token.token, accountType, status }));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return void res.status(409).json({ error: "Phone or email is already registered" });
      }
      next(error);
    }
  });

  async function signInWithPhonePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const body = SignInWithPhonePasswordBody.safeParse(req.body);
      const phone = body.success ? normalizeKuwaitPhone(body.data.phone) : null;
      if (!body.success || !phone) return void res.status(400).json({ error: "Invalid Kuwait mobile number" });
      if (!await acceptPasswordAttempt(req, phone)) {
        return void res.status(429).json({ error: "Try again later" });
      }
      const publicOwnerId = await resolvePublicOwnerId();
      const [account] = publicOwnerId
        ? await db.select().from(publicAuthAccountsTable).where(and(
          eq(publicAuthAccountsTable.normalizedPhone, phone),
          eq(publicAuthAccountsTable.ownerId, publicOwnerId),
        )).limit(1)
        : [];
      const [ownerIdentity] = account || !publicOwnerId ? [] : await db.select({
        clerkUserId: phoneLoginIdentitiesTable.clerkUserId,
      }).from(phoneLoginIdentitiesTable)
        .where(and(
          eq(phoneLoginIdentitiesTable.normalizedPhone, phone),
          eq(phoneLoginIdentitiesTable.clerkUserId, publicOwnerId),
        ))
        .limit(1);
      const clerkUserId = account?.clerkUserId
        ?? ownerIdentity?.clerkUserId
        ?? await resolveLegacyPublicClerkUserId(phone);
      if (!clerkUserId) return void res.status(401).json({ error: "Invalid phone or password" });
      try {
        await clerkClient.users.verifyPassword({ userId: clerkUserId, password: body.data.password });
      } catch {
        return void res.status(401).json({ error: "Invalid phone or password" });
      }
      const token = await clerkClient.signInTokens.createSignInToken({
        userId: clerkUserId,
        expiresInSeconds: 60,
      });
      res.json(SignInWithPhonePasswordResponse.parse({ ticket: token.token }));
    } catch (error) { next(error); }
  }

  router.post("/auth/sign-in", signInWithPhonePassword);
  router.post("/auth/password-login", signInWithPhonePassword);

  router.post("/auth/phone/request", async (req, res, next) => {
    try {
      const body = RequestPhoneLoginBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid phone" });
      const phone = normalizeKuwaitPhone(body.data.phone);
      if (!phone) return void res.status(400).json({ error: "Invalid Kuwait mobile number" });
      const identity = await resolveIdentity(phone);
      const challenge = await createChallenge(req, { purpose: "login", phone, identity });
      if (!challenge) return void res.status(429).json({ error: "Try again later" });
      res.json(RequestPhoneLoginResponse.parse({
        challengeId: challenge.id,
        expiresInSeconds: OTP_SECONDS,
        recognized: Boolean(identity),
        ...(identity ? { firstName: identity.firstName } : {}),
      }));
    } catch (error) { next(error); }
  });

  router.post("/auth/phone/verify", async (req, res, next) => {
    try {
      const body = VerifyPhoneLoginBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid challenge" });
      const [challenge] = await db.select().from(phoneOtpChallengesTable).where(and(
        eq(phoneOtpChallengesTable.id, body.data.challengeId),
        eq(phoneOtpChallengesTable.purpose, "login"),
        isNull(phoneOtpChallengesTable.consumedAt),
        sql`${phoneOtpChallengesTable.expiresAt} > now()`,
        sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
      )).limit(1);
      if (!challenge || !challenge.clerkUserId) {
        return void res.status(400).json({ error: "Invalid or expired code" });
      }
      if (!secureDigestEqual(challenge.otpHash, digest(`otp:${challenge.id}:${body.data.otp}`))) {
        const [attempted] = await db.update(phoneOtpChallengesTable)
          .set({ attempts: sql`${phoneOtpChallengesTable.attempts} + 1` })
          .where(and(
            eq(phoneOtpChallengesTable.id, challenge.id),
            eq(phoneOtpChallengesTable.purpose, "login"),
            isNull(phoneOtpChallengesTable.consumedAt),
            sql`${phoneOtpChallengesTable.expiresAt} > now()`,
            sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
          ))
          .returning({ attempts: phoneOtpChallengesTable.attempts });
        return void res.status(attempted?.attempts === MAX_ATTEMPTS ? 429 : 400).json({ error: "Invalid or expired code" });
      }
      const [consumed] = await db.update(phoneOtpChallengesTable).set({ consumedAt: new Date() }).where(and(
        eq(phoneOtpChallengesTable.id, challenge.id),
        eq(phoneOtpChallengesTable.purpose, "login"),
        isNull(phoneOtpChallengesTable.consumedAt),
        sql`${phoneOtpChallengesTable.expiresAt} > now()`,
        sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
      )).returning({ id: phoneOtpChallengesTable.id });
      if (!consumed) return void res.status(400).json({ error: "Invalid or expired code" });
      const signInTokens = clerkClient.signInTokens as unknown as {
        createSignInToken(input: { userId: string; expiresInSeconds: number }): Promise<{ token: string }>;
      };
      const token = await signInTokens.createSignInToken({ userId: challenge.clerkUserId, expiresInSeconds: 60 });
      res.json(VerifyPhoneLoginResponse.parse({ ticket: token.token }));
    } catch (error) { next(error); }
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
      const body = RequestPhoneLoginBody.safeParse(req.body);
      const phone = body.success ? normalizeKuwaitPhone(body.data.phone) : null;
      if (!phone) return void res.status(400).json({ error: "Invalid Kuwait mobile number" });
      const existing = await resolveIdentity(phone);
      if (existing && existing.clerkUserId !== userId) return void res.status(409).json({ error: "Phone already enrolled" });
      const name = firstName(user.firstName || "المالك");
      const challenge = await createChallenge(req, {
        purpose: "enrollment", phone, identity: { clerkUserId: userId, firstName: name }, requestedBy: userId,
      });
      if (!challenge) return void res.status(429).json({ error: "Try again later" });
      res.json(RequestPhoneLoginResponse.parse({ challengeId: challenge.id, expiresInSeconds: OTP_SECONDS, recognized: true, firstName: name }));
    } catch (error) { next(error); }
  });

  router.post("/auth/phone/enrollment/verify", async (req, res, next) => {
    try {
      const userId = getAuth(req).userId;
      if (!userId) return void res.status(401).json({ error: "Unauthorized" });
      if (!await isEnrollmentAdmin(userId)) return void res.status(403).json({ error: "Administrative access required" });
      const body = VerifyPhoneLoginBody.safeParse(req.body);
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
      res.json(GetPhoneEnrollmentResponse.parse({ enrolled: true, phone: challenge.normalizedPhone }));
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
