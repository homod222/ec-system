import { Router, type IRouter, type Request } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  ApproveStaffRegistrationBody, ApproveStaffRegistrationParams,
  CompleteGuardianRegistrationBody, CompleteStaffRegistrationBody,
  CompletePasswordResetBody, RequestGuardianRegistrationBody,
  RequestPasswordResetBody, RequestStaffRegistrationBody, PasswordLoginBody,
} from "@workspace/api-zod";
import { auditLogsTable, db, guardianRegistrationClaimsTable, guardiansTable, passwordLoginAttemptsTable, phoneLoginIdentitiesTable, phoneOtpChallengesTable, staffTable } from "@workspace/db";
import { normalizeKuwaitPhone } from "./phoneAuth";
import { sendWhatsAppOtp } from "../lib/notifications";

const EXPIRY_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const staffRoles = new Set(["admin", "manager", "supervisor", "teacher", "accountant", "receptionist"]);
type Purpose = "guardian_registration" | "staff_registration" | "password_reset";
type ResetIdentity = {
  userId: string;
  phone: string | null;
  type: "staff" | "guardian" | "alias" | "clerk_phone";
  id: number | string;
};

function publicOwnerId() {
  const ownerId = process.env.PUBLIC_SITE_OWNER_ID?.trim();
  if (!ownerId) throw new Error("PUBLIC_SITE_OWNER_ID must be configured for public registration");
  return ownerId;
}
function pepper() {
  const value = process.env.OTP_PEPPER || process.env.CLERK_SECRET_KEY;
  if (!value) throw new Error("OTP_PEPPER or CLERK_SECRET_KEY must be configured");
  return value;
}
function digest(value: string) { return createHash("sha256").update(`${pepper()}:${value}`).digest("hex"); }
function matches(expected: string, value: string) {
  const a = Buffer.from(expected, "hex"); const b = Buffer.from(value, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
function nameParts(name: string) {
  const values = name.trim().split(/\s+/u);
  return { firstName: values[0] || "User", lastName: values.slice(1).join(" ") || undefined };
}
function clientIp(req: Request) { return req.ip || req.socket.remoteAddress || "unknown"; }
function hasThreeNames(name: string) { return name.trim().split(/\s+/u).filter(Boolean).length >= 3; }
function isTenantActiveUser(user: { id: string; publicMetadata: unknown }, ownerId: string) {
  const metadata = user.publicMetadata as Record<string, unknown>;
  const role = String(metadata.role || "").toLowerCase();
  const scopedOwner = metadata.ownerId ?? metadata.owner_id;
  return (user.id === ownerId && role === "owner") ||
    (scopedOwner === ownerId && metadata.accountStatus === "active");
}
function verifiedKuwaitPhones(user: unknown) {
  const candidate = user as {
    phoneNumbers?: Array<{
      phoneNumber?: string;
      verification?: { status?: string } | null;
    }>;
  };
  return Array.from(new Set((candidate.phoneNumbers || [])
    .filter(entry => entry.verification?.status === "verified")
    .map(entry => normalizeKuwaitPhone(entry.phoneNumber || ""))
    .filter((phone): phone is string => Boolean(phone))));
}
async function clerkUsersForEmail(email: string) {
  const users = clerkClient.users as unknown as {
    getUserList(input: { emailAddress: string[]; limit: number }): Promise<{ data: Array<{ id: string; publicMetadata: unknown; privateMetadata?: unknown }> }>;
  };
  const result = await users.getUserList({ emailAddress: [email], limit: 2 });
  return result.data;
}
async function validatedAliasUserIds(aliases: Array<{ userId: string }>, ownerId: string) {
  const ids = Array.from(new Set(aliases.map(alias => alias.userId)));
  const users = await Promise.all(ids.map(async id => {
    try { return await clerkClient.users.getUser(id); } catch { return null; }
  }));
  return users.filter((user): user is NonNullable<typeof user> => Boolean(user) && isTenantActiveUser(user!, ownerId)).map(user => user.id);
}
async function reservePasswordLoginAttempt(req: Request, identifier: string) {
  const ipHash = digest(`ip:${clientIp(req)}`); const identifierHash = digest(`identifier:${identifier}`);
  return db.transaction(async tx => {
    for (const key of [`password-login:identifier:${identifierHash}`, `password-login:ip:${ipHash}`].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key})::bigint)`);
    }
    const since = new Date(Date.now() - 15 * 60_000);
    const [byIp, byIdentifier] = await Promise.all([
      tx.select({ id: passwordLoginAttemptsTable.id }).from(passwordLoginAttemptsTable).where(and(eq(passwordLoginAttemptsTable.ipHash, ipHash), sql`${passwordLoginAttemptsTable.createdAt} >= ${since}`)).limit(20),
      tx.select({ id: passwordLoginAttemptsTable.id }).from(passwordLoginAttemptsTable).where(and(eq(passwordLoginAttemptsTable.identifierHash, identifierHash), sql`${passwordLoginAttemptsTable.createdAt} >= ${since}`)).limit(8),
    ]);
    if (byIp.length >= 20 || byIdentifier.length >= 8) return false;
    await tx.insert(passwordLoginAttemptsTable).values({ ipHash, identifierHash });
    return true;
  });
}
async function reserveStaffRegistrationAttempt(req: Request, email: string, phone: string) {
  const ipHash = digest(`staff-registration:ip:${clientIp(req)}`);
  const keys = [digest(`staff-registration:email:${email}`), digest(`staff-registration:phone:${phone}`)];
  return db.transaction(async tx => {
    for (const key of [`staff-rate:ip:${ipHash}`, ...keys.map(key => `staff-rate:id:${key}`)].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key})::bigint)`);
    const since = new Date(Date.now() - 15 * 60_000);
    const [ip, emailRows, phoneRows] = await Promise.all([
      tx.select({ id: passwordLoginAttemptsTable.id }).from(passwordLoginAttemptsTable).where(and(eq(passwordLoginAttemptsTable.ipHash, ipHash), sql`${passwordLoginAttemptsTable.createdAt} >= ${since}`)).limit(20),
      tx.select({ id: passwordLoginAttemptsTable.id }).from(passwordLoginAttemptsTable).where(and(eq(passwordLoginAttemptsTable.identifierHash, keys[0]), sql`${passwordLoginAttemptsTable.createdAt} >= ${since}`)).limit(4),
      tx.select({ id: passwordLoginAttemptsTable.id }).from(passwordLoginAttemptsTable).where(and(eq(passwordLoginAttemptsTable.identifierHash, keys[1]), sql`${passwordLoginAttemptsTable.createdAt} >= ${since}`)).limit(4),
    ]);
    if (ip.length >= 20 || emailRows.length >= 4 || phoneRows.length >= 4) return false;
    await tx.insert(passwordLoginAttemptsTable).values([{ ipHash, identifierHash: keys[0] }, { ipHash, identifierHash: keys[1] }]);
    return true;
  });
}
function isClerkConflict(error: unknown) {
  const candidate = error as { status?: number; errors?: Array<{ code?: string }> };
  return candidate?.status === 409 || candidate?.status === 422 ||
    candidate?.errors?.some(item => /already_exists|duplicate|form_identifier_exists/i.test(item.code || "")) === true;
}

