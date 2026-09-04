import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getLocalAuth, hashPassword } from "../lib/localAuth";
import {
  CreateChildBody,
  CreateChildResponse,
  CreateClassroomBody,
  CreateClassroomResponse,
  CreateStaffBody,
  CreateStaffResponse,
  CreateInvoiceCheckoutSessionBody,
  CreateInvoiceCheckoutSessionParams,
  CreateInvoiceCheckoutSessionResponse,
  CreateParentInvoiceCheckoutSessionBody,
  CreateParentInvoiceCheckoutSessionParams,
  CreateParentInvoiceCheckoutSessionResponse,
  DeleteChildParams,
  GetChildParams,
  GetChildResponse,
  GetDashboardActivityResponse,
  GetDashboardSummaryResponse,
  GetFinanceSummaryResponse,
  GetSessionContextResponse,
  SetStaffScopeBody,
  SetStaffScopeParams,
  SetStaffScopeResponse,
  GetTodayAttendanceResponse,
  GetParentOverviewResponse,
  ListChildrenQueryParams,
  ListChildrenResponse,
  ListClassroomsResponse,
  ListGuardiansResponse,
  ListInvoicesQueryParams,
  ListInvoicesResponse,
  ListParentActivitiesQueryParams,
  ListParentActivitiesResponse,
  ListParentAnnouncementsResponse,
  ListParentAttendanceQueryParams,
  ListParentAttendanceResponse,
  ListParentChildrenResponse,
  ListParentInvoicesResponse,
  ListParentMessagesResponse,
  ListParentProgressReportsQueryParams,
  ListParentProgressReportsResponse,
  ListGuardianAccountsResponse,
  UpdateGuardianAccountParams,
  UpdateGuardianAccountBody,
  UpdateGuardianAccountResponse,
  ListStaffResponse,
  RecordAttendanceBody,
  RecordAttendanceResponse,
  RecordCashInvoicePaymentBody,
  RecordCashInvoicePaymentParams,
  RecordCashInvoicePaymentResponse,
  SendInvoiceReminderParams,
  SendInvoiceReminderResponse,
  SendParentMessageBody,
  SendParentMessageResponse,
  LinkStaffAccountBody,
  LinkStaffAccountParams,
  LinkStaffAccountResponse,
  UpdateStaffAccountBody,
  UpdateStaffAccountParams,
  UpdateStaffAccountResponse,
  UpdateChildBody,
  UpdateChildParams,
  UpdateChildResponse,
  UpdateStaffBody,
  UpdateStaffParams,
  UpdateStaffResponse,
  DeleteStaffParams,
  RequestStaffPasswordResetBody,
  RequestStaffPasswordResetResponse,
  CompleteStaffPasswordResetBody,
  CompleteStaffPasswordResetResponse,
  AdminCreateAccountBody,
  AdminCreateAccountResponse,
} from "@workspace/api-zod";
import { normalizeKuwaitPhone } from "./phoneAuth";
import {
  activitiesTable,
  announcementsTable,
  attendanceTable,
  auditLogsTable,
  childrenTable,
  classroomsTable,
  childActivitiesTable,
  childContactsTable,
  billingPlansTable,
  db,
  guardiansTable,
  invoicePaymentsTable,
  invoicesTable,
  invoiceRefundsTable,
  parentMessagesTable,
  progressReportsTable,
  publicAuthAccountsTable,
  organizationsTable,
  staffTable,
  staffScopeAssignmentsTable,
  branchesTable,
} from "@workspace/db";
import { checkClassroomCapacity } from "../lib/classroomCapacity";
import {
  branchCondition,
  classroomBranchMismatch,
  defaultBranchId,
  defaultScopedBranchId,
  FULL_ACCESS_ROLES,
  resolveBranchId,
  resolveStaffScope,
} from "../lib/branchScope";
import {
  createInvoiceCheckoutSession,
  isAllowedReturnUrl,
  PaymentAttemptInProgressError,
  PaymentProviderConfigurationError,
} from "../lib/financePayments";
import { InvoiceNotPayableError, requireCheckoutPayable } from "../lib/invoiceLedger";
import { sendDueReminder, sendWhatsAppText } from "../lib/notifications";
import { configuredOwnerEmails, isConfiguredOwner } from "../lib/ownerIdentity";
import {
  auditNurseryOperation,
  configurableOperations,
  nurseryContext,
  permitted,
  requireBranchAccess,
  resolveNurseryContext,
} from "./nurseryOperations";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
const staffAccountRoles = new Set(["admin", "manager", "supervisor", "teacher", "accountant", "receptionist"]);
const verificationRate = new Map<string, { count: number; resetAt: number }>();

async function staffResponse(member: typeof staffTable.$inferSelect) {
  const assignments = await db.select({
    organizationId: staffScopeAssignmentsTable.organizationId,
    branchId: staffScopeAssignmentsTable.branchId,
  }).from(staffScopeAssignmentsTable).where(and(
    eq(staffScopeAssignmentsTable.ownerId, member.ownerId),
    eq(staffScopeAssignmentsTable.staffId, member.id),
  ));
  const branchIds = await resolveStaffScope(db, member.ownerId, member);
  return {
    ...member,
    accountStatus: ["provisioning", "issuing_otp"].includes(member.accountStatus) ? "pending_verification" : member.accountStatus,
    attendanceRate: member.status === "present" ? 100 : member.status === "leave" ? 85 : 70,
    scope: {
      organizationIds: assignments.flatMap((item) => item.organizationId == null ? [] : [item.organizationId]),
      branchIds: assignments.flatMap((item) => item.branchId == null ? [] : [item.branchId]),
      fullAccess: branchIds === null,
    },
  };
}

function staffAuditSnapshot(member: typeof staffTable.$inferSelect) {
  const {
    otpHash: _otpHash,
    otpExpiresAt: _otpExpiresAt,
    otpAttempts: _otpAttempts,
    passwordResetHash: _passwordResetHash,
    passwordResetExpiresAt: _passwordResetExpiresAt,
    passwordResetRequestedAt: _passwordResetRequestedAt,
    ownerId: _ownerId,
    ...safe
  } = member;
  return safe as Record<string, unknown>;
}

function passwordResetDigest(staffId: number, token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for staff password reset");
  return createHmac("sha256", secret).update(`password-reset:${staffId}:${token}`).digest("hex");
}

function passwordResetMatches(staffId: number, token: string, expected: string) {
  const actual = Buffer.from(passwordResetDigest(staffId, token), "hex");
  const stored = Buffer.from(expected, "hex");
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}

function canonicalAppOrigin() {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("PUBLIC_APP_URL must use HTTPS");
    }
    return url.origin;
  }
  if (process.env.NODE_ENV !== "production" && process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return null;
}

function accountResult(member: typeof staffTable.$inferSelect) {
  const accountStatus = ["provisioning", "issuing_otp"].includes(member.accountStatus) ? "pending_verification" : member.accountStatus;
  return {
    staffId: member.id,
    clerkUserId: member.clerkUserId,
    accountStatus,
    role: member.role.toLowerCase(),
    setupComplete: accountStatus === "active",
  };
}

function accountManager(
  req: Request,
  operation: "write:users" | "delete:users" | "create:users" | "write:guardian-account" | "delete:guardian-account" = "write:users",
) {
  return permitted(req, operation);
}

router.post("/admin/create-account", async (req, res): Promise<void> => {
  const body = AdminCreateAccountBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!await accountManager(req, "create:users")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const phone = normalizeKuwaitPhone(body.data.phone);
  if (!phone) {
    res.status(400).json({ error: "Invalid Kuwait mobile number" });
    return;
  }
  const accountType = body.data.accountType;
  const role = body.data.role?.toLowerCase() || (accountType === "staff" ? "teacher" : "parent");
  const fullName = body.data.fullName?.trim() || phone;
  const names = fullName.split(/\s+/u);
  const email = `manual_${phone}@placeholder.local`;

  // Check if phone is already used
  const [existingAccount] = await db.select({ id: publicAuthAccountsTable.id })
    .from(publicAuthAccountsTable)
    .where(eq(publicAuthAccountsTable.normalizedPhone, phone))
    .limit(1);
  if (existingAccount) {
    res.status(409).json({ error: "Phone number already has an account" });
    return;
  }

  // Hash password locally
  const pwHash = await hashPassword(body.data.password);

  let recordId: number;
  if (accountType === "staff") {
    // Find existing unlinked staff with this phone, or create new
    const existingStaff = await db.select().from(staffTable).where(and(
      eq(staffTable.ownerId, ownerId),
      branchCondition(staffTable.branchId, branchIds),
      eq(staffTable.accountStatus, "unlinked"),
      sql`${staffTable.clerkUserId} is null`,
    ));
    const match = existingStaff.find(s => {
      const digits = s.phone.replace(/\D/g, "");
      const local = digits.startsWith("00965") ? digits.slice(5) : digits.startsWith("965") && digits.length > 8 ? digits.slice(3) : digits.replace(/^0+/, "");
      return `965${local}` === phone;
    });
    if (match) {
      const [linked] = await db.update(staffTable).set({
        clerkUserId: `local_pending`,
        role,
        accountStatus: "active",
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      }).where(and(
        eq(staffTable.id, match.id),
        eq(staffTable.ownerId, ownerId),
        sql`${staffTable.clerkUserId} is null`,
      )).returning();
      recordId = linked.id;
    } else {
      const branch = defaultScopedBranchId(branchIds, undefined);
      if (branch.kind === "forbidden") {
        res.status(403).json({ error: "Branch not permitted" });
        return;
      }
      if (branch.kind === "ambiguous") {
        res.status(400).json({ error: "Branch required" });
        return;
      }
      const [created] = await db.insert(staffTable).values({
        ownerId,
        name: fullName,
        role,
        phone,
        clerkUserId: `local_pending`,
        accountStatus: "active",
        branchId: branch.branchId,
      }).returning();
      recordId = created.id;
    }
  } else {
    // Guardian: find existing unlinked guardian or create new
    const existingGuardians = await db.select().from(guardiansTable).where(and(
      eq(guardiansTable.ownerId, ownerId),
      branchCondition(guardiansTable.branchId, branchIds),
      sql`${guardiansTable.clerkUserId} is null`,
    ));
    const match = existingGuardians.find(g => {
      const digits = g.phone.replace(/\D/g, "");
      const local = digits.startsWith("00965") ? digits.slice(5) : digits.startsWith("965") && digits.length > 8 ? digits.slice(3) : digits.replace(/^0+/, "");
      return `965${local}` === phone;
    });
    if (match) {
      await db.update(guardiansTable).set({ clerkUserId: `local_pending` }).where(and(
        eq(guardiansTable.id, match.id),
        eq(guardiansTable.ownerId, ownerId),
        sql`${guardiansTable.clerkUserId} is null`,
      ));
      recordId = match.id;
    } else {
      const branch = defaultScopedBranchId(branchIds, undefined);
      if (branch.kind === "forbidden") {
        res.status(403).json({ error: "Branch not permitted" });
        return;
      }
      if (branch.kind === "ambiguous") {
        res.status(400).json({ error: "Branch required" });
        return;
      }
      const [created] = await db.insert(guardiansTable).values({
        ownerId,
        name: fullName,
        phone,
        clerkUserId: `local_pending`,
        branchId: branch.branchId,
      }).returning();
      recordId = created.id;
    }
  }

  // Record in public_auth_accounts with local password hash
  const [account] = await db.insert(publicAuthAccountsTable).values({
    normalizedPhone: phone,
    fullName,
    email,
    passwordHash: pwHash,
    accountType,
    accountStatus: "active",
    role,
    ownerId,
    guardianId: accountType === "guardian" ? recordId : null,
    staffId: accountType === "staff" ? recordId : null,
  }).returning();

  // Update staff/guardian with account reference
  const accountRef = `local_${account.id}`;
  if (accountType === "staff") {
    await db.update(staffTable).set({ clerkUserId: accountRef }).where(eq(staffTable.id, recordId));
  } else {
    await db.update(guardiansTable).set({ clerkUserId: accountRef }).where(eq(guardiansTable.id, recordId));
  }

  await auditNurseryOperation(req, "admin-create-account", `${accountType}-account`, String(recordId), null, {
    phone, accountType, role, name: fullName,
  });

  res.status(201).json(AdminCreateAccountResponse.parse({
    id: recordId,
    accountType,
    phone,
    accountStatus: "active",
    role,
    name: fullName,
  }));
});

