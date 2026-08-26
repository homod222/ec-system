import { getAuth } from "@clerk/express";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
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

const router: IRouter = Router();
const storage = new ObjectStorageService();
const uploadObjectPathPattern = /^\/objects\/uploads\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

type ApplicationRow = typeof applicationsTable.$inferSelect;

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

router.use(requireAuth);

router.get("/applications", async (req, res): Promise<void> => {
  const parsed = ListApplicationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const applications = await db
    .select()
    .from(applicationsTable)
    .where(and(
      eq(applicationsTable.ownerId, getAuth(req).userId!),
      parsed.data.status ? eq(applicationsTable.status, parsed.data.status) : undefined,
      parsed.data.type ? eq(applicationsTable.type, parsed.data.type) : undefined,
    ))
    .orderBy(desc(applicationsTable.createdAt));
  const records = await Promise.all(applications.map(applicationRecord));
  res.json(ListApplicationsResponse.parse(records));
});

router.post("/applications", async (req, res): Promise<void> => {
  const parsed = CreateApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ownerId = getAuth(req).userId!;
  const result = await db.transaction(async (tx) => {
    if (parsed.data.classroomId != null) {
      const capacity = await checkClassroomCapacity(tx, ownerId, parsed.data.classroomId);
      if (capacity.kind !== "available") return capacity;
    }
    const [application] = await tx.insert(applicationsTable).values({
      ownerId,
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
  res.status(201).json(CreateApplicationResponse.parse(await applicationRecord(result.application)));
});

router.get("/applications/:id", async (req, res): Promise<void> => {
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
      eq(applicationsTable.ownerId, getAuth(req).userId!),
    ));
  if (!application) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  res.json(GetApplicationResponse.parse(await applicationRecord(application)));
});

router.patch("/applications/:id", async (req, res): Promise<void> => {
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
    const current = await lockApplication(tx, params.data.id, getAuth(req).userId!);
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
    return { kind: "updated" as const, application };
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
  res.json(UpdateApplicationResponse.parse(await applicationRecord(result.application)));
});

router.post("/applications/:id/documents", async (req, res): Promise<void> => {
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
  const ownerId = getAuth(req).userId!;
  const now = new Date();
  const [grant] = await db.select().from(uploadGrantsTable).where(and(
    eq(uploadGrantsTable.objectPath, body.data.objectPath),
    eq(uploadGrantsTable.ownerId, ownerId),
    eq(uploadGrantsTable.applicationId, params.data.id),
    eq(uploadGrantsTable.originalName, body.data.name),
    eq(uploadGrantsTable.contentType, contentType),
    eq(uploadGrantsTable.size, body.data.size),
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
      .set({ consumedAt: new Date() })
      .where(and(
        eq(uploadGrantsTable.id, grant.id),
        eq(uploadGrantsTable.objectPath, body.data.objectPath),
        eq(uploadGrantsTable.ownerId, ownerId),
        eq(uploadGrantsTable.applicationId, application.id),
        eq(uploadGrantsTable.originalName, body.data.name),
        eq(uploadGrantsTable.contentType, contentType),
        eq(uploadGrantsTable.size, body.data.size),
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

router.get("/applications/:applicationId/documents/:documentId/content", async (req, res): Promise<void> => {
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
      eq(applicationsTable.ownerId, getAuth(req).userId!),
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

router.patch("/applications/:id/status", async (req, res): Promise<void> => {
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
    const current = await lockApplication(tx, params.data.id, getAuth(req).userId!);
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
    return { kind: "updated" as const, application };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (result.kind === "illegal") {
    res.status(409).json({ error: "Illegal application status transition" });
    return;
  }
  res.json(UpdateApplicationStatusResponse.parse(await applicationRecord(result.application)));
});

router.post("/applications/:id/accept", async (req, res): Promise<void> => {
  const params = AcceptApplicationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = getAuth(req).userId;

  const result = await db.transaction(async (tx) => {
    const application = await lockApplication(tx, params.data.id, actor!);
    if (!application) return { kind: "missing" as const };
    if (application.status === "accepted") {
      return { kind: "accepted" as const, application };
    }
    if (application.status !== "reviewing") return { kind: "illegal" as const };
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
      const [guardian] = await tx.insert(guardiansTable).values({
        ownerId: application.ownerId,
        name: application.guardianName,
        phone: application.guardianPhone,
        email: application.guardianEmail,
        balance: 0,
      }).returning();
      const [child] = await tx.insert(childrenTable).values({
        ownerId: application.ownerId,
        firstName: application.firstName,
        lastName: application.lastName,
        gender: application.gender,
        birthDate: application.birthDate,
        level: application.level,
        classroomId: application.classroomId,
        notes: application.notes,
        guardianId: guardian.id,
        status: "active",
      }).returning();
      childId = child.id;
    }

    const [accepted] = await tx.update(applicationsTable).set({
      status: "accepted",
      childId,
      updatedAt: new Date(),
    }).where(and(
      eq(applicationsTable.id, application.id),
      eq(applicationsTable.ownerId, application.ownerId),
    )).returning();
    await tx.insert(activitiesTable).values({
      ownerId: application.ownerId,
      type: "enrollment",
      title: application.type === "renewal" ? "تم قبول التجديد" : "تم قبول التسجيل",
      description: `تم تفعيل ملف ${application.firstName} ${application.lastName}`,
      actor,
    });
    return { kind: "accepted" as const, application: accepted };
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
  res.json(AcceptApplicationResponse.parse(await applicationRecord(result.application)));
});

router.post("/children/:id/renewals", async (req, res): Promise<void> => {
  const params = StartChildRenewalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = getAuth(req).userId!;

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from children where id = ${params.data.id} and owner_id = ${actor} for update`);
    const [child] = await tx.select().from(childrenTable).where(and(
      eq(childrenTable.id, params.data.id),
      eq(childrenTable.ownerId, actor),
    ));
    if (!child) return undefined;
    const pending = await tx.select().from(applicationsTable).where(and(
      eq(applicationsTable.type, "renewal"),
      eq(applicationsTable.sourceChildId, child.id),
      eq(applicationsTable.ownerId, actor),
    ));
    const existing = pending.find((application) =>
      application.status === "new" || application.status === "reviewing");
    if (existing) return existing;

    const [guardian] = await tx.select().from(guardiansTable).where(and(
      eq(guardiansTable.id, child.guardianId),
      eq(guardiansTable.ownerId, actor),
    ));
    if (!guardian) return undefined;
    let classroomId: number | null = null;
    if (child.classroomId != null) {
      const [classroom] = await tx.select({ id: classroomsTable.id }).from(classroomsTable).where(and(
        eq(classroomsTable.id, child.classroomId),
        eq(classroomsTable.ownerId, actor),
      ));
      classroomId = classroom?.id ?? null;
    }
    const [application] = await tx.insert(applicationsTable).values({
      ownerId: actor,
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
    }).returning();
    await tx.insert(activitiesTable).values({
      ownerId: actor,
      type: "enrollment",
      title: "بدء طلب تجديد",
      description: `تم بدء تجديد تسجيل ${child.firstName} ${child.lastName}`,
      actor,
    });
    return application;
  });

  if (!result) {
    res.status(404).json({ error: "Child or guardian not found" });
    return;
  }
  res.status(201).json(StartChildRenewalResponse.parse(await applicationRecord(result)));
});

export default router;