import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import {
  CreateChildRecordBody,
  CreateChildRecordParams,
  CreateChildRecordResponse,
  CreateOperationalRecordBody,
  CreateOperationalRecordParams,
  CreateOperationalRecordResponse,
  DeleteOperationalRecordParams,
  GetNurseryReportQueryParams,
  GetNurseryReportResponse,
  ListAuditLogsQueryParams,
  ListAuditLogsResponse,
  ListPermissionPrincipalsResponse,
  GetPermissionCatalogResponse,
  BulkSetRolePermissionsBody,
  BulkSetRolePermissionsResponse,
  BulkSetUserPermissionsBody,
  BulkSetUserPermissionsResponse,
  ListChildRecordsParams,
  ListChildRecordsResponse,
  ListOperationalRecordsParams,
  ListOperationalRecordsResponse,
  ListRolePermissionsResponse,
  ListUserPermissionsQueryParams,
  ListUserPermissionsResponse,
  ListStaffAttendanceQueryParams,
  ListStaffAttendanceResponse,
  RecordStaffAttendanceBody,
  RecordStaffAttendanceResponse,
  SetRolePermissionBody,
  SetRolePermissionResponse,
  SetUserPermissionBody,
  SetUserPermissionResponse,
  UpdateOperationalRecordBody,
  UpdateOperationalRecordParams,
  UpdateOperationalRecordResponse,
} from "@workspace/api-zod";
import {
  auditLogsTable,
  childRecordsTable,
  childrenTable,
  db,
  invoicePaymentsTable,
  invoiceRefundsTable,
  invoicesTable,
  guardiansTable,
  operationalRecordsTable,
  rolePermissionsTable,
  userPermissionsTable,
  staffAttendanceTable,
  staffTable,
} from "@workspace/db";
import {
  configurableOperations,
  configurableOperationSet,
  permissionCatalog,
} from "../lib/permissionCatalog";

const router: IRouter = Router();
type Claims = Record<string, unknown>;

export function nurseryContext(req: Request) {
  const resolved = req.res?.locals.operationsContext as {
    actorId: string;
    ownerId: string;
    role: string;
  } | undefined;
  if (resolved) return resolved;
  const auth = getAuth(req);
  const claims = (auth.sessionClaims ?? {}) as Claims;
  const metadataValue = claims.publicMetadata ?? claims.public_metadata;
  const metadata = metadataValue && typeof metadataValue === "object" ? metadataValue as Claims : {};
  const roleValue = metadata.role ?? claims.role;
  const role = typeof roleValue === "string" ? roleValue.toLowerCase() : "staff";
  const scopedOwner = metadata.ownerId ?? metadata.owner_id ?? claims.ownerId;
  return {
    actorId: auth.userId!,
    ownerId: typeof scopedOwner === "string" && scopedOwner ? scopedOwner : auth.userId!,
    role,
  };
}

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

const academicResources = new Set([
  "curriculum", "lesson-plan", "skill", "assessment", "progress-report", "event", "media",
]);
const financialResources = new Set(["fee-plan", "discount", "refund", "expense", "revenue", "payroll"]);
const configurableRoles = ["admin", "manager", "supervisor", "teacher", "accountant", "receptionist", "parent"];
export { configurableOperations };

export function defaultAllowed(role: string, operation: string) {
  if (["owner", "superadmin", "admin", "nursery_admin"].includes(role)) return true;
  if (operation === "read:child-confidential") return ["manager", "supervisor"].includes(role);
  if (["manager", "supervisor"].includes(role)) return !operation.includes(":permissions");
  if (role === "teacher") {
    return operation === "read:attendance"
      || operation === "read:child-record"
      || operation === "read:children"
      || operation === "read:classroom"
      || operation === "read:stage"
      || operation === "read:branch"
      || operation === "read:dashboard"
      || operation === "read:report-academic"
      || operation === "write:attendance"
      || [...academicResources].some((resource) =>
        operation === `read:${resource}` || operation === `write:${resource}`);
  }
  if (role === "accountant") {
    return operation === "read:report-financial"
      || operation === "read:invoice"
      || operation === "write:invoice"
      || operation === "read:dashboard"
      || operation === "write:payment"
      || operation === "write:notification"
      || [...financialResources].some((resource) =>
        operation === `read:${resource}` || operation === `write:${resource}`);
  }
  if (role === "receptionist") {
    return [
      "read:dashboard", "read:branch", "read:stage", "read:classroom", "write:classroom",
      "read:attendance", "read:child-record", "read:children", "write:children", "write:attendance",
      "read:application", "write:application", "write:application-document",
    ]
      .includes(operation);
  }
  return false;
}