router.post("/staff/password-reset/request", async (req, res, next): Promise<void> => {
  const requestStartedAt = Date.now();
  const body = RequestStaffPasswordResetBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const now = Date.now();
  const rateKey = `password-reset:${req.ip || req.socket.remoteAddress || "unknown"}`;
  const rate = verificationRate.get(rateKey);
  if (rate && rate.resetAt > now && rate.count >= 5) {
    res.status(429).json({ error: "Too many password reset requests; try again later" });
    return;
  }
  verificationRate.set(rateKey, rate && rate.resetAt > now
    ? { ...rate, count: rate.count + 1 }
    : { count: 1, resetAt: now + 10 * 60_000 });
  try {
    let pendingDispatch: { staffId: number; phone: string; tokenHash: string; message: string } | null = null;
    const [member] = await db.select().from(staffTable).where(and(
      sql`lower(${staffTable.email}) = ${body.data.email.trim().toLowerCase()}`,
      eq(staffTable.accountStatus, "active"),
      sql`${staffTable.clerkUserId} is not null`,
    )).limit(1);
    const appOrigin = canonicalAppOrigin();
    if (member?.clerkUserId && appOrigin) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = passwordResetDigest(member.id, token);
      const [reserved] = await db.update(staffTable).set({
        passwordResetHash: tokenHash,
        passwordResetExpiresAt: new Date(now + 10 * 60_000),
        passwordResetRequestedAt: new Date(now),
      }).where(and(
        eq(staffTable.id, member.id),
        eq(staffTable.clerkUserId, member.clerkUserId),
        sql`(${staffTable.passwordResetRequestedAt} is null or ${staffTable.passwordResetRequestedAt} < ${new Date(now - 60_000)})`,
      )).returning({ id: staffTable.id });
      if (reserved) {
        const link = `${appOrigin}/staff-password-reset?staffId=${member.id}&token=${encodeURIComponent(token)}`;
        pendingDispatch = {
          staffId: member.id,
          phone: member.phone,
          tokenHash,
          message: `لإعادة تعيين كلمة المرور في نظام الحضانة افتحي الرابط التالي:\n${link}\nالرابط صالح لمدة 10 دقائق ولمرة واحدة فقط.`,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 100 - (Date.now() - requestStartedAt))));
    res.json(RequestStaffPasswordResetResponse.parse({ accepted: true }));
    if (pendingDispatch) {
      const sendResult = await sendWhatsAppText(pendingDispatch.phone, pendingDispatch.message);
      if (!sendResult.ok) {
        await db.update(staffTable).set({ passwordResetHash: null, passwordResetExpiresAt: null })
          .where(and(
            eq(staffTable.id, pendingDispatch.staffId),
            eq(staffTable.passwordResetHash, pendingDispatch.tokenHash),
          ));
      }
    }
  } catch (error) {
    if (!res.headersSent) next(error);
    else req.log.error({ err: error }, "Password reset WhatsApp dispatch failed after acknowledgement");
  }
});

router.post("/staff/password-reset/complete", async (req, res, next): Promise<void> => {
  const now = Date.now();
  const rateKey = `password-reset-complete:${req.ip || req.socket.remoteAddress || "unknown"}`;
  const rate = verificationRate.get(rateKey);
  if (rate && rate.resetAt > now && rate.count >= 20) {
    res.status(429).json({ error: "Too many password reset attempts; try again later" });
    return;
  }
  verificationRate.set(rateKey, rate && rate.resetAt > now
    ? { ...rate, count: rate.count + 1 }
    : { count: 1, resetAt: now + 60_000 });
  const body = CompleteStaffPasswordResetBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const [member] = await db.select().from(staffTable).where(eq(staffTable.id, body.data.staffId)).limit(1);
    if (!member?.clerkUserId || member.accountStatus !== "active" || !member.passwordResetHash ||
        !member.passwordResetExpiresAt || member.passwordResetExpiresAt.getTime() <= Date.now() ||
        !passwordResetMatches(member.id, body.data.token, member.passwordResetHash)) {
      res.status(400).json({ error: "Invalid or expired password reset link" });
      return;
    }
    const [claimed] = await db.update(staffTable).set({
      passwordResetHash: null,
      passwordResetExpiresAt: null,
    }).where(and(
      eq(staffTable.id, member.id),
      eq(staffTable.passwordResetHash, member.passwordResetHash),
      eq(staffTable.accountStatus, "active"),
    )).returning({ id: staffTable.id });
    if (!claimed) {
      res.status(400).json({ error: "Invalid or already used password reset link" });
      return;
    }
    // Update password hash locally
    const newPwHash = await hashPassword(body.data.password);
    const accountRef = member.clerkUserId;
    if (accountRef) {
      const accountId = accountRef.startsWith("local_") ? Number(accountRef.slice(6)) : null;
      if (accountId) {
        await db.update(publicAuthAccountsTable).set({ passwordHash: newPwHash })
          .where(eq(publicAuthAccountsTable.id, accountId));
      }
    }
    await db.insert(auditLogsTable).values({
      ownerId: member.ownerId,
      actorId: member.clerkUserId || String(member.id),
      actorRole: member.role,
      operation: "reset-staff-password",
      entityType: "staff-account",
      entityId: String(member.id),
      before: { passwordResetRequested: true },
      after: { passwordResetCompleted: true },
    });
    res.json(CompleteStaffPasswordResetResponse.parse({ updated: true }));
  } catch (error) {
    next(error);
  }
});

const requireAuth: RequestHandler = (req, res, next) => {
  const auth = getLocalAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

async function localIdentity(req: Parameters<typeof getLocalAuth>[0]) {
  const auth = getLocalAuth(req);
  if (!auth) return { role: null };
  // Check if configured owner
  if (isConfiguredOwner(auth.sub, [])) {
    return { role: "owner" };
  }
  // Look up account for role
  const [account] = await db.select().from(publicAuthAccountsTable)
    .where(eq(publicAuthAccountsTable.id, Number(auth.sub))).limit(1);
  if (!account) return { role: auth.role || null };
  const ownerEmails = configuredOwnerEmails();
  if (ownerEmails.length && account.email && ownerEmails.includes(account.email.toLowerCase())) {
    return { role: "owner" };
  }
  return { role: account.role || auth.role || null };
}

async function resolveGuardian(req: Parameters<typeof getLocalAuth>[0]) {
  const auth = getLocalAuth(req);
  if (!auth) return null;
  const accountRef = `local_${auth.sub}`;
  const [linked] = await db.select().from(guardiansTable)
    .where(eq(guardiansTable.clerkUserId, accountRef)).limit(1);
  if (linked) return linked;
  // Also check by guardianId in account
  const [account] = await db.select().from(publicAuthAccountsTable)
    .where(eq(publicAuthAccountsTable.id, Number(auth.sub))).limit(1);
  if (account?.guardianId) {
    const [guardian] = await db.select().from(guardiansTable)
      .where(eq(guardiansTable.id, account.guardianId)).limit(1);
    return guardian || null;
  }
  return null;
}

function pickDisplayName(candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const name = candidate?.trim() ?? "";
    if (name && !/^\+?\d[\d\s-]*$/.test(name)) return name;
  }
  return "";
}

const requireParentGuardian: RequestHandler = async (req, res, next) => {
  try {
    const identity = await localIdentity(req);
    if (identity.role && identity.role !== "parent" && identity.role !== "guardian" && identity.role !== "pending") {
      res.status(403).json({ error: "Parent access required" });
      return;
    }
    const guardian = await resolveGuardian(req);
    if (!guardian) {
      res.status(403).json({ error: "No guardian record is linked to this verified account" });
      return;
    }
    res.locals.guardian = guardian;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Failed to resolve guardian identity");
    next(error);
  }
};

async function childRows(ownerId: string, branchIds: import("../lib/branchScope").BranchScope) {
  const [children, guardians, classrooms, attendance] = await Promise.all([
    db.select().from(childrenTable).where(and(
      eq(childrenTable.ownerId, ownerId),
      branchCondition(childrenTable.branchId, branchIds),
    )),
    db.select().from(guardiansTable).where(and(
      eq(guardiansTable.ownerId, ownerId),
      branchCondition(guardiansTable.branchId, branchIds),
    )),
    db.select().from(classroomsTable).where(and(
      eq(classroomsTable.ownerId, ownerId),
      branchCondition(classroomsTable.branchId, branchIds),
    )),
    db.select({ attendance: attendanceTable })
      .from(attendanceTable)
      .innerJoin(childrenTable, and(
        eq(attendanceTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, ownerId),
        branchCondition(childrenTable.branchId, branchIds),
      )),
  ]);
  const guardianMap = new Map(guardians.map((guardian) => [guardian.id, guardian]));
  const classroomMap = new Map(classrooms.map((classroom) => [classroom.id, classroom]));
  const attendanceMap = new Map<number, { total: number; present: number }>();
  attendance.forEach(({ attendance: record }) => {
    const current = attendanceMap.get(record.childId) ?? { total: 0, present: 0 };
    current.total += 1;
    if (record.status === "present" || record.status === "late") current.present += 1;
    attendanceMap.set(record.childId, current);
  });
  return children.map((child) => {
    const guardian = guardianMap.get(child.guardianId);
    const classroom = child.classroomId ? classroomMap.get(child.classroomId) : undefined;
    const attendanceStats = attendanceMap.get(child.id);
    return {
      id: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      fullName: `${child.firstName} ${child.lastName}`,
      gender: child.gender,
      birthDate: child.birthDate,
      status: child.status,
      classroomId: classroom?.id ?? null,
      branchId: child.branchId,
      guardianId: child.guardianId ?? null,
      classroomName: classroom?.name ?? null,
      guardianName: guardian?.name ?? "ولي أمر غير مسجل",
      guardianPhone: guardian?.phone ?? "",
      level: child.level,
      attendanceRate: attendanceStats ? Math.round((attendanceStats.present / attendanceStats.total) * 100) : 0,
      avatarUrl: child.avatarUrl,
      notes: child.notes,
    };
  });
}

