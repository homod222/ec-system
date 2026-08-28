import { Router, type IRouter, type RequestHandler } from "express";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import {
  CreateChildBody,
  CreateChildResponse,
  CreateClassroomBody,
  CreateClassroomResponse,
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
  UpdateChildBody,
  UpdateChildParams,
  UpdateChildResponse,
} from "@workspace/api-zod";
import {
  activitiesTable,
  announcementsTable,
  attendanceTable,
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
  staffTable,
} from "@workspace/db";
import { checkClassroomCapacity } from "../lib/classroomCapacity";
import {
  createInvoiceCheckoutSession,
  isAllowedReturnUrl,
  PaymentAttemptInProgressError,
  PaymentProviderConfigurationError,
} from "../lib/financePayments";
import { InvoiceNotPayableError, requireCheckoutPayable } from "../lib/invoiceLedger";
import { sendDueReminder } from "../lib/notifications";
import {
  auditNurseryOperation,
  nurseryContext,
  permitted,
  resolveNurseryContext,
} from "./nurseryOperations";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);

const requireAuth: RequestHandler = (req, res, next) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

type Claims = Record<string, unknown>;

function sessionClaims(req: Parameters<typeof getAuth>[0]): Claims {
  return (getAuth(req).sessionClaims ?? {}) as Claims;
}

function publicMetadata(claims: Claims): Claims {
  const value = claims.publicMetadata ?? claims.public_metadata;
  return value && typeof value === "object" ? value as Claims : {};
}

function sessionRole(req: Parameters<typeof getAuth>[0]): string | null {
  const claims = sessionClaims(req);
  const metadata = publicMetadata(claims);
  const value = metadata.role ?? claims.role;
  if (typeof value === "string") return value.trim().toLowerCase();
  const roles = metadata.roles ?? claims.roles;
  if (Array.isArray(roles)) {
    const firstRole = roles.find((role): role is string => typeof role === "string");
    if (firstRole) return firstRole.trim().toLowerCase();
  }
  return null;
}

function verifiedEmails(claims: Claims): string[] {
  const emails = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.includes("@")) emails.add(value.trim().toLowerCase());
  };
  if (claims.email_verified === true || claims.email_verified === "true" || claims.verified === true) {
    add(claims.email ?? claims.email_address);
  }
  const candidates = [claims.primary_email_address, ...(Array.isArray(claims.email_addresses) ? claims.email_addresses : [])];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Claims;
    const verification = entry.verification && typeof entry.verification === "object"
      ? entry.verification as Claims
      : {};
    if (entry.verified === true || verification.status === "verified") {
      add(entry.email_address ?? entry.email);
    }
  }
  return [...emails];
}

async function clerkIdentity(req: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(req);
  if (!auth.userId) return { role: null, verifiedEmails: [] as string[] };
  const claimRole = sessionRole(req);
  const claimEmails = verifiedEmails(sessionClaims(req));
  if (claimRole && claimEmails.length) {
    return { role: claimRole, verifiedEmails: claimEmails };
  }
  const user = await clerkClient.users.getUser(auth.userId);
  const metadataRole = user.publicMetadata.role;
  const role = claimRole ?? (typeof metadataRole === "string" ? metadataRole.trim().toLowerCase() : null);
  const emails = claimEmails.length
    ? claimEmails
    : user.emailAddresses
      .filter((entry) => entry.verification?.status === "verified")
      .map((entry) => entry.emailAddress.trim().toLowerCase());
  return { role, verifiedEmails: emails };
}

async function resolveGuardian(req: Parameters<typeof getAuth>[0], emails: string[]) {
  const auth = getAuth(req);
  if (!auth.userId) return null;
  const [linked] = await db.select().from(guardiansTable)
    .where(eq(guardiansTable.clerkUserId, auth.userId)).limit(1);
  if (linked) return linked;

  if (!emails.length) return null;
  const matches = await db.select().from(guardiansTable)
    .where(inArray(sql<string>`lower(${guardiansTable.email})`, emails)).limit(2);
  if (matches.length !== 1 || (matches[0].clerkUserId && matches[0].clerkUserId !== auth.userId)) return null;
  const [claimed] = await db.update(guardiansTable)
    .set({ clerkUserId: auth.userId })
    .where(and(eq(guardiansTable.id, matches[0].id), sql`${guardiansTable.clerkUserId} is null`))
    .returning();
  if (claimed) return claimed;
  const [raced] = await db.select().from(guardiansTable)
    .where(eq(guardiansTable.clerkUserId, auth.userId)).limit(1);
  return raced ?? null;
}