export async function permitted(req: Request, operation: string) {
  const { ownerId, role, actorId } = nurseryContext(req);
  if (role === "disabled") return false;
  const [userConfigured] = await db.select().from(userPermissionsTable).where(and(
    eq(userPermissionsTable.ownerId, ownerId),
    eq(userPermissionsTable.userId, actorId),
    eq(userPermissionsTable.operation, operation),
  )).limit(1);
  if (userConfigured) return userConfigured.allowed;
  const [configured] = await db.select().from(rolePermissionsTable).where(and(
    eq(rolePermissionsTable.ownerId, ownerId),
    eq(rolePermissionsTable.role, role),
    eq(rolePermissionsTable.operation, operation),
  )).limit(1);
  return configured?.allowed ?? defaultAllowed(role, operation);
}

export function requireNurseryPermission(operation: string): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!await permitted(req, operation)) {
        res.status(403).json({ error: "Operation not permitted" });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function auditNurseryOperation(
  req: Request,
  operation: string,
  entityType: string,
  entityId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  const { ownerId, actorId, role } = nurseryContext(req);
  await db.insert(auditLogsTable).values({
    ownerId, actorId, actorRole: role, operation, entityType, entityId, before, after,
  });
}

function ownerOnly(req: Request) {
  return ["owner", "superadmin"].includes(nurseryContext(req).role);
}

export function validRolePermission(role: string, operation: string) {
  return configurableRoles.includes(role) && configurableOperationSet.has(operation);
}

async function tenantPrincipal(ownerId: string, userId: string) {
  if (userId === ownerId) return { userId, role: "owner" };
  try {
    const user = await clerkClient.users.getUser(userId);
    const metadata = user.publicMetadata as Claims;
    const userOwnerId = metadata.ownerId ?? metadata.owner_id;
    const role = metadata.role;
    if (metadata.accountStatus !== "disabled"
        && userOwnerId === ownerId && typeof role === "string" && role) {
      return { userId, role: role.toLowerCase() };
    }
  } catch {
    // A guardian can have a historical Clerk ID that no longer resolves.
    // Its tenant-scoped database association remains the fallback below.
  }
  const [guardian] = await db.select({ userId: guardiansTable.clerkUserId })
    .from(guardiansTable).where(and(
      eq(guardiansTable.ownerId, ownerId),
      eq(guardiansTable.clerkUserId, userId),
    )).limit(1);
  return guardian?.userId ? { userId: guardian.userId, role: "parent" } : null;
}

function clerkPrincipalLabel(user: Record<string, unknown>) {
  const firstName = typeof user.firstName === "string" ? user.firstName.trim() : "";
  const lastName = typeof user.lastName === "string" ? user.lastName.trim() : "";
  const name = [firstName, lastName].filter(Boolean).join(" ");
  if (name) return name;
  const primaryEmail = user.primaryEmailAddress as { emailAddress?: unknown } | null | undefined;
  if (typeof primaryEmail?.emailAddress === "string" && primaryEmail.emailAddress) return primaryEmail.emailAddress;
  const emails = user.emailAddresses as Array<{ emailAddress?: unknown }> | undefined;
  const email = emails?.find(({ emailAddress }) => typeof emailAddress === "string" && emailAddress);
  return typeof email?.emailAddress === "string" ? email.emailAddress : "مستخدم معروف";
}

async function tenantClerkPrincipals(ownerId: string) {
  const principals: Array<{ userId: string; label: string; role: string }> = [];
  const limit = 100;
  let offset = 0;
  let totalCount = Infinity;
  while (offset < totalCount) {
    const page = await clerkClient.users.getUserList({ limit, offset });
    const users = page.data;
    for (const user of users) {
      const metadata = user.publicMetadata as Claims;
      const userOwnerId = metadata.ownerId ?? metadata.owner_id;
      const role = metadata.role;
      if (metadata.accountStatus !== "disabled"
          && userOwnerId === ownerId && typeof role === "string" && role) {
        principals.push({ userId: user.id, label: clerkPrincipalLabel(user as unknown as Record<string, unknown>), role: role.toLowerCase() });
      }
    }
    offset += users.length;
    totalCount = typeof page.totalCount === "number" ? page.totalCount : offset;
    if (users.length === 0) break;
  }
  return principals;
}

function serializeRecord<T extends { createdAt: Date; updatedAt: Date; ownerId: string }>(row: T) {
  const { ownerId: _ownerId, ...record } = row;
  return { ...record, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

router.use(requireAuth);
export const resolveNurseryContext: RequestHandler = async (req, res, next) => {
  try {
    if (!getAuth(req).userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const fallback = nurseryContext(req);
    const user = await clerkClient.users.getUser(fallback.actorId);
    const metadata = user.publicMetadata as Claims;
    const metadataRole = metadata.role;
    const metadataOwnerId = metadata.ownerId ?? metadata.owner_id;
    const managedStaffAccount = typeof metadata.accountStatus === "string";
    const activeManagedStaffAccount = metadata.accountStatus === "active";
    res.locals.operationsContext = {
      actorId: fallback.actorId,
      ownerId: managedStaffAccount
        ? typeof metadataOwnerId === "string" && metadataOwnerId ? metadataOwnerId : fallback.actorId
        : fallback.ownerId !== fallback.actorId
          ? fallback.ownerId
          : typeof metadataOwnerId === "string" && metadataOwnerId ? metadataOwnerId : fallback.ownerId,
      role: managedStaffAccount
        ? activeManagedStaffAccount && typeof metadataRole === "string" && metadataRole
          ? metadataRole.toLowerCase()
          : "disabled"
        : fallback.role,
    };
    next();
  } catch (error) {
    next(error);
  }
};
router.use(resolveNurseryContext);

router.get("/children/:id/records", async (req, res): Promise<void> => {
  const params = ListChildRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!await permitted(req, "read:child-record")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [child] = await db.select({ id: childrenTable.id }).from(childrenTable).where(and(
    eq(childrenTable.id, params.data.id), eq(childrenTable.ownerId, ownerId),
  ));
  if (!child) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  const rows = await db.select().from(childRecordsTable).where(and(
    eq(childRecordsTable.ownerId, ownerId), eq(childRecordsTable.childId, child.id),
  )).orderBy(desc(childRecordsTable.createdAt));
  const canReadConfidential = await permitted(req, "read:child-confidential");
  res.json(ListChildRecordsResponse.parse(
    rows.filter((row) => !row.confidential || canReadConfidential).map(serializeRecord),
  ));
});

router.post("/children/:id/records", async (req, res): Promise<void> => {
  const params = CreateChildRecordParams.safeParse(req.params);
  const body = CreateChildRecordBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }
  if (!await permitted(req, `write:child-${body.data.category}`)) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId, actorId } = nurseryContext(req);
  const [child] = await db.select({ id: childrenTable.id }).from(childrenTable).where(and(
    eq(childrenTable.id, params.data.id), eq(childrenTable.ownerId, ownerId),
  ));
  if (!child) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  const [created] = await db.insert(childRecordsTable).values({
    ownerId, childId: child.id, createdBy: actorId, ...body.data,
    occurredOn: body.data.occurredOn ?? null,
    data: body.data.data ?? {},
  }).returning();
  await auditNurseryOperation(req, "create", `child-${created.category}`, String(created.id), null, created as unknown as Record<string, unknown>);
  res.status(201).json(CreateChildRecordResponse.parse(serializeRecord(created)));
});

router.get("/staff-attendance", async (req, res): Promise<void> => {
  const query = ListStaffAttendanceQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  if (!await permitted(req, "read:attendance")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const rows = await db.select().from(staffAttendanceTable).where(and(
    eq(staffAttendanceTable.ownerId, ownerId),
    query.data.staffId ? eq(staffAttendanceTable.staffId, query.data.staffId) : undefined,
    query.data.dateFrom ? gte(staffAttendanceTable.date, query.data.dateFrom) : undefined,
    query.data.dateTo ? lte(staffAttendanceTable.date, query.data.dateTo) : undefined,
  )).orderBy(desc(staffAttendanceTable.date));
  res.json(ListStaffAttendanceResponse.parse(rows.map(({ ownerId: _, ...row }) => row)));
});

router.post("/staff-attendance", async (req, res): Promise<void> => {
  const body = RecordStaffAttendanceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!await permitted(req, "write:attendance")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId, actorId } = nurseryContext(req);
  const [staff] = await db.select({ id: staffTable.id }).from(staffTable).where(and(
    eq(staffTable.id, body.data.staffId),
    eq(staffTable.ownerId, ownerId),
  ));
  if (!staff) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  const [existing] = await db.select().from(staffAttendanceTable).where(and(
    eq(staffAttendanceTable.ownerId, ownerId),
    eq(staffAttendanceTable.staffId, staff.id),
    eq(staffAttendanceTable.date, body.data.date),
  ));
  const values = { ...body.data, source: body.data.source ?? "manual", recordedBy: actorId };
  const [record] = existing
    ? await db.update(staffAttendanceTable).set(values).where(eq(staffAttendanceTable.id, existing.id)).returning()
    : await db.insert(staffAttendanceTable).values({ ownerId, ...values }).returning();
  await auditNurseryOperation(req, existing ? "update" : "create", "staff-attendance", String(record.id),
    existing as unknown as Record<string, unknown> | null, record as unknown as Record<string, unknown>);
  const { ownerId: _, ...response } = record;
  res.status(201).json(RecordStaffAttendanceResponse.parse(response));
});

router.get("/operations/:resource", async (req, res): Promise<void> => {
  const params = ListOperationalRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!await permitted(req, `read:${params.data.resource}`)) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const rows = await db.select().from(operationalRecordsTable).where(and(
    eq(operationalRecordsTable.ownerId, ownerId),
    eq(operationalRecordsTable.resource, params.data.resource),
  )).orderBy(desc(operationalRecordsTable.createdAt));
  res.json(ListOperationalRecordsResponse.parse(rows.map(serializeRecord)));
});

router.post("/operations/:resource", async (req, res): Promise<void> => {
  const params = CreateOperationalRecordParams.safeParse(req.params);
  const body = CreateOperationalRecordBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }
  if (!await permitted(req, `write:${params.data.resource}`)) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId, actorId } = nurseryContext(req);
  const [created] = await db.insert(operationalRecordsTable).values({
    ownerId, createdBy: actorId, resource: params.data.resource, ...body.data,
    data: body.data.data ?? {},
  }).returning();
  await auditNurseryOperation(req, "create", params.data.resource, String(created.id), null, created as unknown as Record<string, unknown>);
  res.status(201).json(CreateOperationalRecordResponse.parse(serializeRecord(created)));
});