router.use(requireAuth);
router.get("/session/context", resolveNurseryContext, async (req, res, next): Promise<void> => {
  try {
    const identity = await localIdentity(req);
    const auth = getLocalAuth(req);
    const accountId = Number(auth?.sub);
    const [account] = Number.isFinite(accountId) && accountId > 0
      ? await db.select({ fullName: publicAuthAccountsTable.fullName })
        .from(publicAuthAccountsTable)
        .where(eq(publicAuthAccountsTable.id, accountId))
        .limit(1)
      : [];
    const [staff] = Number.isFinite(accountId) && accountId > 0
      ? await db.select({ name: staffTable.name })
        .from(staffTable)
        .where(eq(staffTable.clerkUserId, `local_${accountId}`))
        .limit(1)
      : [];
    const guardian = await resolveGuardian(req);
    const fullName = pickDisplayName([staff?.name, guardian?.name, account?.fullName]);
    const effectivePermissions = await Promise.all(configurableOperations.map(async (operation) =>
      await permitted(req, operation) ? operation : null,
    )).then((operations) => operations.filter(
      (operation): operation is NonNullable<typeof operation> => operation !== null,
    ));
    const administrativeRoles = new Set([
      "admin", "nursery_admin", "manager", "supervisor", "teacher", "accountant",
      "receptionist", "owner", "superadmin",
    ]);
    if (identity.role && administrativeRoles.has(identity.role)) {
      const context = nurseryContext(req);
      const baseScope: import("../lib/branchScope").BranchScope =
        res.locals.operationsBaseBranchScope ?? context.branchIds;
      const allowedBranches = await db.select({
        id: branchesTable.id,
        organizationId: branchesTable.organizationId,
        name: branchesTable.name,
        active: branchesTable.active,
      }).from(branchesTable).where(and(
        eq(branchesTable.ownerId, context.ownerId),
        branchCondition(branchesTable.id, baseScope),
      )).orderBy(branchesTable.name);
      const organizationIds = [...new Set(
        allowedBranches
          .map((branch) => branch.organizationId)
          .filter((id): id is number => id !== null),
      )];
      const allowedOrganizations = organizationIds.length === 0
        ? []
        : await db.select({
          id: organizationsTable.id,
          name: organizationsTable.name,
        }).from(organizationsTable).where(and(
          eq(organizationsTable.ownerId, context.ownerId),
          inArray(organizationsTable.id, organizationIds),
        )).orderBy(organizationsTable.name);
      res.json(GetSessionContextResponse.parse({
        role: "admin", fullName, accountRole: context.role, effectivePermissions,
        branchScope: {
          fullAccess: baseScope === null,
          branchIds: allowedBranches.map((branch) => branch.id),
          organizations: allowedOrganizations,
          branches: allowedBranches,
        },
      }));
      return;
    }
    if (!identity.role || identity.role === "parent" || identity.role === "guardian") {
      const guardian = await resolveGuardian(req);
      if (guardian) {
        res.json(GetSessionContextResponse.parse({
          role: "parent", fullName, accountRole: "parent", effectivePermissions,
          branchScope: { fullAccess: false, branchIds: [], organizations: [], branches: [] },
        }));
        return;
      }
    }
    res.json(GetSessionContextResponse.parse({
      role: "pending", fullName, accountRole: "pending", effectivePermissions,
      branchScope: { fullAccess: false, branchIds: [], organizations: [], branches: [] },
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to resolve application session context");
    next(error);
  }
});
router.use("/parent", requireParentGuardian);
router.use(resolveNurseryContext);

router.use(async (req, res, next) => {
  if (req.path.startsWith("/parent/")) {
    next();
    return;
  }
  try {
    const routePermission = (() => {
      if (req.path === "/dashboard/activity") return "read:audit";
      if (req.path.startsWith("/dashboard/")) return "read:dashboard";
      if (req.path === "/guardians/accounts") return "read:guardian-account";
      if (/^\/guardians\/\d+\/(account|details)$/.test(req.path)) return "write:guardian-account";
      if (/^\/guardians\/\d+$/.test(req.path) && req.method === "DELETE") return "delete:guardian-account";
      if (/^\/staff\/\d+\/scope$/.test(req.path)) return "write:users";
      if (/^\/staff\/\d+\/account$/.test(req.path)) return "write:users";
      if (req.path === "/guardians" || req.path.startsWith("/guardians/")) {
        return req.method === "GET" ? "read:children" : "write:children";
      }
      if (req.path.startsWith("/children")) {
        return req.method === "GET" ? "read:children"
          : req.method === "DELETE" ? "delete:children" : "write:children";
      }
      if (req.path === "/classrooms") return req.method === "GET" ? "read:classroom-schedule" : "write:classroom-schedule";
      if (req.path.startsWith("/staff")) {
        return req.method === "GET" ? "read:staff-profile"
          : req.method === "DELETE" ? "delete:staff-profile" : "write:staff-profile";
      }
      if (req.path.startsWith("/attendance")) return req.method === "GET" ? "read:attendance" : "write:attendance";
      if (req.path === "/finance/summary") return "read:report-financial";
      if (req.path === "/invoices") return "read:invoice";
      if (/^\/invoices\/\d+\/checkout-session$/.test(req.path)) return "write:payment";
      if (/^\/invoices\/\d+\/cash-payment$/.test(req.path)) return "write:payment";
      if (/^\/invoices\/\d+\/reminder$/.test(req.path)) return "write:notification";
      return null;
    })();
    if (!routePermission || !await permitted(req, routePermission)) {
      res.status(403).json({ error: "Operation not permitted" });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "Failed to resolve administrative role");
    next(error);
  }
});

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const { ownerId, branchIds } = nurseryContext(req);
  const [children, attendance, staff, invoiceRows, payments, refunds] = await Promise.all([
    db.select().from(childrenTable).where(and(
      eq(childrenTable.ownerId, ownerId), branchCondition(childrenTable.branchId, branchIds),
    )),
    db.select({ attendance: attendanceTable })
      .from(attendanceTable)
      .innerJoin(childrenTable, and(
        eq(attendanceTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, ownerId),
        branchCondition(childrenTable.branchId, branchIds),
      ))
      .where(eq(attendanceTable.date, today())),
    db.select().from(staffTable).where(and(
      eq(staffTable.ownerId, ownerId), branchCondition(staffTable.branchId, branchIds),
    )),
    db
      .select({ invoice: invoicesTable })
      .from(invoicesTable)
      .innerJoin(childrenTable, and(
        eq(invoicesTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, ownerId),
        branchCondition(childrenTable.branchId, branchIds),
      ))
      .innerJoin(guardiansTable, and(
        eq(invoicesTable.guardianId, guardiansTable.id),
        eq(guardiansTable.ownerId, ownerId),
        branchCondition(guardiansTable.branchId, branchIds),
      ))
      .where(and(eq(invoicesTable.ownerId, ownerId), branchCondition(invoicesTable.branchId, branchIds))),
    db.select().from(invoicePaymentsTable).where(and(
      eq(invoicePaymentsTable.ownerId, ownerId),
      inArray(invoicePaymentsTable.status, ["completed", "succeeded"]),
      inArray(invoicePaymentsTable.invoiceId, db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
        eq(invoicesTable.ownerId, ownerId), branchCondition(invoicesTable.branchId, branchIds),
      ))),
    )),
    db.select().from(invoiceRefundsTable).where(and(
      eq(invoiceRefundsTable.ownerId, ownerId),
      inArray(invoiceRefundsTable.invoiceId, db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
        eq(invoicesTable.ownerId, ownerId), branchCondition(invoicesTable.branchId, branchIds),
      ))),
    )),
  ]);
  const invoices = invoiceRows.map(({ invoice }) => invoice);
  const presentToday = attendance.filter(({ attendance: entry }) => entry.status === "present" || entry.status === "late").length;
  const absentToday = attendance.filter(({ attendance: entry }) => entry.status === "absent").length;
  const now = new Date();
  const monthlyRevenue = payments.filter((payment) => payment.createdAt.getUTCFullYear() === now.getUTCFullYear()
    && payment.createdAt.getUTCMonth() === now.getUTCMonth()).reduce((sum, payment) => sum + payment.amount, 0)
    - refunds.filter((refund) => refund.createdAt.getUTCFullYear() === now.getUTCFullYear()
      && refund.createdAt.getUTCMonth() === now.getUTCMonth()).reduce((sum, refund) => sum + refund.amount, 0);
  const pendingPayments = invoices
    .filter((invoice) => !["draft", "cancelled"].includes(invoice.status))
    .reduce((sum, invoice) => sum + Math.max(0, invoice.amount
      - payments.filter((payment) => payment.invoiceId === invoice.id).reduce((n, payment) => n + payment.amount, 0)
      + refunds.filter((refund) => refund.invoiceId === invoice.id).reduce((n, refund) => n + refund.amount, 0)), 0);
  const data = GetDashboardSummaryResponse.parse({
    totalChildren: children.filter((child) => child.status === "active").length,
    presentToday,
    absentToday,
    staffCount: staff.length,
    monthlyRevenue,
    pendingPayments,
    attendanceRate: children.length ? Math.round((presentToday / children.length) * 100) : 0,
  });
  req.log.info("Returned dashboard summary");
  res.json(data);
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const { ownerId, branchIds } = nurseryContext(req);
  const activities = await db
    .select()
    .from(activitiesTable)
    .where(and(
      eq(activitiesTable.ownerId, ownerId),
      branchCondition(activitiesTable.branchId, branchIds),
    ))
    .orderBy(desc(activitiesTable.createdAt))
    .limit(8);
  res.json(GetDashboardActivityResponse.parse(activities.map((entry) => ({
    ...entry,
    createdAt: entry.createdAt.toISOString(),
  }))));
});

router.get("/children", async (req, res): Promise<void> => {
  const parsed = ListChildrenQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search?.trim().toLowerCase();
  const context = nurseryContext(req);
  const rows = (await childRows(context.ownerId, context.branchIds)).filter((child) => {
    const matchesSearch = !search || `${child.fullName} ${child.guardianName}`.toLowerCase().includes(search);
    const matchesClassroom = !parsed.data.classroomId || child.classroomId === parsed.data.classroomId;
    return matchesSearch && matchesClassroom;
  });
  res.json(ListChildrenResponse.parse(rows));
});