async function createChallenge(req: Request, purpose: Purpose, phone: string, payload: Record<string, unknown>, subjectId?: number, send = true) {
  const id = randomUUID(); const otp = randomInt(100000, 1000000).toString();
  const phoneHash = digest(`phone:${phone}`); const ipHash = digest(`ip:${clientIp(req)}`);
  const allowed = await db.transaction(async tx => {
    for (const key of [`public-otp:phone:${phoneHash}`, `public-otp:ip:${ipHash}`].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key})::bigint)`);
    }
    const [phoneRecent, ipRecent] = await Promise.all([
      tx.select({ id: phoneOtpChallengesTable.id }).from(phoneOtpChallengesTable).where(and(eq(phoneOtpChallengesTable.normalizedPhoneHash, phoneHash), sql`${phoneOtpChallengesTable.createdAt} > now() - interval '15 minutes'`)).limit(4),
      tx.select({ id: phoneOtpChallengesTable.id }).from(phoneOtpChallengesTable).where(and(eq(phoneOtpChallengesTable.ipHash, ipHash), sql`${phoneOtpChallengesTable.createdAt} > now() - interval '15 minutes'`)).limit(12),
    ]);
    if (phoneRecent.length >= 4 || ipRecent.length >= 12) return false;
    await tx.insert(phoneOtpChallengesTable).values({
      id, purpose, normalizedPhoneHash: phoneHash, normalizedPhone: phone, ipHash,
      otpHash: digest(`otp:${id}:${otp}`), payload, subjectId: subjectId ?? null,
      expiresAt: new Date(Date.now() + EXPIRY_SECONDS * 1000),
    });
    return true;
  });
  if (!allowed) return null;
  const sent = send ? await sendWhatsAppOtp(phone, otp) : { ok: true as const };
  if (!sent.ok) {
    await db.delete(phoneOtpChallengesTable).where(eq(phoneOtpChallengesTable.id, id));
    throw new Error("WhatsApp delivery failed");
  }
  return id;
}

async function consumeChallenge(id: string, otp: string, purpose: Purpose) {
  return db.transaction(async tx => {
    const [challenge] = await tx.select().from(phoneOtpChallengesTable).where(and(
      eq(phoneOtpChallengesTable.id, id), eq(phoneOtpChallengesTable.purpose, purpose),
      isNull(phoneOtpChallengesTable.consumedAt), sql`${phoneOtpChallengesTable.expiresAt} > now()`,
      sql`${phoneOtpChallengesTable.attempts} < ${MAX_ATTEMPTS}`,
    )).limit(1);
    if (!challenge || !matches(challenge.otpHash, digest(`otp:${id}:${otp}`))) {
      if (challenge) await tx.update(phoneOtpChallengesTable).set({ attempts: sql`${phoneOtpChallengesTable.attempts} + 1` })
        .where(and(eq(phoneOtpChallengesTable.id, id), isNull(phoneOtpChallengesTable.consumedAt)));
      return null;
    }
    const [claimed] = await tx.update(phoneOtpChallengesTable).set({ consumedAt: new Date() })
      .where(and(eq(phoneOtpChallengesTable.id, id), isNull(phoneOtpChallengesTable.consumedAt))).returning();
    return claimed ?? null;
  });
}
async function requireAdmin(req: Request) {
  const userId = getAuth(req).userId;
  if (!userId) return null;
  const user = await clerkClient.users.getUser(userId);
  const metadata = user.publicMetadata as Record<string, unknown>;
  const role = String(metadata.role || "").toLowerCase();
  const ownerId = publicOwnerId();
  const scopedOwner = metadata.ownerId ?? metadata.owner_id;
  if (!["owner", "superadmin", "admin", "nursery_admin"].includes(role)) return null;
  // An owner is the tenant principal; delegated administrators must explicitly
  // carry the public tenant identifier in Clerk metadata.
  if (role === "owner" ? userId !== ownerId : scopedOwner !== ownerId) return null;
  return { userId, role };
}

export function createPublicRegistrationRouter(): IRouter {
  const router = Router();
  router.post("/auth/registration/guardian/request", async (req, res, next) => {
    try {
      publicOwnerId();
      const body = RequestGuardianRegistrationBody.safeParse(req.body); const phone = body.success && normalizeKuwaitPhone(body.data.phone);
      if (!body.success || !phone) return void res.status(400).json({ error: "Invalid registration data" });
      const id = await createChallenge(req, "guardian_registration", phone, { name: body.data.name.trim(), email: body.data.email.trim().toLowerCase() });
      if (!id) return void res.status(429).json({ error: "Try again later" });
      res.json({ challengeId: id, expiresInSeconds: EXPIRY_SECONDS });
    } catch (error) { next(error); }
  });
  router.post("/auth/registration/guardian/complete", async (req, res, next) => {
    try {
      const body = CompleteGuardianRegistrationBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid or expired code" });
      const challenge = await consumeChallenge(body.data.challengeId, body.data.otp, "guardian_registration");
      if (!challenge?.normalizedPhone || !challenge.payload) return void res.status(400).json({ error: "Invalid or expired code" });
      const ownerId = publicOwnerId();
      const normalized = sql`'965' || CASE WHEN regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') LIKE '00965%' THEN substring(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') FROM 6) WHEN regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') LIKE '965%' THEN substring(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') FROM 4) ELSE ltrim(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g'), '0') END`;
      // Reconcile an interrupted completion before attempting a new claim. The
      // Clerk marker is the only acceptable proof; email alone never links.
      const existingRows = await db.select().from(guardiansTable).where(and(eq(guardiansTable.ownerId, ownerId), sql`${normalized} = ${challenge.normalizedPhone}`)).limit(2);
      if (existingRows.length === 1 && !existingRows[0].clerkUserId) {
        const existingClaim = await db.select().from(guardianRegistrationClaimsTable)
          .where(eq(guardianRegistrationClaimsTable.guardianId, existingRows[0].id)).limit(1);
        if (existingClaim[0]) {
          const claim = existingClaim[0];
          let users: Array<{ id: string; publicMetadata: unknown; privateMetadata?: unknown }> = [];
          if (claim.clerkUserId) {
            const user = await clerkClient.users.getUser(claim.clerkUserId).catch(() => null);
            if (user) users = [user];
          } else {
            users = await clerkUsersForEmail(String(challenge.payload.email || "")).catch(() => []);
          }
          const matchesClaim = users.filter(user => {
            const publicMetadata = user.publicMetadata as Record<string, unknown>;
            const privateMetadata = user.privateMetadata as Record<string, unknown> | undefined;
            return publicMetadata.ownerId === ownerId && publicMetadata.role === "parent" &&
              Number(privateMetadata?.guardianId) === existingRows[0].id;
          });
          if (matchesClaim.length === 1) {
            const user = matchesClaim[0];
            if (!claim.clerkUserId) await db.update(guardianRegistrationClaimsTable).set({ clerkUserId: user.id }).where(eq(guardianRegistrationClaimsTable.guardianId, existingRows[0].id));
            const [linked] = await db.update(guardiansTable).set({ clerkUserId: user.id }).where(and(eq(guardiansTable.id, existingRows[0].id), isNull(guardiansTable.clerkUserId))).returning();
            if (linked) {
              await db.delete(guardianRegistrationClaimsTable).where(eq(guardianRegistrationClaimsTable.guardianId, existingRows[0].id));
              await db.insert(auditLogsTable).values({ ownerId, actorId: user.id, actorRole: "parent", operation: "reconcile-guardian-public-registration", entityType: "guardian", entityId: String(linked.id), after: { clerkUserId: user.id } });
              return void res.json({ status: "created" });
            }
          }
          // Unowned stale claims may be safely replaced; invalid/ambiguous
          // markers remain for admin review and never disclose their reason.
          if (!claim.clerkUserId && claim.expiresAt < new Date() && matchesClaim.length === 0) {
            await db.delete(guardianRegistrationClaimsTable).where(eq(guardianRegistrationClaimsTable.guardianId, existingRows[0].id));
          } else if (matchesClaim.length !== 1) {
            return void res.json({ status: "needs_admin" });
          }
        }
      }
      const candidate = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`guardian-registration:${ownerId}:${challenge.normalizedPhone}`})::bigint)`);
        const rows = await tx.select().from(guardiansTable).where(and(eq(guardiansTable.ownerId, ownerId), sql`${normalized} = ${challenge.normalizedPhone}`)).limit(2);
        if (rows.length !== 1 || rows[0].clerkUserId) return null;
        await tx.delete(guardianRegistrationClaimsTable).where(and(eq(guardianRegistrationClaimsTable.guardianId, rows[0].id), sql`${guardianRegistrationClaimsTable.expiresAt} < now()`, isNull(guardianRegistrationClaimsTable.clerkUserId)));
        const [claim] = await tx.insert(guardianRegistrationClaimsTable).values({ guardianId: rows[0].id, challengeId: challenge.id, expiresAt: new Date(Date.now() + 10 * 60_000) }).onConflictDoNothing().returning();
        return claim ? rows[0] : null;
      });
      if (!candidate) return void res.json({ status: "needs_admin" });
      const data = challenge.payload; const names = nameParts(String(data.name || ""));
      let user;
      try {
        user = await clerkClient.users.createUser({ emailAddress: [String(data.email)], password: body.data.password, ...names, publicMetadata: { ownerId, role: "parent", accountStatus: "active" }, privateMetadata: { guardianId: candidate.id } });
        await db.update(guardianRegistrationClaimsTable).set({ clerkUserId: user.id }).where(eq(guardianRegistrationClaimsTable.challengeId, challenge.id));
      } catch (error) {
        await db.delete(guardianRegistrationClaimsTable).where(eq(guardianRegistrationClaimsTable.challengeId, challenge.id));
        if (isClerkConflict(error)) return void res.json({ status: "needs_admin" });
        throw error;
      }
      const [linked] = await db.update(guardiansTable).set({ clerkUserId: user.id }).where(and(eq(guardiansTable.id, candidate.id), eq(guardiansTable.ownerId, ownerId), isNull(guardiansTable.clerkUserId))).returning();
      if (!linked) {
        try { await clerkClient.users.deleteUser(user.id); } catch (error) {
          await db.insert(auditLogsTable).values({ ownerId, actorId: user.id, actorRole: "parent", operation: "reconcile-orphaned-guardian-account", entityType: "guardian", entityId: String(candidate.id), after: { clerkUserId: user.id, error: "delete_failed" } });
        }
        return void res.json({ status: "needs_admin" });
      }
      await db.delete(guardianRegistrationClaimsTable).where(eq(guardianRegistrationClaimsTable.challengeId, challenge.id));
      await db.insert(auditLogsTable).values({ ownerId, actorId: user.id, actorRole: "parent", operation: "link-guardian-public-registration", entityType: "guardian", entityId: String(linked.id), after: { clerkUserId: user.id } });
      res.json({ status: "created" });
    } catch (error) { next(error); }
  });
  router.post("/auth/registration/staff", async (req, res, next) => {
    try {
      const ownerId = publicOwnerId(); const body = RequestStaffRegistrationBody.safeParse(req.body); const phone = body.success && normalizeKuwaitPhone(body.data.phone);
      if (!body.success || !phone || !hasThreeNames(body.data.name)) return void res.status(400).json({ error: "Invalid registration data" });
      if (!await reserveStaffRegistrationAttempt(req, body.data.email.trim().toLowerCase(), phone)) return void res.status(429).json({ error: "Try again later" });
      await db.transaction(async tx => {
        const email = body.data.email.trim().toLowerCase();
        for (const key of [`staff-registration:email:${ownerId}:${email}`, `staff-registration:phone:${ownerId}:${phone}`].sort()) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key})::bigint)`);
        }
        const existing = await tx.select({ id: staffTable.id }).from(staffTable).where(and(
          eq(staffTable.ownerId, ownerId),
          sql`(lower(${staffTable.email}) = ${email} or regexp_replace(${staffTable.phone}, '\\D', '', 'g') in (${phone}, ${phone.slice(3)}))`,
        )).limit(1);
        if (!existing.length) await tx.insert(staffTable).values({ ownerId, name: body.data.name.trim(), email, phone, role: "pending", accountStatus: "pending_approval" });
      });
      res.json({ status: "pending_approval" });
    } catch (error) { next(error); }
  });
  router.post("/auth/registration/staff/:id/approve", async (req, res, next) => {
    try {
      const admin = await requireAdmin(req); const params = ApproveStaffRegistrationParams.safeParse(req.params); const body = ApproveStaffRegistrationBody.safeParse(req.body);
      if (!admin) return void res.status(403).json({ error: "Administrative access required" });
      if (!params.success || !body.success || !staffRoles.has(body.data.role)) return void res.status(400).json({ error: "Invalid approval" });
      const ownerId = publicOwnerId(); const [staff] = await db.update(staffTable).set({ role: body.data.role, accountStatus: "approved" }).where(and(eq(staffTable.id, params.data.id), eq(staffTable.ownerId, ownerId), eq(staffTable.accountStatus, "pending_approval"))).returning();
      if (!staff) return void res.status(404).json({ error: "Pending request not found" });
      await db.insert(auditLogsTable).values({ ownerId, actorId: admin.userId, actorRole: admin.role, operation: "approve-staff-registration", entityType: "staff", entityId: String(staff.id), after: { role: staff.role } });
      res.json({ status: "approved" });
    } catch (error) { next(error); }
  });
  router.post("/auth/registration/staff/:id/reject", async (req, res, next) => {
    try {
      const admin = await requireAdmin(req); if (!admin) return void res.status(403).json({ error: "Administrative access required" });
      const id = Number(req.params.id); const ownerId = publicOwnerId();
      const [staff] = await db.update(staffTable).set({ accountStatus: "rejected" }).where(and(eq(staffTable.id, id), eq(staffTable.ownerId, ownerId), eq(staffTable.accountStatus, "pending_approval"))).returning();
      if (!staff) return void res.status(404).json({ error: "Pending request not found" });
      await db.insert(auditLogsTable).values({ ownerId, actorId: admin.userId, actorRole: admin.role, operation: "reject-staff-registration", entityType: "staff", entityId: String(id) });
      res.json({ status: "rejected" });
    } catch (error) { next(error); }
  });
  router.post("/auth/registration/staff/activation/request", async (req, res, next) => {
    try {
      const body = RequestPasswordResetBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid request" });
      const ownerId = publicOwnerId(); const identifier = body.data.identifier.trim().toLowerCase();
      const phone = normalizeKuwaitPhone(identifier);
      const candidates = await db.select().from(staffTable).where(and(
        eq(staffTable.ownerId, ownerId), eq(staffTable.accountStatus, "approved"),
        phone ? sql`regexp_replace(${staffTable.phone}, '\\D', '', 'g') in (${phone}, ${phone.slice(3)})` : sql`lower(${staffTable.email}) = ${identifier}`,
      )).limit(2);
      const staff = candidates.length === 1 ? candidates[0] : null;
      // A durable unsent dummy is returned for unknown and non-approved values.
      if (!staff) {
        const id = await createChallenge(req, "staff_registration", phone || `unknown:${digest(identifier).slice(0, 24)}`, {}, undefined, false);
        if (!id) return void res.status(429).json({ error: "Try again later" });
        return void res.json({ challengeId: id, expiresInSeconds: EXPIRY_SECONDS });
      }
      // Keep the durable lifecycle at approved while the challenge is live:
      // expiry, bad OTPs, delivery errors and process crashes remain retryable.
      const issuing = staff;
      if (!issuing) {
        const id = await createChallenge(req, "staff_registration", phone || `unknown:${digest(identifier).slice(0, 24)}`, {}, undefined, false);
        if (!id) return void res.status(429).json({ error: "Try again later" });
        return void res.json({ challengeId: id, expiresInSeconds: EXPIRY_SECONDS });
      }
      try {
        const id = await createChallenge(req, "staff_registration", normalizeKuwaitPhone(issuing.phone)!, {}, issuing.id);
        if (!id) {
          return void res.status(429).json({ error: "Try again later" });
        }
        res.json({ challengeId: id, expiresInSeconds: EXPIRY_SECONDS });
      } catch (error) {
        throw error;
      }
    } catch (error) { next(error); }
  });
  router.post("/auth/registration/staff/complete", async (req, res, next) => {
    try {
      const body = CompleteStaffRegistrationBody.safeParse(req.body); if (!body.success) return void res.status(400).json({ error: "Invalid or expired code" });
      const challenge = await consumeChallenge(body.data.challengeId, body.data.otp, "staff_registration");
      if (!challenge?.subjectId) return void res.status(400).json({ error: "Invalid or expired code" });
      const ownerId = publicOwnerId(); const [staff] = await db.select().from(staffTable).where(and(eq(staffTable.id, challenge.subjectId), eq(staffTable.ownerId, ownerId), eq(staffTable.accountStatus, "approved"), isNull(staffTable.clerkUserId))).limit(1);
      if (!staff || !staff.email) return void res.json({ status: "needs_admin" });
      const existing = (await clerkUsersForEmail(staff.email).catch(() => [])).filter(candidate => {
        const privateMetadata = (candidate as { privateMetadata?: unknown }).privateMetadata as Record<string, unknown> | undefined;
        return isTenantActiveUser(candidate, ownerId) && Number(privateMetadata?.staffId) === staff.id;
      });
      const user = existing.length === 1
        ? await clerkClient.users.updateUser(existing[0].id, { password: body.data.password })
        : await clerkClient.users.createUser({ emailAddress: [staff.email], password: body.data.password, ...nameParts(staff.name), publicMetadata: { ownerId, role: staff.role, accountStatus: "active" }, privateMetadata: { staffId: staff.id } });
      const [active] = await db.update(staffTable).set({ clerkUserId: user.id, accountStatus: "active" }).where(and(eq(staffTable.id, staff.id), eq(staffTable.accountStatus, "approved"), isNull(staffTable.clerkUserId))).returning();
      if (!active) {
        await db.insert(auditLogsTable).values({ ownerId, actorId: user.id, actorRole: staff.role, operation: "reconcile-orphaned-staff-account", entityType: "staff", entityId: String(staff.id), after: { clerkUserId: user.id, recoverable: true } });
        return void res.json({ status: "needs_admin" });
      }
      await db.insert(auditLogsTable).values({ ownerId, actorId: user.id, actorRole: active.role, operation: "activate-staff-public-registration", entityType: "staff", entityId: String(active.id), after: { clerkUserId: user.id } });
      res.json({ status: "created" });
    } catch (error) { next(error); }
  });
  router.post("/auth/password-reset/request", async (req, res, next) => {
    try {
      const body = RequestPasswordResetBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid request" });
      const ownerId = publicOwnerId(); const identifier = body.data.identifier.trim().toLowerCase();
      const phone = normalizeKuwaitPhone(identifier);
      const guardianPhone = sql`'965' || CASE WHEN regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') LIKE '00965%' THEN substring(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') FROM 6) WHEN regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') LIKE '965%' THEN substring(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') FROM 4) ELSE ltrim(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g'), '0') END`;
      const staffPhone = sql`'965' || CASE WHEN regexp_replace(${staffTable.phone}, '\\D', '', 'g') LIKE '00965%' THEN substring(regexp_replace(${staffTable.phone}, '\\D', '', 'g') FROM 6) WHEN regexp_replace(${staffTable.phone}, '\\D', '', 'g') LIKE '965%' THEN substring(regexp_replace(${staffTable.phone}, '\\D', '', 'g') FROM 4) ELSE ltrim(regexp_replace(${staffTable.phone}, '\\D', '', 'g'), '0') END`;
      const [staff, guardians, aliases] = await Promise.all([
        db.select().from(staffTable).where(and(eq(staffTable.ownerId, ownerId), eq(staffTable.accountStatus, "active"), sql`${staffTable.clerkUserId} is not null`, phone ? sql`${staffPhone} = ${phone}` : sql`lower(${staffTable.email}) = ${identifier}`)).limit(2),
        db.select().from(guardiansTable).where(and(eq(guardiansTable.ownerId, ownerId), sql`${guardiansTable.clerkUserId} is not null`, phone ? sql`${guardianPhone} = ${phone}` : sql`lower(${guardiansTable.email}) = ${identifier}`)).limit(2),
        phone ? db.select().from(phoneLoginIdentitiesTable).where(eq(phoneLoginIdentitiesTable.normalizedPhone, phone)).limit(2) : Promise.resolve([]),
      ]);
      const databaseIdentities: ResetIdentity[] = [
        ...staff.map(x => ({ userId: x.clerkUserId!, phone: normalizeKuwaitPhone(x.phone), type: "staff" as const, id: x.id })),
        ...guardians.map(x => ({ userId: x.clerkUserId!, phone: normalizeKuwaitPhone(x.phone), type: "guardian" as const, id: x.id })),
      ];
      const emailUsers = phone ? [] : await clerkUsersForEmail(identifier).catch(() => []);
      const validUserIds = new Set([
        ...await validatedAliasUserIds(aliases.map(x => ({ userId: x.clerkUserId })), ownerId),
        ...emailUsers.filter(user => isTenantActiveUser(user, ownerId)).map(user => user.id),
        ...await validatedAliasUserIds(databaseIdentities.map(x => ({ userId: x.userId })), ownerId),
      ]);
      const aliasByUser = validUserIds.size
        ? await db.select().from(phoneLoginIdentitiesTable).where(inArray(phoneLoginIdentitiesTable.clerkUserId, [...validUserIds]))
        : [];
      const identities = databaseIdentities.filter(identity => validUserIds.has(identity.userId));
      for (const alias of aliasByUser) {
        if (!identities.some(identity => identity.userId === alias.clerkUserId)) identities.push({ userId: alias.clerkUserId, phone: alias.normalizedPhone, type: "alias", id: alias.id });
      }
      for (const userId of validUserIds) {
        if (identities.some(identity => identity.userId === userId)) continue;
        const user = await clerkClient.users.getUser(userId).catch(() => null);
        if (!user || !isTenantActiveUser(user, ownerId)) continue;
        const verifiedPhones = verifiedKuwaitPhones(user);
        if (verifiedPhones.length === 1) identities.push({ userId, phone: verifiedPhones[0], type: "clerk_phone", id: userId });
      }
      const unique = Array.from(new Map(identities.map(x => [x.userId, x])).values());
      let challengeId: string | null = null;
      if (unique.length === 1 && unique[0].phone) {
        // The acknowledgement intentionally does not distinguish delivery or
        // identity outcomes, preventing reset-request enumeration.
        try {
          challengeId = await createChallenge(req, "password_reset", unique[0].phone, { userId: unique[0].userId, ownerId, type: unique[0].type, id: unique[0].id });
        } catch (error) {
          req.log.error({ err: error }, "Password reset OTP dispatch failed");
        }
      }
      if (!challengeId) challengeId = await createChallenge(req, "password_reset", phone || `unknown:${digest(identifier).slice(0, 24)}`, {}, undefined, false);
      if (!challengeId) return void res.status(429).json({ error: "Try again later" });
      res.json({ challengeId, expiresInSeconds: EXPIRY_SECONDS });
    } catch (error) { next(error); }
  });
  router.post("/auth/password-reset/complete", async (req, res, next) => {
    try {
      const body = CompletePasswordResetBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid or expired code" });
      const challenge = await consumeChallenge(body.data.challengeId, body.data.otp, "password_reset");
      const payload = challenge?.payload;
      if (!payload || typeof payload.userId !== "string" || typeof payload.ownerId !== "string") return void res.status(400).json({ error: "Invalid or expired code" });
      const currentUser = await clerkClient.users.getUser(payload.userId).catch(() => null);
      if (!currentUser || !isTenantActiveUser(currentUser, payload.ownerId)) return void res.status(400).json({ error: "Invalid or expired code" });
      if (payload.type === "staff") {
        const [row] = await db.select().from(staffTable).where(and(eq(staffTable.id, Number(payload.id)), eq(staffTable.ownerId, payload.ownerId), eq(staffTable.accountStatus, "active"), eq(staffTable.clerkUserId, payload.userId))).limit(1);
        if (!row) return void res.status(400).json({ error: "Invalid or expired code" });
      } else if (payload.type === "guardian") {
        const [row] = await db.select().from(guardiansTable).where(and(eq(guardiansTable.id, Number(payload.id)), eq(guardiansTable.ownerId, payload.ownerId), eq(guardiansTable.clerkUserId, payload.userId))).limit(1);
        if (!row) return void res.status(400).json({ error: "Invalid or expired code" });
      } else if (payload.type === "alias") {
        const [row] = await db.select().from(phoneLoginIdentitiesTable).where(and(eq(phoneLoginIdentitiesTable.id, Number(payload.id)), eq(phoneLoginIdentitiesTable.clerkUserId, payload.userId), eq(phoneLoginIdentitiesTable.normalizedPhone, challenge.normalizedPhone || ""))).limit(1);
        if (!row) return void res.status(400).json({ error: "Invalid or expired code" });
      } else if (payload.type === "clerk_phone") {
        if (!challenge.normalizedPhone || !verifiedKuwaitPhones(currentUser).includes(challenge.normalizedPhone)) {
          return void res.status(400).json({ error: "Invalid or expired code" });
        }
      } else if (payload.userId !== payload.ownerId) return void res.status(400).json({ error: "Invalid or expired code" });
      await clerkClient.users.updateUser(payload.userId, { password: body.data.password });
      await db.insert(auditLogsTable).values({ ownerId: payload.ownerId, actorId: payload.userId, actorRole: String(payload.type || "user"), operation: "reset-password", entityType: String(payload.type || "account"), entityId: String(payload.id || "") });
      res.json({ accepted: true });
    } catch (error) { next(error); }
  });
  router.post("/auth/password-login", async (req, res, next) => {
    try {
      const body = PasswordLoginBody.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Invalid credentials" });
      const ownerId = publicOwnerId(); const identifier = body.data.identifier.trim().toLowerCase();
      if (!await reservePasswordLoginAttempt(req, identifier)) return void res.status(400).json({ error: "Invalid credentials" });
      const phone = normalizeKuwaitPhone(identifier);
      const staffPhone = sql`'965' || CASE WHEN regexp_replace(${staffTable.phone}, '\\D', '', 'g') LIKE '00965%' THEN substring(regexp_replace(${staffTable.phone}, '\\D', '', 'g') FROM 6) WHEN regexp_replace(${staffTable.phone}, '\\D', '', 'g') LIKE '965%' THEN substring(regexp_replace(${staffTable.phone}, '\\D', '', 'g') FROM 4) ELSE ltrim(regexp_replace(${staffTable.phone}, '\\D', '', 'g'), '0') END`;
      const guardianPhone = sql`'965' || CASE WHEN regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') LIKE '00965%' THEN substring(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') FROM 6) WHEN regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') LIKE '965%' THEN substring(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g') FROM 4) ELSE ltrim(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g'), '0') END`;
      const [staff, guardians, aliases, owner] = await Promise.all([
        db.select({ userId: staffTable.clerkUserId }).from(staffTable).where(and(eq(staffTable.ownerId, ownerId), eq(staffTable.accountStatus, "active"), sql`${staffTable.clerkUserId} is not null`, phone ? sql`${staffPhone} = ${phone}` : sql`lower(${staffTable.email}) = ${identifier}`)).limit(2),
        db.select({ userId: guardiansTable.clerkUserId }).from(guardiansTable).where(and(eq(guardiansTable.ownerId, ownerId), sql`${guardiansTable.clerkUserId} is not null`, phone ? sql`${guardianPhone} = ${phone}` : sql`lower(${guardiansTable.email}) = ${identifier}`)).limit(2),
        phone ? db.select({ userId: phoneLoginIdentitiesTable.clerkUserId }).from(phoneLoginIdentitiesTable).where(eq(phoneLoginIdentitiesTable.normalizedPhone, phone)).limit(2) : Promise.resolve([]),
        phone ? Promise.resolve(null) : clerkClient.users.getUser(ownerId).catch(() => null),
      ]);
      const ownerEmailMatches = !phone && owner?.emailAddresses.some((entry) =>
        entry.emailAddress.trim().toLowerCase() === identifier && entry.verification?.status === "verified",
      );
      const emailUsers = phone ? [] : await clerkUsersForEmail(identifier).catch(() => []);
      const rowIds = [...staff, ...guardians].map(x => x.userId).filter((id): id is string => Boolean(id));
      const validRowIds = await validatedAliasUserIds(rowIds.map(userId => ({ userId })), ownerId);
      const validAliasIds = await validatedAliasUserIds(aliases.map(x => ({ userId: x.userId })), ownerId);
      const ids = Array.from(new Set(validRowIds
        .concat(validAliasIds)
        .concat(emailUsers.filter(user => isTenantActiveUser(user, ownerId)).map(user => user.id))
        .concat(ownerEmailMatches && isTenantActiveUser(owner!, ownerId) ? [ownerId] : [])));
      if (ids.length !== 1) return void res.status(400).json({ error: "Invalid credentials" });
      const verifyPassword = (clerkClient.users as unknown as { verifyPassword(input: { userId: string; password: string }): Promise<unknown> }).verifyPassword;
      try {
        await verifyPassword.call(clerkClient.users, { userId: ids[0], password: body.data.password });
      } catch {
        return void res.status(400).json({ error: "Invalid credentials" });
      }
      const tokenClient = clerkClient.signInTokens as unknown as { createSignInToken(input: { userId: string; expiresInSeconds: number }): Promise<{ token: string }> };
      const ticket = await tokenClient.createSignInToken({ userId: ids[0], expiresInSeconds: 60 });
      res.json({ ticket: ticket.token });
    } catch { res.status(400).json({ error: "Invalid credentials" }); }
  });
  return router;
}
export default createPublicRegistrationRouter();