router.patch("/operations/:resource/:id", async (req, res): Promise<void> => {
  const params = UpdateOperationalRecordParams.safeParse(req.params);
  const body = UpdateOperationalRecordBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }
  if (!await permitted(req, `write:${params.data.resource}`)) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [before] = await db.select().from(operationalRecordsTable).where(and(
    eq(operationalRecordsTable.id, params.data.id),
    eq(operationalRecordsTable.ownerId, ownerId),
    eq(operationalRecordsTable.resource, params.data.resource),
  ));
  if (!before) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const [updated] = await db.update(operationalRecordsTable).set(body.data)
    .where(eq(operationalRecordsTable.id, before.id)).returning();
  await auditNurseryOperation(req, "update", params.data.resource, String(updated.id),
    before as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  res.json(UpdateOperationalRecordResponse.parse(serializeRecord(updated)));
});

router.delete("/operations/:resource/:id", async (req, res): Promise<void> => {
  const params = DeleteOperationalRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!await permitted(req, `delete:${params.data.resource}`)) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [deleted] = await db.delete(operationalRecordsTable).where(and(
    eq(operationalRecordsTable.id, params.data.id),
    eq(operationalRecordsTable.ownerId, ownerId),
    eq(operationalRecordsTable.resource, params.data.resource),
  )).returning();
  if (!deleted) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  await auditNurseryOperation(req, "delete", params.data.resource, String(deleted.id), deleted as unknown as Record<string, unknown>, null);
  res.sendStatus(204);
});