router.post("/children", async (req, res): Promise<void> => {
  const parsed = CreateChildBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const { ownerId, branchIds } = nurseryContext(req);
  if (input.branchId != null && !requireBranchAccess({ branchIds }, input.branchId)) {
    res.status(403).json({ error: "Branch not permitted" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const branch = await resolveBranchId(tx, ownerId, input.branchId, branchIds);
    if (branch.kind === "missing") return { kind: "branchMissing" as const };
    if (!requireBranchAccess({ branchIds }, branch.branchId)) return { kind: "branchNotPermitted" as const };
    if (input.classroomId != null) {
      if (await classroomBranchMismatch(tx, ownerId, input.classroomId, branch.branchId)) {
        return { kind: "branchMismatch" as const };
      }
      const capacity = await checkClassroomCapacity(tx, ownerId, input.classroomId);
      if (capacity.kind !== "available") return capacity;
    }
    // Try to find an existing guardian by normalized phone
    const normalizedPhone = normalizeKuwaitPhone(input.guardianPhone);
    let guardian: typeof guardiansTable.$inferSelect | undefined;
    if (normalizedPhone) {
      const normalizedDbPhoneExpr = sql`'965' || right(regexp_replace(${guardiansTable.phone}, '\\D', '', 'g'), 8)`;
      const [existing] = await tx.select().from(guardiansTable).where(and(
        eq(guardiansTable.ownerId, ownerId),
        branchCondition(guardiansTable.branchId, branchIds),
        eq(normalizedDbPhoneExpr, normalizedPhone),
      )).limit(1);
      if (existing) {
        // Update the existing guardian name if provided
        const [updated] = await tx.update(guardiansTable).set({
          name: input.guardianName,
        }).where(eq(guardiansTable.id, existing.id)).returning();
        guardian = updated;
      }
    }
    if (!guardian) {
      const identityKey = normalizedPhone ? `phone:${normalizedPhone}` : null;
      const [created] = await tx.insert(guardiansTable).values({
        ownerId,
        name: input.guardianName,
        phone: input.guardianPhone,
        email: null,
        balance: 0,
        identityKey,
        branchId: branch.branchId,
      }).returning();
      guardian = created;
    }
    const [child] = await tx.insert(childrenTable).values({
      ownerId,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      birthDate: input.birthDate,
      classroomId: input.classroomId ?? null,
      branchId: branch.branchId,
      guardianId: guardian.id,
      level: input.level,
      notes: input.notes ?? null,
    }).returning();
    return { kind: "created" as const, child };
  });
  if (result.kind === "branchMissing") {
    res.status(400).json({ error: "Branch not found" });
    return;
  }
  if (result.kind === "branchNotPermitted") {
    res.status(403).json({ error: "Branch not permitted" });
    return;
  }
  if (result.kind === "branchMismatch") {
    res.status(409).json({ error: "Classroom belongs to another branch" });
    return;
  }
  if (result.kind === "missing") {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (result.kind === "full") {
    res.status(409).json({ error: "Classroom is full" });
    return;
  }
  const child = result.child;
  const record = (await childRows(ownerId, branchIds)).find((row) => row.id === child.id);
  await auditNurseryOperation(req, "create", "child", String(child.id), null, child as unknown as Record<string, unknown>);
  res.status(201).json(CreateChildResponse.parse(record));
});

router.get("/children/:id", async (req, res): Promise<void> => {
  const parsed = GetChildParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const context = nurseryContext(req);
  const record = (await childRows(context.ownerId, context.branchIds)).find((row) => row.id === parsed.data.id);
  if (!record) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  res.json(GetChildResponse.parse(record));
});

router.patch("/children/:id", async (req, res): Promise<void> => {
  const params = UpdateChildParams.safeParse(req.params);
  const body = UpdateChildBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const [current] = await db.select().from(childrenTable).where(and(
    eq(childrenTable.id, params.data.id),
    eq(childrenTable.ownerId, ownerId),
    branchCondition(childrenTable.branchId, branchIds),
  ));
  if (!current) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  const updateResult = await db.transaction(async (tx) => {
    const targetBranchId = body.data.branchId ?? current.branchId;
    const branch = await resolveBranchId(tx, ownerId, targetBranchId, branchIds);
    if (branch.kind === "missing") return { kind: "branchMissing" as const };
    if (!requireBranchAccess({ branchIds }, branch.branchId)) return { kind: "branchNotPermitted" as const };
    const targetClassroomId = body.data.classroomId === undefined
      ? current.classroomId
      : body.data.classroomId;
    const targetStatus = body.data.status ?? current.status;
    if (targetClassroomId != null) {
      if (await classroomBranchMismatch(tx, ownerId, targetClassroomId, targetBranchId)) {
        return { kind: "branchMismatch" as const };
      }
      if (targetStatus === "active") {
        const capacity = await checkClassroomCapacity(tx, ownerId, targetClassroomId, current.id);
        if (capacity.kind !== "available") return capacity;
      }
    }
    if (body.data.guardianName !== undefined || body.data.guardianPhone !== undefined) {
      await tx.update(guardiansTable).set({
        ...(body.data.guardianName !== undefined ? { name: body.data.guardianName } : {}),
        ...(body.data.guardianPhone !== undefined ? { phone: body.data.guardianPhone } : {}),
      }).where(and(
        eq(guardiansTable.id, current.guardianId),
        eq(guardiansTable.ownerId, ownerId),
        branchCondition(guardiansTable.branchId, branchIds),
      ));
    }
    await tx.update(childrenTable).set({
      ...(body.data.firstName !== undefined ? { firstName: body.data.firstName } : {}),
      ...(body.data.lastName !== undefined ? { lastName: body.data.lastName } : {}),
      ...(body.data.gender !== undefined ? { gender: body.data.gender } : {}),
      ...(body.data.birthDate !== undefined ? { birthDate: body.data.birthDate } : {}),
      ...(body.data.classroomId !== undefined ? { classroomId: body.data.classroomId } : {}),
      branchId: branch.branchId,
      ...(body.data.level !== undefined ? { level: body.data.level } : {}),
      ...(body.data.status !== undefined ? { status: body.data.status } : {}),
      ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
    }).where(and(
      eq(childrenTable.id, params.data.id),
      eq(childrenTable.ownerId, ownerId),
      branchCondition(childrenTable.branchId, branchIds),
    ));
    return { kind: "updated" as const };
  });
  if (updateResult.kind === "branchMissing") {
    res.status(400).json({ error: "Branch not found" });
    return;
  }
  if (updateResult.kind === "branchNotPermitted") {
    res.status(403).json({ error: "Branch not permitted" });
    return;
  }
  if (updateResult.kind === "branchMismatch") {
    res.status(409).json({ error: "Classroom belongs to another branch" });
    return;
  }
  if (updateResult.kind === "missing") {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (updateResult.kind === "full") {
    res.status(409).json({ error: "Classroom is full" });
    return;
  }
  const record = (await childRows(ownerId, branchIds)).find((row) => row.id === params.data.id);
  await auditNurseryOperation(
    req, "update", "child", String(current.id),
    current as unknown as Record<string, unknown>,
    record as unknown as Record<string, unknown>,
  );
  res.json(UpdateChildResponse.parse(record));
});

router.delete("/children/:id", async (req, res): Promise<void> => {
  const parsed = DeleteChildParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const deletion = await db.transaction(async (tx) => {
    await tx.execute(sql`
      select id from children
      where id = ${parsed.data.id} and owner_id = ${ownerId}
      for update
    `);
    const [child] = await tx.select().from(childrenTable).where(and(
      eq(childrenTable.id, parsed.data.id),
      eq(childrenTable.ownerId, ownerId),
      branchCondition(childrenTable.branchId, branchIds),
    ));
    if (!child) return { kind: "missing" as const };
    const [plan] = await tx.select({ id: billingPlansTable.id }).from(billingPlansTable)
      .where(and(eq(billingPlansTable.childId, child.id), eq(billingPlansTable.ownerId, ownerId)))
      .limit(1);
    if (plan) return { kind: "billing-history" as const };
    const [deleted] = await tx.delete(childrenTable).where(and(
      eq(childrenTable.id, child.id),
      eq(childrenTable.ownerId, ownerId),
      branchCondition(childrenTable.branchId, branchIds),
    )).returning();
    return deleted ? { kind: "deleted" as const, deleted } : { kind: "missing" as const };
  });
  if (deletion.kind === "billing-history") {
    res.status(409).json({ error: "Child cannot be deleted because billing plans and financial records must be preserved" });
    return;
  }
  const deleted = deletion.kind === "deleted" ? deletion.deleted : undefined;
  if (!deleted) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  await auditNurseryOperation(req, "delete", "child", String(deleted.id), deleted as unknown as Record<string, unknown>, null);
  res.sendStatus(204);
});

router.get("/guardians", async (req, res): Promise<void> => {
  const { ownerId, branchIds } = nurseryContext(req);
  const [guardians, children] = await Promise.all([
    db.select().from(guardiansTable).where(and(
      eq(guardiansTable.ownerId, ownerId), branchCondition(guardiansTable.branchId, branchIds),
    )),
    db.select().from(childrenTable).where(and(
      eq(childrenTable.ownerId, ownerId), branchCondition(childrenTable.branchId, branchIds),
    )),
  ]);
  res.json(ListGuardiansResponse.parse(guardians.map((guardian) => ({
    id: guardian.id,
    name: guardian.name,
    phone: guardian.phone,
    email: guardian.email,
    childrenCount: children.filter((child) => child.guardianId === guardian.id).length,
    balance: guardian.balance,
    branchId: guardian.branchId,
  }))));
});

function guardianAccountResponse(
  guardian: typeof guardiansTable.$inferSelect,
  account: typeof publicAuthAccountsTable.$inferSelect | undefined,
) {
  return {
    guardianId: guardian.id,
    name: guardian.name,
    phone: guardian.phone,
    email: guardian.email,
    clerkUserId: guardian.clerkUserId,
    accountStatus: !guardian.clerkUserId
      ? "unlinked" as const
      : account?.accountStatus === "pending"
        ? "pending" as const
        : account?.accountStatus === "disabled" ? "disabled" as const : "active" as const,
  };
}

router.get("/guardians/accounts", async (req, res): Promise<void> => {
  const { ownerId, branchIds } = nurseryContext(req);
  const guardians = await db.select().from(guardiansTable).where(and(
    eq(guardiansTable.ownerId, ownerId), branchCondition(guardiansTable.branchId, branchIds),
  ));
  const accounts = await db.select().from(publicAuthAccountsTable)
    .where(and(eq(publicAuthAccountsTable.accountType, "guardian"), eq(publicAuthAccountsTable.ownerId, ownerId)));
  const accountsByGuardianId = new Map(accounts.filter((account) => account.guardianId !== null)
    .map((account) => [account.guardianId as number, account]));
  res.json(ListGuardianAccountsResponse.parse(guardians.map((guardian) =>
    guardianAccountResponse(guardian, accountsByGuardianId.get(guardian.id)))));
});

router.patch("/guardians/:id/account", async (req, res): Promise<void> => {
  const params = UpdateGuardianAccountParams.safeParse(req.params);
  const body = UpdateGuardianAccountBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }
  if (!await accountManager(req, "write:guardian-account")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const [guardian] = await db.select().from(guardiansTable).where(and(
    eq(guardiansTable.id, params.data.id), eq(guardiansTable.ownerId, ownerId),
    branchCondition(guardiansTable.branchId, branchIds),
  )).limit(1);
  if (!guardian) {
    res.status(404).json({ error: "Linked guardian account not found" });
    return;
  }
  const status = body.data.status;
  // Update account in publicAuthAccountsTable by guardianId
  const [account] = await db.update(publicAuthAccountsTable).set({
    accountStatus: status,
    role: "parent",
    ownerId,
  }).where(and(
    eq(publicAuthAccountsTable.guardianId, guardian.id),
    eq(publicAuthAccountsTable.ownerId, ownerId),
  )).returning();
  await auditNurseryOperation(req, "update-guardian-account", "guardian-account", String(guardian.id),
    { accountStatus: account ? (status === "active" ? "disabled" : "active") : null },
    { accountStatus: status });
  res.json(UpdateGuardianAccountResponse.parse(guardianAccountResponse(guardian, account)));
});

router.patch("/guardians/:id/details", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid guardian ID" }); return; }
  const { name, phone, email } = req.body as { name?: string; phone?: string; email?: string };
  if (!name && !phone && !email) { res.status(400).json({ error: "Provide at least one field to update" }); return; }
  if (!await accountManager(req, "write:guardian-account")) { res.status(403).json({ error: "Operation not permitted" }); return; }
  const { ownerId, branchIds } = nurseryContext(req);
  const [guardian] = await db.select().from(guardiansTable).where(and(
    eq(guardiansTable.id, id), eq(guardiansTable.ownerId, ownerId),
    branchCondition(guardiansTable.branchId, branchIds),
  )).limit(1);
  if (!guardian) { res.status(404).json({ error: "Guardian not found" }); return; }
  const updates: Partial<{ name: string; phone: string; email: string }> = {};
  if (name && name.trim()) updates.name = name.trim();
  if (phone && phone.trim()) updates.phone = phone.trim();
  if (typeof email === "string") updates.email = email.trim() || null as unknown as string;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid updates" }); return; }
  const [updated] = await db.update(guardiansTable).set(updates).where(and(
    eq(guardiansTable.id, id), eq(guardiansTable.ownerId, ownerId),
    branchCondition(guardiansTable.branchId, branchIds),
  )).returning();
  // Also update publicAuthAccountsTable if account exists
  if (updated) {
    const accountUpdates: Partial<{ fullName: string; normalizedPhone: string; email: string }> = {};
    if (updates.name) accountUpdates.fullName = updates.name;
    if (updates.phone) accountUpdates.normalizedPhone = updates.phone;
    if (typeof updates.email === "string") accountUpdates.email = updates.email;
    if (Object.keys(accountUpdates).length > 0) {
      await db.update(publicAuthAccountsTable).set(accountUpdates).where(and(
        eq(publicAuthAccountsTable.guardianId, updated.id),
        eq(publicAuthAccountsTable.ownerId, ownerId),
      ));
    }
  }
  res.json({ guardianId: updated.id, name: updated.name, phone: updated.phone, email: updated.email });
});

router.delete("/guardians/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid guardian ID" }); return; }
  if (!await accountManager(req, "delete:guardian-account")) { res.status(403).json({ error: "Operation not permitted" }); return; }
  const { ownerId, branchIds } = nurseryContext(req);
  const [guardian] = await db.select().from(guardiansTable).where(and(
    eq(guardiansTable.id, id), eq(guardiansTable.ownerId, ownerId),
    branchCondition(guardiansTable.branchId, branchIds),
  )).limit(1);
  if (!guardian) { res.status(404).json({ error: "Guardian not found" }); return; }
  // Delete linked auth account
  await db.delete(publicAuthAccountsTable).where(and(
    eq(publicAuthAccountsTable.guardianId, id),
    eq(publicAuthAccountsTable.ownerId, ownerId),
  ));
  // Delete guardian record
  await db.delete(guardiansTable).where(and(
    eq(guardiansTable.id, id), eq(guardiansTable.ownerId, ownerId),
    branchCondition(guardiansTable.branchId, branchIds),
  ));
  await auditNurseryOperation(req, "delete-guardian", "guardian", String(id), { name: guardian.name, phone: guardian.phone }, null);
  res.json({ ok: true });
});

