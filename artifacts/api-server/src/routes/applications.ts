import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AcceptApplicationParams,
  AcceptApplicationResponse,
  AttachApplicationDocumentBody,
  AttachApplicationDocumentParams,
  AttachApplicationDocumentResponse,
  CreateApplicationBody,
  CreateApplicationResponse,
  GetApplicationDocumentContentParams,
  GetApplicationParams,
  GetApplicationResponse,
  ListApplicationsQueryParams,
  ListApplicationsResponse,
  StartChildRenewalParams,
  StartChildRenewalResponse,
  UpdateApplicationBody,
  UpdateApplicationParams,
  UpdateApplicationResponse,
  UpdateApplicationStatusBody,
  UpdateApplicationStatusParams,
  UpdateApplicationStatusResponse,
} from "@workspace/api-zod";
import {
  activitiesTable,
  applicationDocumentsTable,
  applicationsTable,
  childrenTable,
  childContactsTable,
  classroomsTable,
  db,
  guardiansTable,
  uploadGrantsTable,
} from "@workspace/db";
import {
  isAllowedDocumentContentType,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import { checkClassroomCapacity } from "../lib/classroomCapacity";
import { defaultBranchId } from "../lib/branchScope";
import {
  auditNurseryOperation,
  nurseryContext,
  requireNurseryPermission,
  resolveNurseryContext,
} from "./nurseryOperations";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const uploadObjectPathPattern = /^\/objects\/uploads\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

type ApplicationRow = typeof applicationsTable.$inferSelect;

function applicationAuditSnapshot(application: ApplicationRow): Record<string, unknown> {
  return {
    id: application.id,
    type: application.type,
    status: application.status,
    classroomId: application.classroomId,
    childId: application.childId,
    sourceChildId: application.sourceChildId,
    level: application.level,
    updatedAt: application.updatedAt.toISOString(),
  };
}

async function applicationRecord(application: ApplicationRow) {
  const documents = await db
    .select()
    .from(applicationDocumentsTable)
    .where(eq(applicationDocumentsTable.applicationId, application.id))
    .orderBy(applicationDocumentsTable.createdAt);

  const { ownerId: _ownerId, ...applicationData } = application;
  return {
    ...applicationData,
    documents: documents.map((document) => ({
      ...document,
      createdAt: document.createdAt.toISOString(),
    })),
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  };
}

async function lockApplication(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: number,
  ownerId: string,
) {
  await tx.execute(sql`select id from applications where id = ${id} and owner_id = ${ownerId} for update`);
  const [application] = await tx
    .select()
    .from(applicationsTable)
    .where(and(
      eq(applicationsTable.id, id),
      eq(applicationsTable.ownerId, ownerId),
    ));
  return application;
}

router.use("/applications", resolveNurseryContext);

router.get("/applications", requireNurseryPermission("read:application"), async (req, res): Promise<void> => {
  const parsed = ListApplicationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const applications = await db
    .select()
    .from(applicationsTable)
    .where(and(
      eq(applicationsTable.ownerId, nurseryContext(req).ownerId),
      parsed.data.status ? eq(applicationsTable.status, parsed.data.status) : undefined,
      parsed.data.type ? eq(applicationsTable.type, parsed.data.type) : undefined,
    ))
    .orderBy(desc(applicationsTable.createdAt));
  const records = await Promise.all(applications.map(applicationRecord));
  res.json(ListApplicationsResponse.parse(records));
});

router.post("/applications", requireNurseryPermission("write:application"), async (req, res): Promise<void> => {
  const parsed = CreateApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ownerId = nurseryContext(req).ownerId;
  const result = await db.transaction(async (tx) => {
    const branchId = await defaultBranchId(tx, ownerId);
    if (parsed.data.classroomId != null) {
      const capacity = await checkClassroomCapacity(tx, ownerId, parsed.data.classroomId);
      if (capacity.kind !== "available") return capacity;
    }
    const [application] = await tx.insert(applicationsTable).values({
      ownerId,
      branchId,
      type: "new",
      status: "new",
      ...parsed.data,
      classroomId: parsed.data.classroomId ?? null,
      notes: parsed.data.notes ?? null,
      guardianEmail: parsed.data.guardianEmail ?? null,
    }).returning();
    return { kind: "created" as const, application };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (result.kind === "full") {
    res.status(409).json({ error: "Classroom is full" });
    return;
  }
  await auditNurseryOperation(
    req, "create", "application", String(result.application.id),
    null, applicationAuditSnapshot(result.application),
  );
  res.status(201).json(CreateApplicationResponse.parse(await applicationRecord(result.application)));
});

router.get("/applications/:id", requireNurseryPermission("read:application"), async (req, res): Promise<void> => {
  const parsed = GetApplicationParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [application] = await db
    .select()
    .from(applicationsTable)
    .where(and(
      eq(applicationsTable.id, parsed.data.id),
      eq(applicationsTable.ownerId, nurseryContext(req).ownerId),
    ));
  if (!application) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  res.json(GetApplicationResponse.parse(await applicationRecord(application)));
});

router.patch("/applications/:id", requireNurseryPermission("write:application"), async (req, res): Promise<void> => {
  const params = UpdateApplicationParams.safeParse(req.params);
  const body = UpdateApplicationBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const current = await lockApplication(tx, params.data.id, nurseryContext(req).ownerId);
    if (!current) return { kind: "missing" as const };
    if (current.status === "accepted") return { kind: "accepted" as const };
    if (body.data.classroomId != null && body.data.classroomId !== current.classroomId) {
      const capacity = await checkClassroomCapacity(
        tx,
        current.ownerId,
        body.data.classroomId,
        current.type === "renewal" ? current.sourceChildId ?? undefined : undefined,
      );
      if (capacity.kind === "missing") return { kind: "classroomMissing" as const };
      if (capacity.kind === "full") return { kind: "classroomFull" as const };
    }
    const [application] = await tx
      .update(applicationsTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(and(
        eq(applicationsTable.id, current.id),
        eq(applicationsTable.ownerId, current.ownerId),
      ))
      .returning();
    return { kind: "updated" as const, application, before: current };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (result.kind === "accepted") {
    res.status(409).json({ error: "Accepted applications cannot be edited" });
    return;
  }
  if (result.kind === "classroomMissing") {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (result.kind === "classroomFull") {
    res.status(409).json({ error: "Classroom is full" });
    return;
  }
  await auditNurseryOperation(
    req, "update", "application", String(result.application.id),
    applicationAuditSnapshot(result.before), applicationAuditSnapshot(result.application),
  );
  res.json(UpdateApplicationResponse.parse(await applicationRecord(result.application)));
});

router.post("/applications/:id/documents", requireNurseryPermission("write:application-document"), async (req, res): Promise<void> => {
  const params = AttachApplicationDocumentParams.safeParse(req.params);
  const body = AttachApplicationDocumentBody.safeParse(req.body);
  if (!params.success || !body.success || (body.success && (
    !Number.isSafeInteger(body.data.size) ||
    body.data.size < 1 ||
    body.data.size > MAX_DOCUMENT_SIZE
  ))) {
    res.status(400).json({
      error: !params.success
        ? params.error.message
        : !body.success
          ? body.error.message
          : "Document size must be a whole number between 1 byte and 10 MiB",
    });
    return;
  }
  if (!uploadObjectPathPattern.test(body.data.objectPath)) {
    res.status(400).json({ error: "Document object path must be an uploaded object path" });
    return;
  }
  const contentType = body.data.contentType.toLowerCase();
  if (!isAllowedDocumentContentType(contentType)) {
    res.status(415).json({ error: "Unsupported document type" });
    return;
  }
  const ownerId = nurseryContext(req).ownerId;
  const now = new Date();
  const [grant] = await db.select().from(uploadGrantsTable).where(and(
    eq(uploadGrantsTable.objectPath, body.data.objectPath),
    eq(uploadGrantsTable.ownerId, ownerId),
    eq(uploadGrantsTable.applicationId, params.data.id),
    eq(uploadGrantsTable.targetType, "application-document"),
    eq(uploadGrantsTable.targetId, params.data.id),
    eq(uploadGrantsTable.originalName, body.data.name),
    eq(uploadGrantsTable.contentType, contentType),
    eq(uploadGrantsTable.size, body.data.size),
    eq(uploadGrantsTable.status, "completed"),
    isNull(uploadGrantsTable.consumedAt),
    gt(uploadGrantsTable.expiresAt, now),
  ));
  if (!grant) {
    res.status(404).json({ error: "Valid upload grant not found" });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(body.data.objectPath);
    const metadata = await storage.getObjectMetadata(file);
    if (metadata.size !== grant.size ||
        metadata.size < 1 ||
        metadata.size > MAX_DOCUMENT_SIZE ||
        metadata.contentType !== grant.contentType ||
        !isAllowedDocumentContentType(metadata.contentType)) {
      try {
        await storage.deleteObject(file);
      } catch (deleteError) {
        req.log.warn({ err: deleteError }, "Failed to remove invalid uploaded object");
      }
      res.status(400).json({ error: "Uploaded object metadata does not match the upload grant" });
      return;
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Uploaded document object not found" });
      return;
    }
    throw error;
  }

  const result = await db.transaction(async (tx) => {
    const application = await lockApplication(tx, params.data.id, ownerId);
    if (!application) return { kind: "missing" as const };
    if (application.status === "accepted") return { kind: "accepted" as const };
    await tx.execute(sql`select id from upload_grants where id = ${grant.id} for update`);
    const [consumedGrant] = await tx.update(uploadGrantsTable)
      .set({ status: "consumed", consumedAt: new Date() })
      .where(and(
        eq(uploadGrantsTable.id, grant.id),
        eq(uploadGrantsTable.objectPath, body.data.objectPath),
        eq(uploadGrantsTable.ownerId, ownerId),
        eq(uploadGrantsTable.applicationId, application.id),
        eq(uploadGrantsTable.targetType, "application-document"),
        eq(uploadGrantsTable.targetId, application.id),
        eq(uploadGrantsTable.originalName, body.data.name),
        eq(uploadGrantsTable.contentType, contentType),
        eq(uploadGrantsTable.size, body.data.size),
        eq(uploadGrantsTable.status, "completed"),
        isNull(uploadGrantsTable.consumedAt),
        gt(uploadGrantsTable.expiresAt, new Date()),
      ))
      .returning();
    if (!consumedGrant) return { kind: "grantMissing" as const };
    const [document] = await tx.insert(applicationDocumentsTable).values({
      applicationId: application.id,
      name: body.data.name,
      contentType,
      size: body.data.size,
      objectPath: body.data.objectPath,
    }).returning();
    return { kind: "created" as const, document };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (result.kind === "accepted") {
    res.status(409).json({ error: "Accepted applications cannot be edited" });
    return;
  }
  if (result.kind === "grantMissing") {
    res.status(404).json({ error: "Valid upload grant not found" });
    return;
  }
  res.status(201).json(AttachApplicationDocumentResponse.parse({
    ...result.document,
    createdAt: result.document.createdAt.toISOString(),
  }));
});

router.get("/applications/:applicationId/documents/:documentId/content", requireNurseryPermission("read:application"), async (req, res): Promise<void> => {
  const params = GetApplicationDocumentContentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [result] = await db
    .select({ document: applicationDocumentsTable })
    .from(applicationDocumentsTable)
    .innerJoin(applicationsTable, and(
      eq(applicationDocumentsTable.applicationId, applicationsTable.id),
      eq(applicationsTable.ownerId, nurseryContext(req).ownerId),
    ))
    .where(and(
      eq(applicationDocumentsTable.id, params.data.documentId),
      eq(applicationDocumentsTable.applicationId, params.data.applicationId),
    ));
  const document = result?.document;
  if (!document || !document.objectPath.startsWith("/objects/uploads/")) {
    res.status(404).json({ error: "Application document not found" });
    return;
  }
  try {
    const response = await storage.downloadObject(await storage.getObjectEntityFile(document.objectPath));
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() !== "content-type" && name.toLowerCase() !== "content-disposition") {
        res.setHeader(name, value);
      }
    });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    if (!response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Application document not found" });
      return;
    }
    throw error;
  }
});

router.patch("/applications/:id/status", requireNurseryPermission("write:application"), async (req, res): Promise<void> => {
  const params = UpdateApplicationStatusParams.safeParse(req.params);
  const body = UpdateApplicationStatusBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const current = await lockApplication(tx, params.data.id, nurseryContext(req).ownerId);
    if (!current) return { kind: "missing" as const };
    const allowed = (current.status === "new" &&
      (body.data.status === "reviewing" || body.data.status === "rejected")) ||
      (current.status === "reviewing" && body.data.status === "rejected");
    if (!allowed) return { kind: "illegal" as const };
    const [application] = await tx.update(applicationsTable).set({
      status: body.data.status,
      updatedAt: new Date(),
    }).where(and(
      eq(applicationsTable.id, current.id),
      eq(applicationsTable.ownerId, current.ownerId),
    )).returning();
    return { kind: "updated" as const, application, before: current };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (result.kind === "illegal") {
    res.status(409).json({ error: "Illegal application status transition" });
    return;
  }
  await auditNurseryOperation(
    req, "update-status", "application", String(result.application.id),
    applicationAuditSnapshot(result.before), applicationAuditSnapshot(result.application),
  );
  res.json(UpdateApplicationStatusResponse.parse(await applicationRecord(result.application)));
});

router.post("/applications/:id/accept", requireNurseryPermission("accept:application"), async (req, res): Promise<void> => {
  const params = AcceptApplicationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { ownerId, actorId } = nurseryContext(req);

  const result = await db.transaction(async (tx) => {
    const application = await lockApplication(tx, params.data.id, ownerId);
    if (!application) return { kind: "missing" as const };
    if (application.status === "accepted") {
      return { kind: "accepted" as const, application, before: null };
    }
    if (application.status !== "reviewing") return { kind: "illegal" as const };
    const applicationBranchId = application.branchId ?? await defaultBranchId(tx, application.ownerId);
    let childId: number;
    if (application.type === "renewal") {
      if (!application.sourceChildId) return { kind: "childMissing" as const };
      const [child] = await tx
        .select()
        .from(childrenTable)
        .where(and(
          eq(childrenTable.id, application.sourceChildId),
          eq(childrenTable.ownerId, application.ownerId),
        ));
      if (!child) return { kind: "childMissing" as const };
      if (application.classroomId != null) {
        const capacity = await checkClassroomCapacity(
          tx,
          application.ownerId,
          application.classroomId,
          child.id,
        );
        if (capacity.kind === "missing") return { kind: "classroomMissing" as const };
        if (capacity.kind === "full") return { kind: "classroomFull" as const };
      }
      const [guardian] = await tx.update(guardiansTable).set({
        name: application.guardianName,
        phone: application.guardianPhone,
        email: application.guardianEmail,
      }).where(and(
        eq(guardiansTable.id, child.guardianId),
        eq(guardiansTable.ownerId, application.ownerId),
      )).returning();
      if (!guardian) return { kind: "childMissing" as const };
      await tx.update(childrenTable).set({
        firstName: application.firstName,
        lastName: application.lastName,
        gender: application.gender,
        birthDate: application.birthDate,
        level: application.level,
        classroomId: application.classroomId,
        branchId: applicationBranchId,
        notes: application.notes,
        status: "active",
      }).where(and(
        eq(childrenTable.id, child.id),
        eq(childrenTable.ownerId, application.ownerId),
      ));
      childId = child.id;
    } else {
      if (application.classroomId != null) {
        const capacity = await checkClassroomCapacity(
          tx,
          application.ownerId,
          application.classroomId,
        );
        if (capacity.kind === "missing") return { kind: "classroomMissing" as const };
        if (capacity.kind === "full") return { kind: "classroomFull" as const };
      }
      const email = application.guardianEmail?.trim().toLowerCase();
      const normalizedPhone = application.guardianPhone.replace(/[^0-9+]/g, "");
      const identityKey = email ? `email:${email}` : normalizedPhone ? `phone:${normalizedPhone}` : null;
      if (!identityKey) return { kind: "guardianIdentityMissing" as const };
      const guardianResult = await tx.execute(sql`
        INSERT INTO guardians (owner_id, branch_id, name, phone, email, balance, identity_key)
        VALUES (${application.ownerId}, ${applicationBranchId}, ${application.guardianName}, ${application.guardianPhone},
          ${email ?? null}, 0, ${identityKey})
        ON CONFLICT (owner_id, identity_key) WHERE identity_key IS NOT NULL
        DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone,
          email = COALESCE(EXCLUDED.email, guardians.email)
        RETURNING *
      `);
      const guardian = guardianResult.rows[0] as typeof guardiansTable.$inferSelect | undefined;
      if (!guardian) return { kind: "guardianIdentityMissing" as const };
      const [child] = await tx.insert(childrenTable).values({
        ownerId: application.ownerId,
        firstName: application.firstName,
        lastName: application.lastName,
        gender: application.gender,
        birthDate: application.birthDate,
        level: application.level,
        classroomId: application.classroomId,
        branchId: applicationBranchId,
        notes: application.notes,
        guardianId: guardian.id,
        status: "active",
      }).returning();
      childId = child.id;
      await tx.insert(childContactsTable).values({
        ownerId: application.ownerId,
        childId,
        type: "guardian",
        name: application.guardianName,
        relationship: "guardian",
        phone: application.guardianPhone,
        email: application.guardianEmail,
        primary: true,
        createdBy: actorId,
      });
    }

    const [accepted] = await tx.update(applicationsTable).set({
      status: "accepted",
      childId,
      updatedAt: new Date(),
    }).where(and(
      eq(applicationsTable.id, application.id),
      eq(applicationsTable.ownerId, application.ownerId),
    )).returning();
    await tx.update(applicationDocumentsTable).set({ childId })
      .where(eq(applicationDocumentsTable.applicationId, application.id));
    await tx.insert(activitiesTable).values({
      ownerId: application.ownerId,
      type: "enrollment",
      title: application.type === "renewal" ? "تم قبول التجديد" : "تم قبول التسجيل",
      description: `تم تفعيل ملف ${application.firstName} ${application.lastName}`,
      actor: actorId,
    });
    return { kind: "accepted" as const, application: accepted, before: application };
  });

  if (result.kind === "missing") {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (result.kind === "childMissing") {
    res.status(404).json({ error: "Renewal child not found" });
    return;
  }
  if (result.kind === "classroomMissing") {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (result.kind === "classroomFull") {
    res.status(409).json({ error: "Classroom is full" });
    return;
  }
  if (result.kind === "illegal") {
    res.status(409).json({ error: "Only reviewing applications can be accepted" });
    return;
  }
  if (result.kind === "guardianIdentityMissing") {
    res.status(400).json({ error: "Guardian must have a usable email or phone identity" });
    return;
  }
  if (result.before) {
    await auditNurseryOperation(
      req, "accept", "application", String(result.application.id),
      applicationAuditSnapshot(result.before), applicationAuditSnapshot(result.application),
    );
  }
  res.json(AcceptApplicationResponse.parse(await applicationRecord(result.application)));
});

router.post(
  "/children/:id/renewals",
  resolveNurseryContext,
  requireNurseryPermission("write:application"),
  async (req, res): Promise<void> => {
  const params = StartChildRenewalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { ownerId, actorId } = nurseryContext(req);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from children where id = ${params.data.id} and owner_id = ${ownerId} for update`);
    const [child] = await tx.select().from(childrenTable).where(and(
      eq(childrenTable.id, params.data.id),
      eq(childrenTable.ownerId, ownerId),
    ));
    if (!child) return undefined;
    const pending = await tx.select().from(applicationsTable).where(and(
      eq(applicationsTable.type, "renewal"),
      eq(applicationsTable.sourceChildId, child.id),
      eq(applicationsTable.ownerId, ownerId),
    ));
    const existing = pending.find((application) =>
      application.status === "new" || application.status === "reviewing");
    if (existing) return { application: existing, created: false as const };

    const [guardian] = await tx.select().from(guardiansTable).where(and(
      eq(guardiansTable.id, child.guardianId),
      eq(guardiansTable.ownerId, ownerId),
    ));
    if (!guardian) return undefined;
    let classroomId: number | null = null;
    if (child.classroomId != null) {
      const [classroom] = await tx.select({ id: classroomsTable.id }).from(classroomsTable).where(and(
        eq(classroomsTable.id, child.classroomId),
        eq(classroomsTable.ownerId, ownerId),
      ));
      classroomId = classroom?.id ?? null;
    }
    const [application] = await tx.insert(applicationsTable).values({
      ownerId,
      type: "renewal",
      status: "new",
      sourceChildId: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      gender: child.gender,
      birthDate: child.birthDate,
      level: child.level,
      classroomId,
      notes: child.notes,
      guardianName: guardian.name,
      guardianPhone: guardian.phone,
      guardianEmail: guardian.email,
      branchId: child.branchId ?? await defaultBranchId(tx, ownerId),
    }).returning();
    await tx.insert(activitiesTable).values({
      ownerId,
      type: "enrollment",
      title: "بدء طلب تجديد",
      description: `تم بدء تجديد تسجيل ${child.firstName} ${child.lastName}`,
      actor: actorId,
    });
    return { application, created: true as const };
  });

  if (!result) {
    res.status(404).json({ error: "Child or guardian not found" });
    return;
  }
  if (result.created) {
    await auditNurseryOperation(
      req, "create", "application", String(result.application.id),
      null, applicationAuditSnapshot(result.application),
    );
  }
  res.status(201).json(StartChildRenewalResponse.parse(await applicationRecord(result.application)));
  },
);

export default router;