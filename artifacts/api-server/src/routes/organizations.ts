import { Router, type IRouter, type RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { getLocalAuth } from "../lib/localAuth";
import {
  CreateBranchBody,
  CreateBranchResponse,
  CreateOrganizationBody,
  CreateOrganizationResponse,
  DeleteBranchParams,
  DeleteOrganizationParams,
  ListBranchesQueryParams,
  ListBranchesResponse,
  ListOrganizationsResponse,
  UpdateBranchBody,
  UpdateBranchParams,
  UpdateBranchResponse,
  UpdateOrganizationBody,
  UpdateOrganizationParams,
  UpdateOrganizationResponse,
} from "@workspace/api-zod";
import {
  branchesTable,
  classroomsTable,
  db,
  organizationsTable,
  staffTable,
  stagesTable,
} from "@workspace/db";
import {
  auditNurseryOperation,
  nurseryContext,
  permitted,
  resolveNurseryContext,
} from "./nurseryOperations";
import {
  branchCode,
  derivePrefix,
  organizationCode,
  prefixOf,
  uniquePrefix,
} from "../lib/organizationCodes";

const router: IRouter = Router();

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getLocalAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

router.use(requireAuth, resolveNurseryContext);

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

function organizationResponse(row: typeof organizationsTable.$inferSelect) {
  const { ownerId: _ownerId, settings: _settings, createdAt: _createdAt, ...response } = row;
  return response;
}

function branchResponse(row: typeof branchesTable.$inferSelect) {
  const {
    ownerId: _ownerId,
    settings: _settings,
    createdAt: _createdAt,
    legacyRecordId: _legacyRecordId,
    capacity: _capacity,
    ...response
  } = row;
  return response;
}

router.get("/organizations", async (req, res): Promise<void> => {
  if (!await permitted(req, "read:organization")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const rows = await db.select().from(organizationsTable)
    .where(eq(organizationsTable.ownerId, ownerId))
    .orderBy(organizationsTable.name);
  res.json(ListOrganizationsResponse.parse(rows.map(organizationResponse)));
});

router.post("/organizations", async (req, res): Promise<void> => {
  const body = CreateOrganizationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!await permitted(req, "write:organization")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  let created: typeof organizationsTable.$inferSelect | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const rows = await db.select({ code: organizationsTable.code })
        .from(organizationsTable)
        .where(eq(organizationsTable.ownerId, ownerId));
      const taken = new Set(rows.map((row) => prefixOf(row.code)));
      const code = organizationCode(uniquePrefix(derivePrefix(body.data.name), taken));
      [created] = await db.insert(organizationsTable).values({
        ownerId,
        ...body.data,
        code,
      }).returning();
      break;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error) || attempt === 4) throw error;
    }
  }
  if (!created) throw lastError ?? new Error("Organization creation failed");
  await auditNurseryOperation(
    req,
    "create",
    "organization",
    String(created.id),
    null,
    organizationResponse(created) as unknown as Record<string, unknown>,
  );
  res.status(201).json(CreateOrganizationResponse.parse(organizationResponse(created)));
});

router.patch("/organizations/:id", async (req, res): Promise<void> => {
  const params = UpdateOrganizationParams.safeParse(req.params);
  const body = UpdateOrganizationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? (body.error?.message ?? "Invalid request") : params.error.message });
    return;
  }
  if (!await permitted(req, "write:organization")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [before] = await db.select().from(organizationsTable).where(and(
    eq(organizationsTable.id, params.data.id),
    eq(organizationsTable.ownerId, ownerId),
  ));
  if (!before) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const [updated] = await db.update(organizationsTable).set(body.data).where(and(
    eq(organizationsTable.id, before.id),
    eq(organizationsTable.ownerId, ownerId),
  )).returning();
  await auditNurseryOperation(
    req,
    "update",
    "organization",
    String(updated.id),
    organizationResponse(before) as unknown as Record<string, unknown>,
    organizationResponse(updated) as unknown as Record<string, unknown>,
  );
  res.json(UpdateOrganizationResponse.parse(organizationResponse(updated)));
});

router.delete("/organizations/:id", async (req, res): Promise<void> => {
  const params = DeleteOrganizationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!await permitted(req, "delete:organization")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [organization] = await db.select().from(organizationsTable).where(and(
    eq(organizationsTable.id, params.data.id),
    eq(organizationsTable.ownerId, ownerId),
  ));
  if (!organization) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const [branch] = await db.select({ id: branchesTable.id }).from(branchesTable).where(and(
    eq(branchesTable.organizationId, organization.id),
    eq(branchesTable.ownerId, ownerId),
  )).limit(1);
  if (branch) {
    res.status(409).json({ error: "Organization still has branches" });
    return;
  }
  await db.delete(organizationsTable).where(and(
    eq(organizationsTable.id, organization.id),
    eq(organizationsTable.ownerId, ownerId),
  ));
  await auditNurseryOperation(
    req,
    "delete",
    "organization",
    String(organization.id),
    organizationResponse(organization) as unknown as Record<string, unknown>,
    null,
  );
  res.sendStatus(204);
});