router.get("/classrooms", async (req, res): Promise<void> => {
  const { ownerId, branchIds } = nurseryContext(req);
  const [classrooms, children] = await Promise.all([
    db.select().from(classroomsTable).where(and(
      eq(classroomsTable.ownerId, ownerId), branchCondition(classroomsTable.branchId, branchIds),
    )),
    db.select().from(childrenTable).where(and(
      eq(childrenTable.ownerId, ownerId), branchCondition(childrenTable.branchId, branchIds),
    )),
  ]);
  res.json(ListClassroomsResponse.parse(classrooms.map(({ ownerId: _ownerId, ...classroom }) => ({
    ...classroom,
    childrenCount: children.filter((child) =>
      child.classroomId === classroom.id && child.status === "active").length,
  }))));
});

router.get("/staff", async (req, res): Promise<void> => {
  const { ownerId, branchIds } = nurseryContext(req);
  const staff = await db.select().from(staffTable).where(and(
    eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
  ));
  res.json(ListStaffResponse.parse(await Promise.all(staff.map(staffResponse))));
});

router.post("/staff", async (req, res): Promise<void> => {
  const body = CreateStaffBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  if (body.data.branchId != null && !requireBranchAccess({ branchIds }, body.data.branchId)) {
    res.status(403).json({ error: "Branch not permitted" });
    return;
  }
  const branch = await resolveBranchId(db, ownerId, body.data.branchId, branchIds);
  if (branch.kind === "missing") {
    res.status(400).json({ error: "Branch not found" });
    return;
  }
  if (!requireBranchAccess({ branchIds }, branch.branchId)) {
    res.status(403).json({ error: "Branch not permitted" });
    return;
  }
  const [created] = await db.insert(staffTable).values({
    ownerId,
    ...body.data,
    branchId: branch.branchId,
  }).returning();
  await auditNurseryOperation(req, "create-staff", "staff", String(created.id), null, {
    id: created.id, name: created.name, role: created.role, accountStatus: created.accountStatus,
  });
  res.status(201).json(CreateStaffResponse.parse(await staffResponse(created)));
});

router.patch("/staff/:id", async (req, res): Promise<void> => {
  const params = UpdateStaffParams.safeParse(req.params);
  const body = UpdateStaffBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const [existing] = await db.select().from(staffTable).where(and(
    eq(staffTable.id, params.data.id), eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
  )).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  if (existing.clerkUserId && body.data.role !== existing.role) {
    res.status(409).json({ error: "Use staff account management to change a linked account role" });
    return;
  }
  if (body.data.branchId != null && !requireBranchAccess({ branchIds }, body.data.branchId)) {
    res.status(403).json({ error: "Branch not permitted" });
    return;
  }
  const branch = await resolveBranchId(db, ownerId, body.data.branchId ?? existing.branchId, branchIds);
  if (branch.kind === "missing") {
    res.status(400).json({ error: "Branch not found" });
    return;
  }
  const [updated] = await db.update(staffTable).set({
    ...body.data,
    branchId: branch.branchId,
  }).where(and(
    eq(staffTable.id, existing.id), eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
  )).returning();
  await auditNurseryOperation(req, "update-staff", "staff", String(updated.id),
    staffAuditSnapshot(existing), staffAuditSnapshot(updated));
  res.json(UpdateStaffResponse.parse(await staffResponse(updated)));
});

router.delete("/staff/:id", async (req, res): Promise<void> => {
  const params = DeleteStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const [existing] = await db.select().from(staffTable).where(and(
    eq(staffTable.id, params.data.id), eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
  )).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  if (existing.clerkUserId) {
    res.status(409).json({ error: "Disable and unlink the staff account before deleting the record" });
    return;
  }
  await db.delete(staffTable).where(and(
    eq(staffTable.id, existing.id), eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
  ));
  await auditNurseryOperation(req, "delete-staff", "staff", String(existing.id),
    staffAuditSnapshot(existing), null);
  res.sendStatus(204);
});

router.put("/staff/:id/scope", async (req, res): Promise<void> => {
  const params = SetStaffScopeParams.safeParse(req.params);
  const body = SetStaffScopeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }
  const context = nurseryContext(req);
  const [member] = await db.select().from(staffTable).where(and(
    eq(staffTable.id, params.data.id),
    eq(staffTable.ownerId, context.ownerId),
    branchCondition(staffTable.branchId, context.branchIds),
  )).limit(1);
  if (!member) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  const organizationIds = [...new Set(body.data.organizationIds)];
  const branchIds = [...new Set(body.data.branchIds)];
  const organizations = organizationIds.length === 0 ? [] : await db.select({ id: organizationsTable.id })
    .from(organizationsTable).where(and(
      eq(organizationsTable.ownerId, context.ownerId),
      inArray(organizationsTable.id, organizationIds),
    ));
  const branches = branchIds.length === 0 ? [] : await db.select({ id: branchesTable.id })
    .from(branchesTable).where(and(
      eq(branchesTable.ownerId, context.ownerId),
      inArray(branchesTable.id, branchIds),
    ));
  if (organizations.length !== organizationIds.length || branches.length !== branchIds.length) {
    res.status(400).json({ error: "Scope references must belong to this nursery" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(staffScopeAssignmentsTable).where(and(
      eq(staffScopeAssignmentsTable.ownerId, context.ownerId),
      eq(staffScopeAssignmentsTable.staffId, member.id),
    ));
    if (organizationIds.length > 0 || branchIds.length > 0) {
      await tx.insert(staffScopeAssignmentsTable).values([
        ...organizationIds.map((organizationId) => ({
          ownerId: context.ownerId, staffId: member.id, organizationId, branchId: null,
        })),
        ...branchIds.map((branchId) => ({
          ownerId: context.ownerId, staffId: member.id, organizationId: null, branchId,
        })),
      ]);
    }
  });
  res.json(SetStaffScopeResponse.parse(await staffResponse(member)));
});

router.post("/staff/:id/account", async (req, res): Promise<void> => {
  const params = LinkStaffAccountParams.safeParse(req.params);
  const body = LinkStaffAccountBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }
  if (!await accountManager(req)) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const [member] = await db.select().from(staffTable).where(and(
    eq(staffTable.id, params.data.id), eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
  )).limit(1);
  if (!member) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  const role = body.data.role.toLowerCase();
  if (!staffAccountRoles.has(role)) {
    res.status(400).json({ error: "Select a supported account role first" });
    return;
  }
  if (member.clerkUserId || !["unlinked", "pending_verification"].includes(member.accountStatus)) {
    res.status(409).json({ error: "Unlink the current account before linking another user" });
    return;
  }
  // body.data.clerkUserId now treated as the local account reference (accountId)
  const accountRef = body.data.clerkUserId;
  const accountId = accountRef.startsWith("local_") ? Number(accountRef.slice(6)) : Number(accountRef);
  const [account] = await db.select().from(publicAuthAccountsTable)
    .where(eq(publicAuthAccountsTable.id, accountId)).limit(1);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (account.ownerId && account.ownerId !== ownerId) {
    res.status(409).json({ error: "Account already belongs to another nursery" });
    return;
  }
  const localRef = `local_${account.id}`;
  const [linkedElsewhere] = await db.select({ id: staffTable.id }).from(staffTable)
    .where(eq(staffTable.clerkUserId, localRef)).limit(1);
  if (linkedElsewhere && linkedElsewhere.id !== member.id) {
    res.status(409).json({ error: "Account is already linked to another staff record" });
    return;
  }
  const [reserved] = await db.update(staffTable).set({
    clerkUserId: localRef, role, accountStatus: "active", otpHash: null, otpExpiresAt: null, otpAttempts: 0,
  }).where(and(
    eq(staffTable.id, member.id),
    eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
    sql`${staffTable.clerkUserId} is null`,
    inArray(staffTable.accountStatus, ["unlinked", "pending_verification"]),
  )).returning();
  if (!reserved) {
    res.status(409).json({ error: "Staff account state changed; reload and try again" });
    return;
  }
  // Update the account record
  await db.update(publicAuthAccountsTable).set({
    ownerId, role, accountStatus: "active", staffId: member.id,
  }).where(eq(publicAuthAccountsTable.id, account.id));
  const updated = reserved;
  await auditNurseryOperation(req, "link-staff-account", "staff-account", String(member.id),
    { clerkUserId: member.clerkUserId, accountStatus: member.accountStatus },
    { clerkUserId: updated.clerkUserId, accountStatus: updated.accountStatus, role });
  res.json(LinkStaffAccountResponse.parse(accountResult(updated)));
});