router.get("/reports", async (req, res): Promise<void> => {
  const query = GetNurseryReportQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  if (!await permitted(req, `read:report-${query.data.domain}`)) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const resources = query.data.domain === "academic"
    ? [...academicResources]
    : query.data.domain === "financial"
      ? [...financialResources]
      : undefined;
  const { ownerId } = nurseryContext(req);
  if (query.data.domain === "financial") {
    const [invoices, payments, refunds] = await Promise.all([
      db.select().from(invoicesTable).where(and(
        eq(invoicesTable.ownerId, ownerId),
        query.data.status ? eq(invoicesTable.status, query.data.status) : undefined,
        query.data.dateFrom ? gte(invoicesTable.dueDate, query.data.dateFrom) : undefined,
        query.data.dateTo ? lte(invoicesTable.dueDate, query.data.dateTo) : undefined,
      )),
      db.select().from(invoicePaymentsTable).where(and(
        eq(invoicePaymentsTable.ownerId, ownerId),
        inArray(invoicePaymentsTable.status, ["completed", "succeeded"]),
        query.data.dateFrom ? gte(invoicePaymentsTable.createdAt, new Date(`${query.data.dateFrom}T00:00:00.000Z`)) : undefined,
        query.data.dateTo ? lte(invoicePaymentsTable.createdAt, new Date(`${query.data.dateTo}T23:59:59.999Z`)) : undefined,
      )),
      db.select().from(invoiceRefundsTable).where(and(
        eq(invoiceRefundsTable.ownerId, ownerId),
        query.data.dateFrom ? gte(invoiceRefundsTable.createdAt, new Date(`${query.data.dateFrom}T00:00:00.000Z`)) : undefined,
        query.data.dateTo ? lte(invoiceRefundsTable.createdAt, new Date(`${query.data.dateTo}T23:59:59.999Z`)) : undefined,
      )),
    ]);
    const byStatus: Record<string, number> = {};
    invoices.forEach((invoice) => { byStatus[invoice.status] = (byStatus[invoice.status] ?? 0) + 1; });
    const records = invoices.map((invoice) => ({
      id: invoice.id, resource: "revenue" as const, subjectId: invoice.childId, branchId: null,
      title: invoice.invoiceNumber, status: invoice.status, occurredOn: invoice.dueDate,
      amount: invoice.amount, data: {
        guardianId: invoice.guardianId,
        paidAmount: payments.filter((payment) => payment.invoiceId === invoice.id)
          .reduce((sum, payment) => sum + payment.amount, 0),
      },
      createdBy: "system", createdAt: invoice.createdAt.toISOString(),
      updatedAt: (invoice.paidAt ?? invoice.createdAt).toISOString(),
    }));
    res.json(GetNurseryReportResponse.parse({
      domain: "financial", count: invoices.length,
      totalAmount: payments.reduce((sum, payment) => sum + payment.amount, 0)
        - refunds.reduce((sum, refund) => sum + refund.amount, 0),
      byStatus, records,
    }));
    return;
  }
  const rows = await db.select().from(operationalRecordsTable).where(and(
    eq(operationalRecordsTable.ownerId, ownerId),
    resources ? inArray(operationalRecordsTable.resource, resources) : undefined,
    query.data.branchId ? eq(operationalRecordsTable.branchId, query.data.branchId) : undefined,
    query.data.classroomId ? eq(operationalRecordsTable.subjectId, query.data.classroomId) : undefined,
    query.data.status ? eq(operationalRecordsTable.status, query.data.status) : undefined,
    query.data.dateFrom ? gte(operationalRecordsTable.occurredOn, query.data.dateFrom) : undefined,
    query.data.dateTo ? lte(operationalRecordsTable.occurredOn, query.data.dateTo) : undefined,
  )).orderBy(desc(operationalRecordsTable.occurredOn));
  const byStatus: Record<string, number> = {};
  rows.forEach((row) => { byStatus[row.status] = (byStatus[row.status] ?? 0) + 1; });
  res.json(GetNurseryReportResponse.parse({
    domain: query.data.domain,
    count: rows.length,
    totalAmount: rows.reduce((sum, row) => sum + (row.amount ?? 0), 0),
    byStatus,
    records: rows.map(serializeRecord),
  }));
});