router.get("/branches", async (req, res): Promise<void> => {
  const query = ListBranchesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  if (!await permitted(req, "read:branch")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const conditions = [eq(branchesTable.ownerId, ownerId)];
  if (query.data.organizationId !== undefined) {
    conditions.push(eq(branchesTable.organizationId, query.data.organizationId));
  }
  const rows = await db.select().from(branchesTable)
    .where(and(...conditions))
    .orderBy(branchesTable.name);
  res.json(ListBranchesResponse.parse(rows.map(branchResponse)));
});

router.post("/branches", async (req, res): Promise<void> => {
  const body = CreateBranchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!await permitted(req, "write:branch")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [organization] = await db.select({
    id: organizationsTable.id,
    code: organizationsTable.code,
  })
    .from(organizationsTable).where(and(
      eq(organizationsTable.id, body.data.organizationId),
      eq(organizationsTable.ownerId, ownerId),
    ));
  if (!organization) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  let created: typeof branchesTable.$inferSelect | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const rows = await db.select({ code: branchesTable.code })
        .from(branchesTable).where(and(
          eq(branchesTable.ownerId, ownerId),
          eq(branchesTable.organizationId, organization.id),
        ));
      const prefix = prefixOf(organization.code);
      const taken = new Set<number>();
      for (const row of rows) {
        const normalizedCode = row.code.toUpperCase();
        if (!normalizedCode.startsWith(`${prefix}.`)) continue;
        const suffix = Number(normalizedCode.slice(prefix.length + 1));
        if (!Number.isNaN(suffix)) taken.add(suffix);
      }
      const code = branchCode(prefix, taken);
      [created] = await db.insert(branchesTable).values({
        ownerId,
        ...body.data,
        code,
      }).returning();
      break;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error) || attempt === 4) throw error;
    }
  }
  if (!created) throw lastError ?? new Error("Branch creation failed");
  await auditNurseryOperation(
    req,
    "create",
    "branch",
    String(created.id),
    null,
    branchResponse(created) as unknown as Record<string, unknown>,
  );
  res.status(201).json(CreateBranchResponse.parse(branchResponse(created)));
});

router.patch("/branches/:id", async (req, res): Promise<void> => {
  const params = UpdateBranchParams.safeParse(req.params);
  const body = UpdateBranchBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? (body.error?.message ?? "Invalid request") : params.error.message });
    return;
  }
  if (!await permitted(req, "write:branch")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [before] = await db.select().from(branchesTable).where(and(
    eq(branchesTable.id, params.data.id),
    eq(branchesTable.ownerId, ownerId),
  ));
  if (!before) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  if (body.data.organizationId !== undefined) {
    const [organization] = await db.select({ id: organizationsTable.id })
      .from(organizationsTable).where(and(
        eq(organizationsTable.id, body.data.organizationId),
        eq(organizationsTable.ownerId, ownerId),
      ));
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
  }
  const [updated] = await db.update(branchesTable).set(body.data).where(and(
    eq(branchesTable.id, before.id),
    eq(branchesTable.ownerId, ownerId),
  )).returning();
  await auditNurseryOperation(
    req,
    "update",
    "branch",
    String(updated.id),
    branchResponse(before) as unknown as Record<string, unknown>,
    branchResponse(updated) as unknown as Record<string, unknown>,
  );
  res.json(UpdateBranchResponse.parse(branchResponse(updated)));
});

router.delete("/branches/:id", async (req, res): Promise<void> => {
  const params = DeleteBranchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!await permitted(req, "delete:branch")) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [branch] = await db.select().from(branchesTable).where(and(
    eq(branchesTable.id, params.data.id),
    eq(branchesTable.ownerId, ownerId),
  ));
  if (!branch) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  const references = await Promise.all([
    db.select({ id: classroomsTable.id }).from(classroomsTable)
      .where(and(eq(classroomsTable.ownerId, ownerId), eq(classroomsTable.branchId, branch.id))).limit(1),
    db.select({ id: staffTable.id }).from(staffTable)
      .where(and(eq(staffTable.ownerId, ownerId), eq(staffTable.branchId, branch.id))).limit(1),
    db.select({ id: stagesTable.id }).from(stagesTable)
      .where(and(eq(stagesTable.ownerId, ownerId), eq(stagesTable.branchId, branch.id))).limit(1),
  ]);
  if (references.some(rows => rows.length > 0)) {
    res.status(409).json({ error: "Branch is referenced by nursery data" });
    return;
  }
  await db.delete(branchesTable).where(and(
    eq(branchesTable.id, branch.id),
    eq(branchesTable.ownerId, ownerId),
  ));
  await auditNurseryOperation(
    req,
    "delete",
    "branch",
    String(branch.id),
    branchResponse(branch) as unknown as Record<string, unknown>,
    null,
  );
  res.sendStatus(204);
});

export default router;