router.patch("/staff/:id/account", async (req, res): Promise<void> => {
  const params = UpdateStaffAccountParams.safeParse(req.params);
  const body = UpdateStaffAccountBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }
  if (!await accountManager(req)) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const [member] = await db.select().from(staffTable).where(and(
    eq(staffTable.id, params.data.id), eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
  )).limit(1);
  if (!member || !member.clerkUserId) {
    res.status(404).json({ error: "Linked staff account not found" });
    return;
  }
  const role = body.data.role ?? member.role.toLowerCase();
  const accountStatus = body.data.status ?? member.accountStatus;
  if (accountStatus === "unlinked") {
    const [updated] = await db.update(staffTable).set({
      clerkUserId: null,
      accountStatus: "unlinked",
      otpHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
    }).where(and(
      eq(staffTable.id, member.id),
      eq(staffTable.ownerId, ownerId),
      branchCondition(staffTable.branchId, branchIds),
    )).returning();
    // Update the linked account record
    if (member.clerkUserId) {
      const accountId = member.clerkUserId.startsWith("local_") ? Number(member.clerkUserId.slice(6)) : null;
      if (accountId) {
        await db.update(publicAuthAccountsTable).set({
          accountStatus: "pending",
          ownerId: null,
          staffId: null,
        }).where(eq(publicAuthAccountsTable.id, accountId));
      }
    }
    await auditNurseryOperation(req, "unlink-staff-account", "staff-account", String(member.id),
      { role: member.role, accountStatus: member.accountStatus, clerkUserId: member.clerkUserId },
      { role: updated.role, accountStatus: updated.accountStatus, clerkUserId: null });
    res.json(UpdateStaffAccountResponse.parse(accountResult(updated)));
    return;
  }
  const [updated] = await db.update(staffTable).set({
    role,
    accountStatus,
    otpHash: null,
    otpExpiresAt: null,
    otpAttempts: 0,
  }).where(and(
    eq(staffTable.id, member.id),
    eq(staffTable.ownerId, ownerId),
    branchCondition(staffTable.branchId, branchIds),
  )).returning();
  // Update the linked account record
  if (member.clerkUserId) {
    const accountId = member.clerkUserId.startsWith("local_") ? Number(member.clerkUserId.slice(6)) : null;
    if (accountId) {
      await db.update(publicAuthAccountsTable).set({
        accountStatus: accountStatus === "active" ? "active" : "pending",
        role,
        ownerId: accountStatus === "active" ? ownerId : null,
      }).where(eq(publicAuthAccountsTable.id, accountId));
    }
  }
  await auditNurseryOperation(req, "update-staff-account", "staff-account", String(member.id),
    { role: member.role, accountStatus: member.accountStatus },
    { role: updated.role, accountStatus: updated.accountStatus });
  res.json(UpdateStaffAccountResponse.parse(accountResult(updated)));
});

router.get("/attendance/today", async (req, res): Promise<void> => {
  const { ownerId, branchIds } = nurseryContext(req);
  const [records, children] = await Promise.all([
    db.select({ attendance: attendanceTable })
      .from(attendanceTable)
      .innerJoin(childrenTable, and(
        eq(attendanceTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, ownerId),
        branchCondition(childrenTable.branchId, branchIds),
      ))
      .where(eq(attendanceTable.date, today())),
    db.select().from(childrenTable).where(and(
      eq(childrenTable.ownerId, ownerId), branchCondition(childrenTable.branchId, branchIds),
    )),
  ]);
  const childMap = new Map(children.map((child) => [child.id, child]));
  res.json(GetTodayAttendanceResponse.parse(records.map(({ attendance: record }) => {
    const child = childMap.get(record.childId);
    return {
      ...record,
      correctedAt: record.correctedAt?.toISOString() ?? null,
      childName: child ? `${child.firstName} ${child.lastName}` : "طفل غير معروف",
    };
  })));
});

router.post("/attendance", async (req, res): Promise<void> => {
  const parsed = RecordAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { branchIds } = nurseryContext(req);
  const [child] = await db.select().from(childrenTable).where(and(
    eq(childrenTable.id, parsed.data.childId),
    eq(childrenTable.ownerId, nurseryContext(req).ownerId),
    branchCondition(childrenTable.branchId, branchIds),
  ));
  if (!child) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  if (parsed.data.checkOut != null) {
    const override = parsed.data.pickupOverride === true;
    if (override && (!parsed.data.pickupOverrideReason?.trim() || !await permitted(req, "read:child-confidential"))) {
      res.status(403).json({ error: "Pickup override requires privileged access and a reason" });
      return;
    }
    if (!override) {
      if (!parsed.data.pickupIdentity?.trim()) {
        res.status(400).json({ error: "Pickup identity is required for checkout" });
        return;
      }
      const [authorized] = await db.select({ id: childContactsTable.id }).from(childContactsTable).where(and(
        eq(childContactsTable.ownerId, child.ownerId), eq(childContactsTable.childId, child.id),
        inArray(childContactsTable.type, ["authorized_pickup", "guardian"]),
        eq(childContactsTable.status, "active"), eq(childContactsTable.identityNumber, parsed.data.pickupIdentity.trim()),
      )).limit(1);
      if (!authorized) {
        res.status(403).json({ error: "Pickup identity is not authorized for this child" });
        return;
      }
    }
  }
  const [existing] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.childId, parsed.data.childId),
    eq(attendanceTable.date, parsed.data.date),
  ));
  const payload = {
    status: parsed.data.status,
    checkIn: parsed.data.checkIn ?? null,
    checkOut: parsed.data.checkOut ?? null,
    departureType: parsed.data.departureType ?? null,
    source: parsed.data.source ?? "manual",
    recordedBy: nurseryContext(req).actorId,
    note: parsed.data.note ?? null,
    pickupName: parsed.data.pickupName ?? null,
    pickupIdentity: parsed.data.pickupIdentity ?? null,
    correctionReason: existing ? parsed.data.correctionReason ?? null : null,
    correctedAt: existing ? new Date() : null,
  };
  const [record] = existing
    ? await db.update(attendanceTable).set(payload).where(eq(attendanceTable.id, existing.id)).returning()
    : await db.insert(attendanceTable).values({ childId: parsed.data.childId, date: parsed.data.date, ...payload }).returning();
  await auditNurseryOperation(
    req, existing ? "update" : "create", "child-attendance", String(record.id),
    existing as unknown as Record<string, unknown> | null,
    {
      ...(record as unknown as Record<string, unknown>),
      ...(parsed.data.pickupOverride ? { pickupOverrideReason: parsed.data.pickupOverrideReason } : {}),
    },
  );
  res.status(201).json(RecordAttendanceResponse.parse({
    ...record,
    correctedAt: record.correctedAt?.toISOString() ?? null,
    childName: `${child.firstName} ${child.lastName}`,
  }));
});

router.post("/classrooms", async (req, res): Promise<void> => {
  const parsed = CreateClassroomBody.safeParse(req.body);
  if (!parsed.success || !Number.isSafeInteger(parsed.data.capacity)) {
    res.status(400).json({
      error: parsed.success ? "Classroom capacity must be a whole number" : parsed.error.message,
    });
    return;
  }
  const context = nurseryContext(req);
  if (parsed.data.branchId != null && !requireBranchAccess(context, parsed.data.branchId)) {
    res.status(403).json({ error: "Branch not permitted" });
    return;
  }
  const branch = await resolveBranchId(db, context.ownerId, parsed.data.branchId, context.branchIds);
  if (branch.kind === "missing") {
    res.status(400).json({ error: "Branch not found" });
    return;
  }
  if (!requireBranchAccess(context, branch.branchId)) {
    res.status(403).json({ error: "Branch not permitted" });
    return;
  }
  const [classroom] = await db.insert(classroomsTable).values({
    ownerId: context.ownerId,
    name: parsed.data.name,
    level: parsed.data.level,
    teacherName: parsed.data.teacherName,
    capacity: parsed.data.capacity,
    color: parsed.data.color ?? "teal",
    branchId: branch.branchId,
    stageId: parsed.data.stageId ?? null,
    schedule: parsed.data.schedule ?? {},
  }).returning();
  const { ownerId: _ownerId, ...data } = classroom;
  await auditNurseryOperation(req, "create", "classroom", String(classroom.id), null, classroom as unknown as Record<string, unknown>);
  res.status(201).json(CreateClassroomResponse.parse({ ...data, childrenCount: 0 }));
});

const arMonthLabel = new Intl.DateTimeFormat("ar", { month: "long" });

router.get("/finance/summary", async (req, res): Promise<void> => {
  const { ownerId, branchIds } = nurseryContext(req);
  const invoiceRows = await db
    .select({ invoice: invoicesTable })
    .from(invoicesTable)
    .innerJoin(childrenTable, and(
      eq(invoicesTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, ownerId),
      branchCondition(childrenTable.branchId, branchIds),
    ))
    .innerJoin(guardiansTable, and(
      eq(invoicesTable.guardianId, guardiansTable.id),
      eq(guardiansTable.ownerId, ownerId),
      branchCondition(guardiansTable.branchId, branchIds),
    ))
    .where(and(eq(invoicesTable.ownerId, ownerId), branchCondition(invoicesTable.branchId, branchIds)));
  const invoices = invoiceRows.map(({ invoice }) => invoice);
  const [payments, refunds] = await Promise.all([
    db.select().from(invoicePaymentsTable).where(and(
      eq(invoicePaymentsTable.ownerId, ownerId),
      inArray(invoicePaymentsTable.status, ["completed", "succeeded"]),
      inArray(invoicePaymentsTable.invoiceId, db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
        eq(invoicesTable.ownerId, ownerId), branchCondition(invoicesTable.branchId, branchIds),
      ))),
    )),
    db.select().from(invoiceRefundsTable).where(and(
      eq(invoiceRefundsTable.ownerId, ownerId),
      inArray(invoiceRefundsTable.invoiceId, db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
        eq(invoicesTable.ownerId, ownerId), branchCondition(invoicesTable.branchId, branchIds),
      ))),
    )),
  ]);
  const now = new Date();
  const isSameMonth = (date: Date, ref: Date) =>
    date.getUTCFullYear() === ref.getUTCFullYear() && date.getUTCMonth() === ref.getUTCMonth();

  const collectedThisMonth = payments.filter((payment) => isSameMonth(payment.createdAt, now))
    .reduce((sum, payment) => sum + payment.amount, 0)
    - refunds.filter((refund) => isSameMonth(refund.createdAt, now)).reduce((sum, refund) => sum + refund.amount, 0);
  const outstanding = invoices.filter((invoice) => !["draft", "cancelled"].includes(invoice.status))
    .reduce((sum, invoice) => sum + Math.max(0, invoice.amount
      - payments.filter((payment) => payment.invoiceId === invoice.id).reduce((n, payment) => n + payment.amount, 0)
      + refunds.filter((refund) => refund.invoiceId === invoice.id).reduce((n, refund) => n + refund.amount, 0)), 0);

  const monthlyTrend = Array.from({ length: 3 }, (_, index) => {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (2 - index), 1));
    const collected = payments.filter((payment) => isSameMonth(payment.createdAt, monthDate))
      .reduce((sum, payment) => sum + payment.amount, 0)
      - refunds.filter((refund) => isSameMonth(refund.createdAt, monthDate)).reduce((sum, refund) => sum + refund.amount, 0);
    const expected = invoices
      .filter((invoice) => !["draft", "cancelled"].includes(invoice.status) && isSameMonth(new Date(invoice.dueDate), monthDate))
      .reduce((sum, invoice) => sum + invoice.amount, 0);
    return { month: arMonthLabel.format(monthDate), collected, expected };
  });

  res.json(GetFinanceSummaryResponse.parse({
    collectedThisMonth,
    outstanding,
    overdueCount: invoices.filter((invoice) => invoice.status === "overdue").length,
    paidCount: invoices.filter((invoice) => invoice.status === "paid").length,
    monthlyTrend,
  }));
});