router.get("/permissions", async (req, res): Promise<void> => {
  const { ownerId, role } = nurseryContext(req);
  if (!["owner", "superadmin", "admin", "nursery_admin"].includes(role)
      || !await permitted(req, "read:permissions")) {
    res.status(403).json({ error: "Administrative access required" });
    return;
  }
  const rows = await db.select().from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.ownerId, ownerId))
    .orderBy(rolePermissionsTable.role, rolePermissionsTable.operation);
  const configured = new Map(rows.map((row) => [`${row.role}:${row.operation}`, row]));
  const matrix = configurableRoles.flatMap((matrixRole, roleIndex) =>
    configurableOperations.map((operation, operationIndex) => {
      const stored = configured.get(`${matrixRole}:${operation}`);
      if (stored) {
        const { ownerId: _, updatedAt, ...record } = stored;
        return { ...record, updatedAt: updatedAt.toISOString() };
      }
      return {
        id: -(roleIndex * configurableOperations.length + operationIndex + 1),
        role: matrixRole,
        operation,
        allowed: defaultAllowed(matrixRole, operation),
        updatedAt: new Date(0).toISOString(),
      };
    }),
  );
  res.json(ListRolePermissionsResponse.parse(matrix));
});

router.get("/permission-catalog", async (req, res): Promise<void> => {
  if (!ownerOnly(req)) {
    res.status(403).json({ error: "Owner access required" });
    return;
  }
  res.json(GetPermissionCatalogResponse.parse(permissionCatalog));
});