const requireParentGuardian: RequestHandler = async (req, res, next) => {
  try {
    const identity = await clerkIdentity(req);
    if (identity.role && identity.role !== "parent" && identity.role !== "guardian") {
      res.status(403).json({ error: "Parent access required" });
      return;
    }
    const guardian = await resolveGuardian(req, identity.verifiedEmails);
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

async function childRows(ownerId: string) {
  const [children, guardians, classrooms, attendance] = await Promise.all([
    db.select().from(childrenTable).where(eq(childrenTable.ownerId, ownerId)),
    db.select().from(guardiansTable).where(eq(guardiansTable.ownerId, ownerId)),
    db.select().from(classroomsTable).where(eq(classroomsTable.ownerId, ownerId)),
    db.select({ attendance: attendanceTable })
      .from(attendanceTable)
      .innerJoin(childrenTable, and(
        eq(attendanceTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, ownerId),
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
router.get("/session/context", async (req, res, next): Promise<void> => {
  try {
    const identity = await clerkIdentity(req);
    const administrativeRoles = new Set([
      "admin", "nursery_admin", "manager", "supervisor", "teacher", "accountant",
      "receptionist", "owner", "superadmin",
    ]);
    if (identity.role && administrativeRoles.has(identity.role)) {
      res.json(GetSessionContextResponse.parse({ role: "admin" }));
      return;
    }
    if (!identity.role || identity.role === "parent" || identity.role === "guardian") {
      const guardian = await resolveGuardian(req, identity.verifiedEmails);
      if (guardian) {
        res.json(GetSessionContextResponse.parse({ role: "parent" }));
        return;
      }
    }
    res.json(GetSessionContextResponse.parse({ role: "pending" }));
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
      if (req.path.startsWith("/dashboard/")) return "read:dashboard";
      if (req.path === "/guardians") return "read:children";
      if (req.path.startsWith("/children")) {
        return req.method === "GET" ? "read:children"
          : req.method === "DELETE" ? "delete:children" : "write:children";
      }
      if (req.path === "/classrooms") return req.method === "GET" ? "read:classroom" : "write:classroom";
      if (req.path === "/staff") return "read:staff-profile";
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
  const ownerId = nurseryContext(req).ownerId;
  const [children, attendance, staff, invoiceRows, payments, refunds] = await Promise.all([
    db.select().from(childrenTable).where(eq(childrenTable.ownerId, ownerId)),
    db.select({ attendance: attendanceTable })
      .from(attendanceTable)
      .innerJoin(childrenTable, and(
        eq(attendanceTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, ownerId),
      ))
      .where(eq(attendanceTable.date, today())),
    db.select().from(staffTable).where(eq(staffTable.ownerId, nurseryContext(req).ownerId)),
    db
      .select({ invoice: invoicesTable })
      .from(invoicesTable)
      .innerJoin(childrenTable, and(
        eq(invoicesTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, ownerId),
      ))
      .innerJoin(guardiansTable, and(
        eq(invoicesTable.guardianId, guardiansTable.id),
        eq(guardiansTable.ownerId, ownerId),
      ))
      .where(eq(invoicesTable.ownerId, ownerId)),
    db.select().from(invoicePaymentsTable).where(and(eq(invoicePaymentsTable.ownerId, ownerId), inArray(invoicePaymentsTable.status, ["completed", "succeeded"]))),
    db.select().from(invoiceRefundsTable).where(eq(invoiceRefundsTable.ownerId, ownerId)),
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
  const ownerId = nurseryContext(req).ownerId;
  const activities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.ownerId, ownerId))
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
  const rows = (await childRows(nurseryContext(req).ownerId)).filter((child) => {
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
  const ownerId = nurseryContext(req).ownerId;
  const result = await db.transaction(async (tx) => {
    if (input.classroomId != null) {
      const capacity = await checkClassroomCapacity(tx, ownerId, input.classroomId);
      if (capacity.kind !== "available") return capacity;
    }
    const [guardian] = await tx.insert(guardiansTable).values({
      ownerId,
      name: input.guardianName,
      phone: input.guardianPhone,
      email: null,
      balance: 0,
    }).returning();
    const [child] = await tx.insert(childrenTable).values({
      ownerId,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      birthDate: input.birthDate,
      classroomId: input.classroomId ?? null,
      guardianId: guardian.id,
      level: input.level,
      notes: input.notes ?? null,
    }).returning();
    return { kind: "created" as const, child };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (result.kind === "full") {
    res.status(409).json({ error: "Classroom is full" });
    return;
  }
  const child = result.child;
  const record = (await childRows(ownerId)).find((row) => row.id === child.id);
  await auditNurseryOperation(req, "create", "child", String(child.id), null, child as unknown as Record<string, unknown>);
  res.status(201).json(CreateChildResponse.parse(record));
});

router.get("/children/:id", async (req, res): Promise<void> => {
  const parsed = GetChildParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const record = (await childRows(nurseryContext(req).ownerId)).find((row) => row.id === parsed.data.id);
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
  const ownerId = nurseryContext(req).ownerId;
  const [current] = await db.select().from(childrenTable).where(and(
    eq(childrenTable.id, params.data.id),
    eq(childrenTable.ownerId, ownerId),
  ));
  if (!current) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  const updateResult = await db.transaction(async (tx) => {
    const targetClassroomId = body.data.classroomId === undefined
      ? current.classroomId
      : body.data.classroomId;
    const targetStatus = body.data.status ?? current.status;
    if (targetClassroomId != null && targetStatus === "active") {
      const capacity = await checkClassroomCapacity(tx, ownerId, targetClassroomId, current.id);
      if (capacity.kind !== "available") return capacity;
    }
    if (body.data.guardianName !== undefined || body.data.guardianPhone !== undefined) {
      await tx.update(guardiansTable).set({
        ...(body.data.guardianName !== undefined ? { name: body.data.guardianName } : {}),
        ...(body.data.guardianPhone !== undefined ? { phone: body.data.guardianPhone } : {}),
      }).where(and(
        eq(guardiansTable.id, current.guardianId),
        eq(guardiansTable.ownerId, ownerId),
      ));
    }
    await tx.update(childrenTable).set({
      ...(body.data.firstName !== undefined ? { firstName: body.data.firstName } : {}),
      ...(body.data.lastName !== undefined ? { lastName: body.data.lastName } : {}),
      ...(body.data.gender !== undefined ? { gender: body.data.gender } : {}),
      ...(body.data.birthDate !== undefined ? { birthDate: body.data.birthDate } : {}),
      ...(body.data.classroomId !== undefined ? { classroomId: body.data.classroomId } : {}),
      ...(body.data.level !== undefined ? { level: body.data.level } : {}),
      ...(body.data.status !== undefined ? { status: body.data.status } : {}),
      ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
    }).where(and(
      eq(childrenTable.id, params.data.id),
      eq(childrenTable.ownerId, ownerId),
    ));
    return { kind: "updated" as const };
  });
  if (updateResult.kind === "missing") {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (updateResult.kind === "full") {
    res.status(409).json({ error: "Classroom is full" });
    return;
  }
  const record = (await childRows(ownerId)).find((row) => row.id === params.data.id);
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
  const ownerId = nurseryContext(req).ownerId;
  const deletion = await db.transaction(async (tx) => {
    await tx.execute(sql`
      select id from children
      where id = ${parsed.data.id} and owner_id = ${ownerId}
      for update
    `);
    const [child] = await tx.select().from(childrenTable).where(and(
      eq(childrenTable.id, parsed.data.id),
      eq(childrenTable.ownerId, ownerId),
    ));
    if (!child) return { kind: "missing" as const };
    const [plan] = await tx.select({ id: billingPlansTable.id }).from(billingPlansTable)
      .where(and(eq(billingPlansTable.childId, child.id), eq(billingPlansTable.ownerId, ownerId)))
      .limit(1);
    if (plan) return { kind: "billing-history" as const };
    const [deleted] = await tx.delete(childrenTable).where(and(
      eq(childrenTable.id, child.id),
      eq(childrenTable.ownerId, ownerId),
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
  const ownerId = nurseryContext(req).ownerId;
  const [guardians, children] = await Promise.all([
    db.select().from(guardiansTable).where(eq(guardiansTable.ownerId, ownerId)),
    db.select().from(childrenTable).where(eq(childrenTable.ownerId, ownerId)),
  ]);
  res.json(ListGuardiansResponse.parse(guardians.map((guardian) => ({
    id: guardian.id,
    name: guardian.name,
    phone: guardian.phone,
    email: guardian.email,
    childrenCount: children.filter((child) => child.guardianId === guardian.id).length,
    balance: guardian.balance,
  }))));
});

router.get("/classrooms", async (req, res): Promise<void> => {
  const ownerId = nurseryContext(req).ownerId;
  const [classrooms, children] = await Promise.all([
    db.select().from(classroomsTable).where(eq(classroomsTable.ownerId, ownerId)),
    db.select().from(childrenTable).where(eq(childrenTable.ownerId, ownerId)),
  ]);
  res.json(ListClassroomsResponse.parse(classrooms.map(({ ownerId: _ownerId, ...classroom }) => ({
    ...classroom,
    childrenCount: children.filter((child) =>
      child.classroomId === classroom.id && child.status === "active").length,
  }))));
});

router.get("/staff", async (req, res): Promise<void> => {
  const staff = await db.select().from(staffTable).where(eq(staffTable.ownerId, nurseryContext(req).ownerId));
  res.json(ListStaffResponse.parse(staff.map((member) => ({
    ...member,
    attendanceRate: member.status === "present" ? 100 : member.status === "leave" ? 85 : 70,
  }))));
});

router.get("/attendance/today", async (req, res): Promise<void> => {
  const ownerId = nurseryContext(req).ownerId;
  const [records, children] = await Promise.all([
    db.select({ attendance: attendanceTable })
      .from(attendanceTable)
      .innerJoin(childrenTable, and(
        eq(attendanceTable.childId, childrenTable.id),
        eq(childrenTable.ownerId, ownerId),
      ))
      .where(eq(attendanceTable.date, today())),
    db.select().from(childrenTable).where(eq(childrenTable.ownerId, ownerId)),
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
  const [child] = await db.select().from(childrenTable).where(and(
    eq(childrenTable.id, parsed.data.childId),
    eq(childrenTable.ownerId, nurseryContext(req).ownerId),
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
  const [classroom] = await db.insert(classroomsTable).values({
    ownerId: nurseryContext(req).ownerId,
    name: parsed.data.name,
    level: parsed.data.level,
    teacherName: parsed.data.teacherName,
    capacity: parsed.data.capacity,
    color: parsed.data.color ?? "teal",
    branchId: parsed.data.branchId ?? null,
    stageId: parsed.data.stageId ?? null,
    schedule: parsed.data.schedule ?? {},
  }).returning();
  const { ownerId: _ownerId, ...data } = classroom;
  await auditNurseryOperation(req, "create", "classroom", String(classroom.id), null, classroom as unknown as Record<string, unknown>);
  res.status(201).json(CreateClassroomResponse.parse({ ...data, childrenCount: 0 }));
});

const arMonthLabel = new Intl.DateTimeFormat("ar", { month: "long" });

router.get("/finance/summary", async (req, res): Promise<void> => {
  const ownerId = nurseryContext(req).ownerId;
  const invoiceRows = await db
    .select({ invoice: invoicesTable })
    .from(invoicesTable)
    .innerJoin(childrenTable, and(
      eq(invoicesTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, ownerId),
    ))
    .innerJoin(guardiansTable, and(
      eq(invoicesTable.guardianId, guardiansTable.id),
      eq(guardiansTable.ownerId, ownerId),
    ))
    .where(eq(invoicesTable.ownerId, ownerId));
  const invoices = invoiceRows.map(({ invoice }) => invoice);
  const [payments, refunds] = await Promise.all([
    db.select().from(invoicePaymentsTable).where(and(eq(invoicePaymentsTable.ownerId, ownerId), inArray(invoicePaymentsTable.status, ["completed", "succeeded"]))),
    db.select().from(invoiceRefundsTable).where(eq(invoiceRefundsTable.ownerId, ownerId)),
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
  const ownerId = nurseryContext(req).ownerId;
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
    ))
    .innerJoin(guardiansTable, and(
      eq(invoicesTable.guardianId, guardiansTable.id),
      eq(guardiansTable.ownerId, ownerId),
    ))
    .where(eq(invoicesTable.ownerId, ownerId));
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
async function loadOwnedInvoice(ownerId: string, invoiceId: number) {
  const [row] = await db
    .select({ invoice: invoicesTable })
    .from(invoicesTable)
    .innerJoin(childrenTable, and(
      eq(invoicesTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, ownerId),
    ))
    .innerJoin(guardiansTable, and(
      eq(invoicesTable.guardianId, guardiansTable.id),
      eq(guardiansTable.ownerId, ownerId),
    ))
    .where(and(
      eq(invoicesTable.id, invoiceId),
      eq(invoicesTable.ownerId, ownerId),
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
  const invoice = await loadOwnedInvoice(nurseryContext(req).ownerId, params.data.id);
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
  const [guardian] = await db.select().from(guardiansTable).where(eq(guardiansTable.id, invoice.guardianId));
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
  const invoice = await loadOwnedInvoice(context.ownerId, params.data.id);
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
  const invoice = await loadOwnedInvoice(nurseryContext(req).ownerId, parsed.data.id);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const [guardian] = await db.select().from(guardiansTable).where(eq(guardiansTable.id, invoice.guardianId));
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