router.get("/invoices", async (req, res): Promise<void> => {
  const parsed = ListInvoicesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { ownerId, branchIds } = nurseryContext(req);
  const invoiceRows = await db
    .select({
      invoice: invoicesTable,
      guardianName: guardiansTable.name,
      childFirstName: childrenTable.firstName,
      childLastName: childrenTable.lastName,
    })
    .from(invoicesTable)
    .innerJoin(childrenTable, and(
      eq(invoicesTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, ownerId),
      branchCondition(childrenTable.branchId, branchIds),
    ))
    .innerJoin(guardiansTable, and(
      eq(invoicesTable.guardianId, guardiansTable.id),
      eq(guardiansTable.ownerId, ownerId),
      branchCondition(guardiansTable.branchId, branchIds),
    ))
    .where(and(eq(invoicesTable.ownerId, ownerId), branchCondition(invoicesTable.branchId, branchIds)));
  const rows = invoiceRows
    .filter(({ invoice }) => !parsed.data.status || invoice.status === parsed.data.status)
    .map(({ invoice, guardianName, childFirstName, childLastName }) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      guardianName,
      childName: `${childFirstName} ${childLastName}`,
      amount: invoice.amount,
      dueDate: invoice.dueDate,
      status: invoice.status,
      paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
      lastPaymentStatus: invoice.lastPaymentStatus,
      lastPaymentError: invoice.lastPaymentError,
      chargedCurrency: invoice.chargedCurrency,
      chargedAmount: invoice.chargedAmount,
      paymentMethod: invoice.paymentMethod,
      paymentReference: invoice.paymentReference,
    }));
  res.json(ListInvoicesResponse.parse(rows));
});

/** Loads an invoice only when the invoice and both related records share the authenticated owner. */
async function loadOwnedInvoice(
  ownerId: string,
  invoiceId: number,
  branchIds: import("../lib/branchScope").BranchScope = null,
) {
  const [row] = await db
    .select({ invoice: invoicesTable })
    .from(invoicesTable)
    .innerJoin(childrenTable, and(
      eq(invoicesTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, ownerId),
      branchCondition(childrenTable.branchId, branchIds),
    ))
    .innerJoin(guardiansTable, and(
      eq(invoicesTable.guardianId, guardiansTable.id),
      eq(guardiansTable.ownerId, ownerId),
      branchCondition(guardiansTable.branchId, branchIds),
    ))
    .where(and(
      eq(invoicesTable.id, invoiceId),
      eq(invoicesTable.ownerId, ownerId),
      branchCondition(invoicesTable.branchId, branchIds),
    ));
  return row?.invoice ?? null;
}