router.put("/permissions/bulk", async (req, res): Promise<void> => {
  const body = BulkSetRolePermissionsBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });
  if (!ownerOnly(req)) return void res.status(403).json({ error: "Owner access required" });
  const keys = body.data.changes.map(({ role, operation }) => `${role}:${operation}`);
  if (keys.some((key, index) => keys.indexOf(key) !== index)) {
    return void res.status(400).json({ error: "Duplicate role and operation change" });
  }
  if (body.data.changes.some(({ role, operation }) => !validRolePermission(role, operation))) {
    return void res.status(400).json({ error: "Unknown configurable role or operation" });
  }
  const { ownerId, actorId, role: actorRole } = nurseryContext(req);
  const records = await db.transaction(async (tx) => {
    const before = [];
    const after = [];
    for (const change of body.data.changes) {
      const [existing] = await tx.select().from(rolePermissionsTable).where(and(
        eq(rolePermissionsTable.ownerId, ownerId),
        eq(rolePermissionsTable.role, change.role),
        eq(rolePermissionsTable.operation, change.operation),
      )).limit(1);
      before.push(existing ?? null);
      const [record] = existing
        ? await tx.update(rolePermissionsTable).set({ allowed: change.allowed })
          .where(eq(rolePermissionsTable.id, existing.id)).returning()
        : await tx.insert(rolePermissionsTable).values({ ownerId, ...change }).returning();
      after.push(record);
    }
    await tx.insert(auditLogsTable).values({
      ownerId,
      actorId,
      actorRole,
      operation: "bulk-set-role-permissions",
      entityType: "role-permission",
      entityId: null,
      before: { permissions: before },
      after: { permissions: after },
    });
    return after;
  });
  res.json(BulkSetRolePermissionsResponse.parse(records.map(({ ownerId: _, updatedAt, ...record }) => ({
    ...record,
    updatedAt: updatedAt.toISOString(),
  }))));
});

router.put("/permissions", async (req, res): Promise<void> => {
  const body = SetRolePermissionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { ownerId, role } = nurseryContext(req);
  if (!["owner", "superadmin"].includes(role)) {
    res.status(403).json({ error: "Owner access required" });
    return;
  }
  if (!validRolePermission(body.data.role, body.data.operation)) {
    res.status(400).json({ error: "Unknown configurable role or operation" });
    return;
  }
  const [existing] = await db.select().from(rolePermissionsTable).where(and(
    eq(rolePermissionsTable.ownerId, ownerId),
    eq(rolePermissionsTable.role, body.data.role),
    eq(rolePermissionsTable.operation, body.data.operation),
  ));
  const [record] = existing
    ? await db.update(rolePermissionsTable).set({ allowed: body.data.allowed })
      .where(eq(rolePermissionsTable.id, existing.id)).returning()
    : await db.insert(rolePermissionsTable).values({ ownerId, ...body.data }).returning();
  await auditNurseryOperation(req, "set-permission", "role-permission", String(record.id),
    existing as unknown as Record<string, unknown> | null, record as unknown as Record<string, unknown>);
  const { ownerId: _, updatedAt, ...data } = record;
  res.json(SetRolePermissionResponse.parse({ ...data, updatedAt: updatedAt.toISOString() }));
});

