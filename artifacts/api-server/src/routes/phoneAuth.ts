import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  db,
  branchesTable,
  guardiansTable,
  organizationsTable,
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
  ListPublicRegistrationBranchesResponse,
} from "@workspace/api-zod";
import { hashPassword, verifyPassword, signJwt, getLocalAuth } from "../lib/localAuth";
import { defaultBranchId } from "../lib/branchScope";

type Sender = (to: string, otp: string) => Promise<{ ok: true } | { ok: false; error: string }>;
type Identity = { accountId: string; firstName: string };

const OTP_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_PHONE = 4;
const MAX_PER_IP = 12;
const DEFAULT_REGISTRATION_RESPONSE_FLOOR_MS = 700;

function pepper() {
  const value = process.env.OTP_PEPPER || process.env.SESSION_SECRET;
  if (!value) throw new Error("OTP_PEPPER or SESSION_SECRET must be configured");
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

function normalizedDbPhone(column: typeof guardiansTable.phone | typeof staffTable.phone) {
  // Extract last 8 digits (local Kuwait number) from the stored phone,
  // then prepend '965' so it always matches the normalizeKuwaitPhone() output format.
  return sql`'965' || right(regexp_replace(${column}, '\\D', '', 'g'), 8)`;
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

async function isEnrollmentAdmin(accountId: string) {
  const [account] = await db.select().from(publicAuthAccountsTable)
    .where(eq(publicAuthAccountsTable.id, Number(accountId)))
    .limit(1);
  if (!account) return null;
  const role = account.role?.toLowerCase() || "";
  if (["owner", "superadmin", "admin", "nursery_admin"].includes(role)) return account;
  return (!account.ownerId && !account.staffId) ? account : null;
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
    branchId?: number | null;
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
        clerkUserId: options.identity?.accountId ?? null,
        firstName: options.identity?.firstName ?? null,
        fullName: options.fullName ?? null,
        email: options.email ?? null,
        accountType: options.accountType ?? null,
        requestedBy: options.requestedBy ?? null,
        branchId: options.branchId ?? null,
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

  // -------------------------------------------------------------------------
  // Registration: request OTP
  // -------------------------------------------------------------------------
  router.get("/auth/register/branches", async (_req, res, next) => {
    try {
      const publicOwnerId = await resolvePublicOwnerId();
      if (!publicOwnerId) {
        res.json({ organizations: [], branches: [] });
        return;
      }
      const [organizations, branches] = await Promise.all([
        db.select().from(organizationsTable).where(and(
          eq(organizationsTable.ownerId, publicOwnerId),
          eq(organizationsTable.active, true),
        )).orderBy(organizationsTable.id),
        db.select().from(branchesTable).where(and(
          eq(branchesTable.ownerId, publicOwnerId),
          eq(branchesTable.active, true),
        )).orderBy(branchesTable.id),
      ]);
      const organizationResponse = organizations.map(({ ownerId: _ownerId, settings: _settings, createdAt: _createdAt, ...row }) => row);
      const branchResponse = branches.map(({
        ownerId: _ownerId,
        settings: _settings,
        createdAt: _createdAt,
        legacyRecordId: _legacyRecordId,
        capacity: _capacity,
        ...row
      }) => row);
      res.json(ListPublicRegistrationBranchesResponse.parse({
        organizations: organizationResponse,
        branches: branchResponse,
      }));
    } catch (error) {
      next(error);
    }
  });

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
      if (body.data.branchId !== undefined) {
        const [branch] = publicOwnerId
          ? await db.select({ id: branchesTable.id }).from(branchesTable).where(and(
            eq(branchesTable.id, body.data.branchId),
            eq(branchesTable.ownerId, publicOwnerId),
            eq(branchesTable.active, true),
          )).limit(1)
          : [];
        if (!branch) return void res.status(400).json({ error: "Invalid branch" });
      }
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
        if (matchingGuardians.length === 1 && matchingGuardians[0].clerkUserId) {
          eligible = false; // already linked
        } else if (matchingGuardians.length > 1) {
          eligible = false; // ambiguous
        }
        // length === 0 → new guardian self-registration, stays eligible
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
      logger.info({ phone, eligible, publicOwnerId, existingCount: existing.length, accountType: body.data.accountType }, "registration eligibility");
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
        branchId: eligible ? body.data.branchId ?? null : null,
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

  // -------------------------------------------------------------------------
  // Registration: verify OTP + create account
  // -------------------------------------------------------------------------
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

      // Validate password
      if (!body.data.password || body.data.password.length < 4 || body.data.password.length > 15) {
        return void res.status(400).json({ code: "password_policy", error: "Password must be 4–15 characters" });
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
        if (guardianMatches.length === 1 && guardianMatches[0].clerkUserId) {
          return void res.status(409).json({ error: "Guardian record is already linked to another account" });
        }
        if (guardianMatches.length > 1) {
          return void res.status(409).json({ error: "Guardian phone is ambiguous; contact the nursery administration" });
        }
        // length === 0 → will create a new guardian record below
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

      const pwHash = await hashPassword(body.data.password);
      const status = "pending" as const;
      let ownerId: string | null = null;
      let guardianId: number | null = null;
      let staffId: number | null = null;
      let createdStaffId: number | null = null;

      try {
        if (accountType === "guardian") {
          if (guardianMatches.length === 1 && !guardianMatches[0].clerkUserId) {
            // Link existing guardian record
            const [linked] = await db.update(guardiansTable).set({ clerkUserId: `local_pending` }).where(and(
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
            // Self-registration: create a new guardian record
            const [created] = await db.insert(guardiansTable).values({
              ownerId: publicOwnerId,
              branchId: challenge.branchId ?? await defaultBranchId(db, publicOwnerId),
              name: challenge.fullName,
              email: challenge.email,
              phone: challenge.normalizedPhone,
              clerkUserId: `local_pending`,
            }).returning();
            ownerId = created.ownerId;
            guardianId = created.id;
          }
        } else {
          if (staffMatches.length === 1 && !staffMatches[0].clerkUserId &&
              ["unlinked", "pending_verification"].includes(staffMatches[0].accountStatus)) {
            const [linked] = await db.update(staffTable).set({
              clerkUserId: `local_pending`,
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
              branchId: challenge.branchId ?? await defaultBranchId(db, newStaffOwnerId),
              name: challenge.fullName,
              role: "pending",
              email: challenge.email,
              phone: challenge.normalizedPhone,
              clerkUserId: `local_pending`,
              accountStatus: "pending_verification",
            }).returning();
            createdStaffId = createdStaff.id;
            ownerId = createdStaff.ownerId;
            staffId = createdStaff.id;
          }
        }

        // Create local account
        const [account] = await db.insert(publicAuthAccountsTable).values({
          normalizedPhone: challenge.normalizedPhone,
          fullName: challenge.fullName,
          email: challenge.email,
          passwordHash: pwHash,
          accountType,
          accountStatus: status,
          role: "pending",
          ownerId,
          guardianId,
          staffId,
        }).returning();

        // Update guardian/staff with the account ID as reference
        const accountRef = `local_${account.id}`;
        if (guardianId) {
          await db.update(guardiansTable).set({ clerkUserId: accountRef })
            .where(eq(guardiansTable.id, guardianId));
        }
        if (staffId) {
          await db.update(staffTable).set({ clerkUserId: accountRef })
            .where(eq(staffTable.id, staffId));
        }

        const token = signJwt({ sub: String(account.id), role: "pending", ownerId });
        res.json(VerifyPublicRegistrationResponse.parse({ ticket: token, accountType, status }));
      } catch (error) {
        // Rollback
        await Promise.all([
          db.delete(publicAuthAccountsTable)
            .where(eq(publicAuthAccountsTable.normalizedPhone, challenge.normalizedPhone)),
          db.update(guardiansTable).set({ clerkUserId: null })
            .where(sql`${guardiansTable.clerkUserId} LIKE 'local_%'`),
          db.update(staffTable).set({ clerkUserId: null, accountStatus: "unlinked" })
            .where(and(
              sql`${staffTable.clerkUserId} LIKE 'local_%'`,
              eq(staffTable.accountStatus, "pending_verification"),
            )),
          createdStaffId
            ? db.delete(staffTable).where(eq(staffTable.id, createdStaffId))
            : Promise.resolve(),
        ]).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return void res.status(409).json({ error: "Phone or email is already registered" });
      }
      next(error);
    }
  });

  // -------------------------------------------------------------------------
  // Sign in with phone + password
  // -------------------------------------------------------------------------
  async function signInWithPhonePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const body = SignInWithPhonePasswordBody.safeParse(req.body);
      const phone = body.success ? normalizeKuwaitPhone(body.data.phone) : null;
      if (!body.success || !phone) return void res.status(400).json({ error: "Invalid Kuwait mobile number" });
      if (!await acceptPasswordAttempt(req, phone)) {
        return void res.status(429).json({ error: "Try again later" });
      }
      const publicOwnerId = await resolvePublicOwnerId();
      // Find account by phone
      const [account] = publicOwnerId
        ? await db.select().from(publicAuthAccountsTable).where(and(
          eq(publicAuthAccountsTable.normalizedPhone, phone),
          eq(publicAuthAccountsTable.ownerId, publicOwnerId),
        )).limit(1)
        : [];

      // Also check phone_login_identities for owner login
      const [ownerIdentity] = account || !publicOwnerId ? [] : await db.select({
        id: phoneLoginIdentitiesTable.id,
        clerkUserId: phoneLoginIdentitiesTable.clerkUserId,
      }).from(phoneLoginIdentitiesTable)
        .where(and(
          eq(phoneLoginIdentitiesTable.normalizedPhone, phone),
          eq(phoneLoginIdentitiesTable.clerkUserId, publicOwnerId),
        ))
        .limit(1);

      // If owner identity matched, find the owner's account
      let loginAccount = account;
      if (!loginAccount && ownerIdentity) {
        const [ownerAccount] = await db.select().from(publicAuthAccountsTable)
          .where(eq(publicAuthAccountsTable.ownerId, publicOwnerId))
          .limit(1);
        loginAccount = ownerAccount ?? null;
      }

      if (!loginAccount?.passwordHash) {
        return void res.status(401).json({ error: "Invalid phone or password" });
      }

      const valid = await verifyPassword(body.data.password, loginAccount.passwordHash);
      if (!valid) return void res.status(401).json({ error: "Invalid phone or password" });

      const token = signJwt({
        sub: String(loginAccount.id),
        role: loginAccount.role || "pending",
        ownerId: loginAccount.ownerId,
      });
      res.json(SignInWithPhonePasswordResponse.parse({ ticket: token }));
    } catch (error) { next(error); }
  }

  router.post("/auth/sign-in", signInWithPhonePassword);
  router.post("/auth/password-login", signInWithPhonePassword);

  // -------------------------------------------------------------------------
  // OTP phone login: request
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // OTP phone login: verify
  // -------------------------------------------------------------------------
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

      // challenge.clerkUserId holds the accountId reference
      const accountId = challenge.clerkUserId;
      const [account] = await db.select().from(publicAuthAccountsTable)
        .where(eq(publicAuthAccountsTable.id, Number(accountId)))
        .limit(1);
      if (!account) return void res.status(400).json({ error: "Account not found" });

      const token = signJwt({
        sub: String(account.id),
        role: account.role || "pending",
        ownerId: account.ownerId,
      });
      res.json(VerifyPhoneLoginResponse.parse({ ticket: token }));
    } catch (error) { next(error); }
  });

  // -------------------------------------------------------------------------
  // Phone enrollment: check
  // -------------------------------------------------------------------------
  router.get("/auth/phone/enrollment", async (req, res, next) => {
    try {
      const auth = getLocalAuth(req);
      if (!auth) return void res.status(401).json({ error: "Unauthorized" });
      const admin = await isEnrollmentAdmin(auth.sub);
      if (!admin) return void res.status(403).json({ error: "Administrative access required" });
      const [identity] = await db.select().from(phoneLoginIdentitiesTable)
        .where(eq(phoneLoginIdentitiesTable.clerkUserId, auth.sub)).limit(1);
      res.json(GetPhoneEnrollmentResponse.parse(identity
        ? { enrolled: true, phone: identity.normalizedPhone }
        : { enrolled: false }));
    } catch (error) { next(error); }
  });

  // -------------------------------------------------------------------------
  // Phone enrollment: request
  // -------------------------------------------------------------------------
  router.post("/auth/phone/enrollment/request", async (req, res, next) => {
    try {
      const auth = getLocalAuth(req);
      if (!auth) return void res.status(401).json({ error: "Unauthorized" });
      const account = await isEnrollmentAdmin(auth.sub);
      if (!account) return void res.status(403).json({ error: "Administrative access required" });
      const body = RequestPhoneLoginBody.safeParse(req.body);
      const phone = body.success ? normalizeKuwaitPhone(body.data.phone) : null;
      if (!phone) return void res.status(400).json({ error: "Invalid Kuwait mobile number" });
      const existing = await resolveIdentity(phone);
      if (existing && existing.accountId !== auth.sub) return void res.status(409).json({ error: "Phone already enrolled" });
      const name = firstName(account.fullName || "المالك");
      const challenge = await createChallenge(req, {
        purpose: "enrollment", phone, identity: { accountId: auth.sub, firstName: name }, requestedBy: auth.sub,
      });
      if (!challenge) return void res.status(429).json({ error: "Try again later" });
      res.json(RequestPhoneLoginResponse.parse({ challengeId: challenge.id, expiresInSeconds: OTP_SECONDS, recognized: true, firstName: name }));
    } catch (error) { next(error); }
  });

  // -------------------------------------------------------------------------
  // Phone enrollment: verify
  // -------------------------------------------------------------------------
  router.post("/auth/phone/enrollment/verify", async (req, res, next) => {
    try {
      const auth = getLocalAuth(req);
      if (!auth) return void res.status(401).json({ error: "Unauthorized" });
      if (!await isEnrollmentAdmin(auth.sub)) return void res.status(403).json({ error: "Administrative access required" });
      const body = VerifyPhoneLoginBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid challenge" });
      const [challenge] = await db.select().from(phoneOtpChallengesTable).where(and(
        eq(phoneOtpChallengesTable.id, body.data.challengeId),
        eq(phoneOtpChallengesTable.purpose, "enrollment"),
        eq(phoneOtpChallengesTable.requestedBy, auth.sub),
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
            eq(phoneOtpChallengesTable.requestedBy, auth.sub),
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
          eq(phoneOtpChallengesTable.requestedBy, auth.sub),
          isNull(phoneOtpChallengesTable.consumedAt),
          sql`${phoneOtpChallengesTable.expiresAt} > now()`,
          sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
        )).returning({ id: phoneOtpChallengesTable.id });
        if (!consumed) throw new Error("Challenge already consumed");
        await tx.insert(phoneLoginIdentitiesTable).values({
          clerkUserId: auth.sub,
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

  // -------------------------------------------------------------------------
  // Test seed: create / delete test accounts (development & test only)
  // -------------------------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    router.post("/auth/test-seed", async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { phone, password, fullName, email, role } = req.body as {
          phone?: string; password?: string; fullName?: string; email?: string; role?: string;
        };
        if (!phone || !password) return void res.status(400).json({ error: "phone and password required" });
        const normalizedPhone = normalizeKuwaitPhone(phone) || phone;
        const existing = await db.select({ id: publicAuthAccountsTable.id }).from(publicAuthAccountsTable)
          .where(eq(publicAuthAccountsTable.normalizedPhone, normalizedPhone)).limit(1);
        if (existing.length) return void res.json({ ok: true, message: "already exists" });
        const pwHash = await hashPassword(password);
        const publicOwnerId = await resolvePublicOwnerId();
        const [account] = await db.insert(publicAuthAccountsTable).values({
          normalizedPhone,
          fullName: fullName || "Test User",
          email: email || `test-${normalizedPhone}@example.com`,
          passwordHash: pwHash,
          accountType: "staff",
          accountStatus: "active",
          role: role || "admin",
          ownerId: publicOwnerId,
        }).returning();
        res.json({ ok: true, accountId: account.id });
      } catch (error) { next(error); }
    });

    router.delete("/auth/test-seed", async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { phone } = req.body as { phone?: string };
        if (!phone) return void res.status(400).json({ error: "phone required" });
        const normalizedPhone = normalizeKuwaitPhone(phone) || phone;
        await db.delete(publicAuthAccountsTable)
          .where(eq(publicAuthAccountsTable.normalizedPhone, normalizedPhone));
        res.json({ ok: true });
      } catch (error) { next(error); }
    });
  }

  return router;
}

async function resolveIdentity(phone: string): Promise<Identity | null> {
  const owners = await db.select().from(phoneLoginIdentitiesTable)
    .where(eq(phoneLoginIdentitiesTable.normalizedPhone, phone));
  return owners.length === 1
    ? { accountId: owners[0].clerkUserId, firstName: owners[0].firstName }
    : null;
}

export default createPhoneAuthRouter();