router.post("/invoices/:id/checkout-session", async (req, res): Promise<void> => {
  const params = CreateInvoiceCheckoutSessionParams.safeParse(req.params);
  const body = CreateInvoiceCheckoutSessionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!isAllowedReturnUrl(body.data.returnUrl)) {
    res.status(400).json({ error: "Invalid return URL" });
    return;
  }
  const context = nurseryContext(req);
  const invoice = await loadOwnedInvoice(context.ownerId, params.data.id, context.branchIds);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  try {
    requireCheckoutPayable(invoice.status, invoice.amount);
  } catch {
    res.status(409).json({ error: "Invoice is not payable" });
    return;
  }
  const [guardian] = await db.select().from(guardiansTable).where(and(
    eq(guardiansTable.id, invoice.guardianId),
    eq(guardiansTable.ownerId, context.ownerId),
    branchCondition(guardiansTable.branchId, context.branchIds),
  ));
  if (!guardian) {
    res.status(404).json({ error: "Guardian not found for invoice" });
    return;
  }
  try {
    const session = await createInvoiceCheckoutSession({
      invoice,
      guardian,
      successUrl: `${body.data.returnUrl}?payment=success&invoice=${invoice.id}`,
      cancelUrl: `${body.data.returnUrl}?payment=cancelled&invoice=${invoice.id}`,
    });
    await auditNurseryOperation(req, "create-checkout-session", "invoice", String(invoice.id), null, {
      invoiceId: invoice.id,
      status: invoice.status,
    });
    res.json(CreateInvoiceCheckoutSessionResponse.parse({ url: session.url }));
  } catch (err) {
    req.log.error({ err, invoiceId: invoice.id }, "Failed to create MyFatoorah KNET payment");
    if (err instanceof InvoiceNotPayableError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof PaymentProviderConfigurationError) {
      res.status(503).json({ error: err.message, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
      return;
    }
    if (err instanceof PaymentAttemptInProgressError) {
      res.status(409).json({ error: err.message, code: "PAYMENT_ATTEMPT_IN_PROGRESS" });
      return;
    }
    res.status(502).json({ error: "Failed to create payment session" });
  }
});

router.post("/invoices/:id/cash-payment", async (req, res): Promise<void> => {
  const params = RecordCashInvoicePaymentParams.safeParse(req.params);
  const body = RecordCashInvoicePaymentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const context = nurseryContext(req);
  const invoice = await loadOwnedInvoice(context.ownerId, params.data.id, context.branchIds);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  try {
    requireCheckoutPayable(invoice.status, invoice.amount);
  } catch {
    res.status(409).json({ error: "Invoice is not payable" });
    return;
  }
  if (Math.abs(body.data.amount - invoice.amount) > 0.0005) {
    res.status(400).json({ error: "Cash payment must equal the full invoice amount" });
    return;
  }

  const paidAt = new Date();
  const reference = `CASH-${invoice.invoiceNumber}-${paidAt.getTime()}`;
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${invoice.id})`);
    const [paidInvoice] = await tx
      .update(invoicesTable)
      .set({
        status: "paid",
        paidAt,
        lastPaymentStatus: "succeeded",
        lastPaymentError: null,
        chargedCurrency: "KWD",
        chargedAmount: invoice.amount,
        exchangeRate: null,
        paymentMethod: "cash",
        paymentReference: reference,
      })
      .where(and(
        eq(invoicesTable.id, invoice.id),
        eq(invoicesTable.ownerId, context.ownerId),
        branchCondition(invoicesTable.branchId, context.branchIds),
        ne(invoicesTable.status, "paid"),
      ))
      .returning();
    if (!paidInvoice) return null;

    await tx.insert(invoicePaymentsTable).values({
      ownerId: context.ownerId,
      invoiceId: invoice.id,
      method: "cash",
      amount: invoice.amount,
      currency: "KWD",
      status: "completed",
      reference,
      note: body.data.note ?? null,
      recordedBy: context.actorId,
    });
    await tx.insert(activitiesTable).values({
      ownerId: context.ownerId,
      branchId: invoice.branchId ?? null,
      type: "payment",
      title: `تم سداد فاتورة ${invoice.invoiceNumber}`,
      description: `تم تسجيل دفعة نقدية بمبلغ ${invoice.amount} د.ك`,
      actor: context.actorId,
    });
    return paidInvoice;
  });

  if (!updated) {
    res.status(409).json({ error: "Invoice was paid by another operation" });
    return;
  }

  await auditNurseryOperation(req, "record-cash-payment", "invoice", String(invoice.id), invoice as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  res.json(RecordCashInvoicePaymentResponse.parse({
    invoiceId: invoice.id,
    status: "paid",
    method: "cash",
    amount: invoice.amount,
    currency: "KWD",
    reference,
    paidAt: paidAt.toISOString(),
  }));
});

router.post("/invoices/:id/reminder", async (req, res): Promise<void> => {
  const parsed = SendInvoiceReminderParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const context = nurseryContext(req);
  const invoice = await loadOwnedInvoice(context.ownerId, parsed.data.id, context.branchIds);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const [guardian] = await db.select().from(guardiansTable).where(and(
    eq(guardiansTable.id, invoice.guardianId),
    eq(guardiansTable.ownerId, context.ownerId),
    branchCondition(guardiansTable.branchId, context.branchIds),
  ));
  if (!guardian) {
    res.status(404).json({ error: "Guardian not found for invoice" });
    return;
  }
  const result = await sendDueReminder(invoice, guardian);
  await auditNurseryOperation(req, "send-reminder", "invoice", String(invoice.id), null, {
    invoiceId: invoice.id,
    status: result.status,
    errorMessage: result.errorMessage ?? null,
  });
  res.json(SendInvoiceReminderResponse.parse({
    status: result.status,
    message: result.status === "sent"
      ? "تم إرسال التذكير عبر واتساب"
      : (result.errorMessage ?? "تعذر إرسال التذكير"),
  }));
});

async function parentOwnedChildren(guardianId: number, ownerId: string) {
  return db.select().from(childrenTable).where(and(
    eq(childrenTable.guardianId, guardianId),
    eq(childrenTable.ownerId, ownerId),
  ));
}

async function parentChildRows(guardianId: number, ownerId: string) {
  const children = await parentOwnedChildren(guardianId, ownerId);
  const childIds = children.map((child) => child.id);
  const [classrooms, attendanceRows] = await Promise.all([
    db.select().from(classroomsTable).where(eq(classroomsTable.ownerId, ownerId)),
    childIds.length
      ? db.select({ attendance: attendanceTable })
        .from(attendanceTable)
        .innerJoin(childrenTable, and(
          eq(attendanceTable.childId, childrenTable.id),
          eq(childrenTable.ownerId, ownerId),
          eq(childrenTable.guardianId, guardianId),
        ))
        .where(inArray(attendanceTable.childId, childIds))
      : Promise.resolve([]),
  ]);
  const attendance = attendanceRows.map(({ attendance: record }) => record);
  const classroomMap = new Map(classrooms.map((classroom) => [classroom.id, classroom.name]));
  return children.map((child) => {
    const records = attendance.filter((record) => record.childId === child.id);
    const attended = records.filter((record) => record.status === "present" || record.status === "late").length;
    return {
      id: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      fullName: `${child.firstName} ${child.lastName}`,
      birthDate: child.birthDate,
      level: child.level,
      classroomName: child.classroomId ? classroomMap.get(child.classroomId) ?? null : null,
      attendanceRate: records.length ? Math.round((attended / records.length) * 100) : 0,
      avatarUrl: child.avatarUrl,
    };
  });
}

router.get("/parent/overview", async (_req, res): Promise<void> => {
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const [children, invoiceRows, messages, announcements] = await Promise.all([
    parentChildRows(guardian.id, guardian.ownerId),
    db.select({ invoice: invoicesTable })
      .from(invoicesTable)
      .innerJoin(childrenTable, and(
        eq(invoicesTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, guardian.ownerId),
        eq(childrenTable.guardianId, guardian.id),
      ))
      .where(and(
        eq(invoicesTable.guardianId, guardian.id),
        eq(invoicesTable.ownerId, guardian.ownerId),
      )),
    db.select().from(parentMessagesTable).where(and(
      eq(parentMessagesTable.guardianId, guardian.id),
      eq(parentMessagesTable.ownerId, guardian.ownerId),
    )),
    db.select().from(announcementsTable).where(and(
      eq(announcementsTable.ownerId, guardian.ownerId),
      inArray(announcementsTable.audience, ["all", "parents"]),
    )),
  ]);
  const invoices = invoiceRows.map(({ invoice }) => invoice);
  res.json(GetParentOverviewResponse.parse({
    guardianId: guardian.id,
    guardianName: guardian.name,
    children,
    outstandingBalance: invoices
      .filter((invoice) => invoice.status !== "paid")
      .reduce((sum, invoice) => sum + invoice.amount, 0),
    unreadMessages: messages.filter((message) => message.senderType === "staff" && !message.read).length,
    announcementsCount: announcements.length,
  }));
});

router.get("/parent/children", async (_req, res): Promise<void> => {
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  res.json(ListParentChildrenResponse.parse(await parentChildRows(guardian.id, guardian.ownerId)));
});

router.get("/parent/attendance", async (req, res): Promise<void> => {
  const parsed = ListParentAttendanceQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const children = await parentOwnedChildren(guardian.id, guardian.ownerId);
  const scopedChildren = parsed.data.childId
    ? children.filter((child) => child.id === parsed.data.childId)
    : children;
  if (parsed.data.childId && !scopedChildren.length) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  if (!scopedChildren.length) {
    res.json(ListParentAttendanceResponse.parse([]));
    return;
  }
  const childMap = new Map(scopedChildren.map((child) => [child.id, `${child.firstName} ${child.lastName}`]));
  const recordRows = await db.select({ attendance: attendanceTable })
    .from(attendanceTable)
    .innerJoin(childrenTable, and(
      eq(attendanceTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, guardian.ownerId),
      eq(childrenTable.guardianId, guardian.id),
    ))
    .where(inArray(attendanceTable.childId, [...childMap.keys()]))
    .orderBy(desc(attendanceTable.date));
  const records = recordRows.map(({ attendance: record }) => record);
  res.json(ListParentAttendanceResponse.parse(records.map((record) => ({
    ...record,
    correctedAt: record.correctedAt?.toISOString() ?? null,
    childName: childMap.get(record.childId)!,
  }))));
});

router.get("/parent/progress-reports", async (req, res): Promise<void> => {
  const parsed = ListParentProgressReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const children = await parentOwnedChildren(guardian.id, guardian.ownerId);
  const scopedChildren = parsed.data.childId ? children.filter((child) => child.id === parsed.data.childId) : children;
  if (parsed.data.childId && !scopedChildren.length) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  if (!scopedChildren.length) {
    res.json(ListParentProgressReportsResponse.parse([]));
    return;
  }
  const childMap = new Map(scopedChildren.map((child) => [child.id, `${child.firstName} ${child.lastName}`]));
  const reportRows = await db.select({ report: progressReportsTable })
    .from(progressReportsTable)
    .innerJoin(childrenTable, and(
      eq(progressReportsTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, guardian.ownerId),
      eq(childrenTable.guardianId, guardian.id),
    ))
    .where(and(
      eq(progressReportsTable.ownerId, guardian.ownerId),
      inArray(progressReportsTable.childId, [...childMap.keys()]),
    ))
    .orderBy(desc(progressReportsTable.publishedAt));
  const reports = reportRows.map(({ report }) => report);
  res.json(ListParentProgressReportsResponse.parse(reports.map((report) => ({
    ...report,
    childName: childMap.get(report.childId)!,
    publishedAt: report.publishedAt.toISOString(),
  }))));
});

router.get("/parent/activities", async (req, res): Promise<void> => {
  const parsed = ListParentActivitiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const children = await parentOwnedChildren(guardian.id, guardian.ownerId);
  const scopedChildren = parsed.data.childId ? children.filter((child) => child.id === parsed.data.childId) : children;
  if (parsed.data.childId && !scopedChildren.length) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  if (!scopedChildren.length) {
    res.json(ListParentActivitiesResponse.parse([]));
    return;
  }
  const childMap = new Map(scopedChildren.map((child) => [child.id, `${child.firstName} ${child.lastName}`]));
  const activityRows = await db.select({ activity: childActivitiesTable })
    .from(childActivitiesTable)
    .innerJoin(childrenTable, and(
      eq(childActivitiesTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, guardian.ownerId),
      eq(childrenTable.guardianId, guardian.id),
    ))
    .where(and(
      eq(childActivitiesTable.ownerId, guardian.ownerId),
      inArray(childActivitiesTable.childId, [...childMap.keys()]),
    ))
    .orderBy(desc(childActivitiesTable.occurredAt));
  const activities = activityRows.map(({ activity }) => activity);
  res.json(ListParentActivitiesResponse.parse(activities.map((activity) => ({
    ...activity,
    childName: childMap.get(activity.childId)!,
    occurredAt: activity.occurredAt.toISOString(),
  }))));
});

router.get("/parent/invoices", async (_req, res): Promise<void> => {
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const invoiceRows = await db
    .select({
      invoice: invoicesTable,
      childFirstName: childrenTable.firstName,
      childLastName: childrenTable.lastName,
    })
    .from(invoicesTable)
    .innerJoin(childrenTable, and(
      eq(invoicesTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, guardian.ownerId),
      eq(childrenTable.guardianId, guardian.id),
    ))
    .where(and(
      eq(invoicesTable.guardianId, guardian.id),
      eq(invoicesTable.ownerId, guardian.ownerId),
    ))
    .orderBy(desc(invoicesTable.dueDate));
  res.json(ListParentInvoicesResponse.parse(invoiceRows.map(({ invoice, childFirstName, childLastName }) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    guardianName: guardian.name,
    childName: `${childFirstName} ${childLastName}`,
    amount: invoice.amount,
    dueDate: invoice.dueDate,
    status: invoice.status,
    paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
    lastPaymentStatus: invoice.lastPaymentStatus,
    lastPaymentError: invoice.lastPaymentError,
    chargedCurrency: invoice.chargedCurrency,
    chargedAmount: invoice.chargedAmount,
  }))));
});

router.post("/parent/invoices/:id/checkout-session", async (req, res): Promise<void> => {
  const params = CreateParentInvoiceCheckoutSessionParams.safeParse(req.params);
  const body = CreateParentInvoiceCheckoutSessionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!isAllowedReturnUrl(body.data.returnUrl)) {
    res.status(400).json({ error: "Invalid return URL" });
    return;
  }

  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const [invoiceRow] = await db
    .select({ invoice: invoicesTable })
    .from(invoicesTable)
    .innerJoin(childrenTable, and(
      eq(invoicesTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, guardian.ownerId),
      eq(childrenTable.guardianId, guardian.id),
    ))
    .where(and(
      eq(invoicesTable.id, params.data.id),
      eq(invoicesTable.guardianId, guardian.id),
      eq(invoicesTable.ownerId, guardian.ownerId),
    ));
  if (!invoiceRow) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const invoice = invoiceRow.invoice;
  try {
    requireCheckoutPayable(invoice.status, invoice.amount);
  } catch {
    res.status(409).json({ error: "Invoice is not payable" });
    return;
  }

  try {
    const session = await createInvoiceCheckoutSession({
      invoice,
      guardian,
      successUrl: `${body.data.returnUrl}?payment=success&invoice=${invoice.id}`,
      cancelUrl: `${body.data.returnUrl}?payment=cancelled&invoice=${invoice.id}`,
    });
    res.json(CreateParentInvoiceCheckoutSessionResponse.parse({ url: session.url }));
  } catch (err) {
    req.log.error({ err, invoiceId: invoice.id }, "Failed to create parent MyFatoorah KNET payment");
    if (err instanceof InvoiceNotPayableError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof PaymentProviderConfigurationError) {
      res.status(503).json({ error: err.message, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
      return;
    }
    if (err instanceof PaymentAttemptInProgressError) {
      res.status(409).json({ error: err.message, code: "PAYMENT_ATTEMPT_IN_PROGRESS" });
      return;
    }
    res.status(502).json({ error: "Failed to create payment session" });
  }
});

router.get("/parent/messages", async (_req, res): Promise<void> => {
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const messages = await db.select().from(parentMessagesTable)
    .where(and(
      eq(parentMessagesTable.guardianId, guardian.id),
      eq(parentMessagesTable.ownerId, guardian.ownerId),
    ))
    .orderBy(desc(parentMessagesTable.createdAt));
  res.json(ListParentMessagesResponse.parse(messages.map(({ guardianId: _guardianId, ...message }) => ({
    ...message,
    createdAt: message.createdAt.toISOString(),
  }))));
});

router.post("/parent/messages", async (req, res): Promise<void> => {
  const parsed = SendParentMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.subject.trim() || !parsed.data.content.trim()) {
    res.status(400).json({ error: "Subject and content cannot be blank" });
    return;
  }
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const [message] = await db.insert(parentMessagesTable).values({
    ownerId: guardian.ownerId,
    guardianId: guardian.id,
    senderType: "parent",
    senderName: guardian.name,
    subject: parsed.data.subject.trim(),
    content: parsed.data.content.trim(),
    read: true,
  }).returning();
  req.log.info({ guardianId: guardian.id, messageId: message.id }, "Parent message persisted");
  res.status(201).json(SendParentMessageResponse.parse({
    id: message.id,
    senderType: message.senderType,
    senderName: message.senderName,
    subject: message.subject,
    content: message.content,
    read: message.read,
    createdAt: message.createdAt.toISOString(),
  }));
});

router.get("/parent/announcements", async (_req, res): Promise<void> => {
  const guardian = res.locals.guardian as typeof guardiansTable.$inferSelect;
  const announcements = await db.select().from(announcementsTable)
    .where(and(
      eq(announcementsTable.ownerId, guardian.ownerId),
      inArray(announcementsTable.audience, ["all", "parents"]),
    ))
    .orderBy(desc(announcementsTable.publishedAt));
  res.json(ListParentAnnouncementsResponse.parse(announcements.map((announcement) => ({
    id: announcement.id,
    title: announcement.title,
    content: announcement.content,
    publishedAt: announcement.publishedAt.toISOString(),
  }))));
});

export default router;