router.get("/permission-principals", async (req, res): Promise<void> => {
  const { ownerId, role } = nurseryContext(req);
  if (!["owner", "superadmin", "admin", "nursery_admin"].includes(role) || !await permitted(req, "read:permissions")) {
    res.status(403).json({ error: "Administrative access required" });
    return;
  }
  const [clerkPrincipals, linkedStaff, guardians] = await Promise.all([
    tenantClerkPrincipals(ownerId),
    db.select({
      userId: staffTable.clerkUserId,
      label: staffTable.name,
      role: staffTable.role,
    }).from(staffTable).where(and(
      eq(staffTable.ownerId, ownerId),
      eq(staffTable.accountStatus, "active"),
      sql`${staffTable.clerkUserId} is not null`,
    )),
    db.select({ userId: guardiansTable.clerkUserId, label: guardiansTable.name })
      .from(guardiansTable).where(and(eq(guardiansTable.ownerId, ownerId), sql`${guardiansTable.clerkUserId} is not null`)),
  ]);
  const principals = [{ userId: ownerId, label: "مالك الحضانة", role: "owner" }, ...linkedStaff
    .filter((member): member is { userId: string; label: string; role: string } => Boolean(member.userId))
    .map((member) => ({ ...member, role: member.role.toLowerCase() })), ...clerkPrincipals, ...guardians
    .filter((guardian): guardian is { userId: string; label: string } => Boolean(guardian.userId))
    .map((guardian) => ({ userId: guardian.userId, label: guardian.label || "مستخدم معروف", role: "parent" }))];
  res.json(ListPermissionPrincipalsResponse.parse(Array.from(new Map(principals.map((principal) => [principal.userId, principal])).values())));
});

router.get("/user-permissions", async (req, res): Promise<void> => {
  const query = ListUserPermissionsQueryParams.safeParse(req.query);
  if (!query.success) return void res.status(400).json({ error: query.error.message });
  const { ownerId, role } = nurseryContext(req);
  if (!["owner", "superadmin"].includes(role)) return void res.status(403).json({ error: "Owner access required" });
  const rows = await db.select().from(userPermissionsTable).where(and(
    eq(userPermissionsTable.ownerId, ownerId), eq(userPermissionsTable.userId, query.data.userId),
  )).orderBy(userPermissionsTable.operation);
  res.json(ListUserPermissionsResponse.parse(rows.map(({ ownerId: _, updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.toISOString() }))));
});

router.put("/user-permissions", async (req, res): Promise<void> => {
  const body = SetUserPermissionBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });
  const { ownerId, role } = nurseryContext(req);
  if (!["owner", "superadmin"].includes(role)) return void res.status(403).json({ error: "Owner access required" });
  if (!configurableOperationSet.has(body.data.operation)) {
    return void res.status(400).json({ error: "Unknown configurable operation" });
  }
  if (!await tenantPrincipal(ownerId, body.data.userId)) {
    return void res.status(404).json({ error: "Permission principal not found in tenant" });
  }
  const [existing] = await db.select().from(userPermissionsTable).where(and(
    eq(userPermissionsTable.ownerId, ownerId), eq(userPermissionsTable.userId, body.data.userId),
    eq(userPermissionsTable.operation, body.data.operation),
  ));
  const [record] = existing
    ? await db.update(userPermissionsTable).set({ allowed: body.data.allowed }).where(eq(userPermissionsTable.id, existing.id)).returning()
    : await db.insert(userPermissionsTable).values({ ownerId, ...body.data }).returning();
  await auditNurseryOperation(req, "set-user-permission", "user-permission", String(record.id),
    existing as unknown as Record<string, unknown> | null, record as unknown as Record<string, unknown>);
  const { ownerId: _, updatedAt, ...data } = record;
  res.json(SetUserPermissionResponse.parse({ ...data, updatedAt: updatedAt.toISOString() }));
});

router.put("/user-permissions/bulk", async (req, res): Promise<void> => {
  const body = BulkSetUserPermissionsBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });
  if (!ownerOnly(req)) return void res.status(403).json({ error: "Owner access required" });
  if (body.data.changes.some(({ operation }) => !configurableOperationSet.has(operation))) {
    return void res.status(400).json({ error: "Unknown configurable operation" });
  }
  const operations = body.data.changes.map(({ operation }) => operation);
  if (operations.some((operation, index) => operations.indexOf(operation) !== index)) {
    return void res.status(400).json({ error: "Duplicate user operation change" });
  }
  const { ownerId, actorId, role: actorRole } = nurseryContext(req);
  const principal = await tenantPrincipal(ownerId, body.data.userId);
  if (!principal) return void res.status(404).json({ error: "Permission principal not found in tenant" });
  const results = await db.transaction(async (tx) => {
    const before = [];
    const after = [];
    const response = [];
    for (const change of body.data.changes) {
      const [existing] = await tx.select().from(userPermissionsTable).where(and(
        eq(userPermissionsTable.ownerId, ownerId),
        eq(userPermissionsTable.userId, body.data.userId),
        eq(userPermissionsTable.operation, change.operation),
      )).limit(1);
      before.push(existing ?? null);
      let overrideAllowed: boolean | null = change.allowed;
      if (change.allowed === null) {
        if (existing) {
          await tx.delete(userPermissionsTable).where(and(
            eq(userPermissionsTable.id, existing.id),
            eq(userPermissionsTable.ownerId, ownerId),
          ));
        }
        after.push(null);
      } else {
        const [record] = existing
          ? await tx.update(userPermissionsTable).set({ allowed: change.allowed })
            .where(eq(userPermissionsTable.id, existing.id)).returning()
          : await tx.insert(userPermissionsTable).values({
            ownerId,
            userId: body.data.userId,
            operation: change.operation,
            allowed: change.allowed,
          }).returning();
        after.push(record);
        overrideAllowed = record.allowed;
      }
      const [configuredRole] = await tx.select({ allowed: rolePermissionsTable.allowed })
        .from(rolePermissionsTable).where(and(
          eq(rolePermissionsTable.ownerId, ownerId),
          eq(rolePermissionsTable.role, principal.role),
          eq(rolePermissionsTable.operation, change.operation),
        )).limit(1);
      response.push({
        userId: body.data.userId,
        operation: change.operation,
        allowed: overrideAllowed,
        effectiveAllowed: overrideAllowed ?? configuredRole?.allowed
          ?? defaultAllowed(principal.role, change.operation),
      });
    }
    await tx.insert(auditLogsTable).values({
      ownerId,
      actorId,
      actorRole,
      operation: "bulk-set-user-permissions",
      entityType: "user-permission",
      entityId: body.data.userId,
      before: { permissions: before },
      after: { permissions: after },
    });
    return response;
  });
  res.json(BulkSetUserPermissionsResponse.parse(results));
});

router.get("/audit-logs", async (req, res): Promise<void> => {
  const query = ListAuditLogsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { ownerId, role } = nurseryContext(req);
  if (!["owner", "superadmin", "admin", "nursery_admin"].includes(role)) {
    res.status(403).json({ error: "Administrative access required" });
    return;
  }
  if (!await permitted(req, "read:audit")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const rows = await db.select().from(auditLogsTable).where(and(
    eq(auditLogsTable.ownerId, ownerId),
    query.data.operation ? eq(auditLogsTable.operation, query.data.operation) : undefined,
    query.data.entityType ? eq(auditLogsTable.entityType, query.data.entityType) : undefined,
  )).orderBy(desc(auditLogsTable.createdAt)).limit(500);
  res.json(ListAuditLogsResponse.parse(rows.map(({ ownerId: _, createdAt, ...row }) => ({
    ...row, createdAt: createdAt.toISOString(),
  }))));
});

export default router;