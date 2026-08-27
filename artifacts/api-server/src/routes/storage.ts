import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { applicationsTable, db, uploadGrantsTable } from "@workspace/db";
import {
  isAllowedDocumentContentType,
  ObjectNotFoundError,
  ObjectStorageService,
  ObjectUploadSizeError,
  ObjectUploadTimeoutError,
} from "../lib/objectStorage";
import { logger } from "../lib/logger";
import {
  nurseryContext,
  requireNurseryPermission,
  resolveNurseryContext,
} from "./nurseryOperations";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const UPLOAD_GRANT_TTL_MS = 5 * 60 * 1000;
const UPLOAD_RESERVATION_TTL_MS = 2 * 60 * 1000;
const COMPLETED_UPLOAD_TTL_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_CONCURRENT_UPLOADS = 4;
let activeUploads = 0;

async function deleteGrantedObject(objectPath: string): Promise<void> {
  try {
    await storage.deleteObject(await storage.getObjectEntityFile(objectPath));
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }
}

async function purgeExpiredUploadGrants(): Promise<void> {
  const candidates = await db.select().from(uploadGrantsTable).where(and(
    isNull(uploadGrantsTable.consumedAt),
    ne(uploadGrantsTable.status, "consumed"),
    lt(uploadGrantsTable.expiresAt, new Date()),
  )).limit(50);
  for (const candidate of candidates) {
    const [grant] = await db.update(uploadGrantsTable)
      .set({ status: "cleaning" })
      .where(and(
        eq(uploadGrantsTable.id, candidate.id),
        eq(uploadGrantsTable.status, candidate.status),
        isNull(uploadGrantsTable.consumedAt),
        lt(uploadGrantsTable.expiresAt, new Date()),
      ))
      .returning();
    if (!grant) continue;
    await deleteGrantedObject(grant.objectPath);
    await db.delete(uploadGrantsTable).where(and(
      eq(uploadGrantsTable.id, grant.id),
      eq(uploadGrantsTable.status, "cleaning"),
    ));
  }
}

const cleanupTimer = setInterval(() => {
  void purgeExpiredUploadGrants().catch((error) => {
    logger.error({ err: error }, "Failed to purge expired upload grants");
  });
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

router.post(
  "/storage/uploads/request-url",
  resolveNurseryContext,
  requireNurseryPermission("write:application-document"),
  async (req, res): Promise<void> => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!Number.isSafeInteger(parsed.data.size) ||
      parsed.data.size < 1 ||
      parsed.data.size > MAX_DOCUMENT_SIZE) {
    res.status(400).json({ error: "Document size must be a whole number between 1 byte and 10 MiB" });
    return;
  }
  const contentType = parsed.data.contentType.toLowerCase();
  if (!isAllowedDocumentContentType(contentType)) {
    res.status(415).json({ error: "Unsupported document type" });
    return;
  }
  const ownerId = nurseryContext(req).ownerId;
  const [existing] = await db.select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(and(
      eq(applicationsTable.id, parsed.data.applicationId),
      eq(applicationsTable.ownerId, ownerId),
    ));
  if (!existing) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  await purgeExpiredUploadGrants();
  const objectPath = storage.createObjectEntityPath();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from applications where id = ${parsed.data.applicationId} and owner_id = ${ownerId} for update`);
    const [application] = await tx.select().from(applicationsTable).where(and(
      eq(applicationsTable.id, parsed.data.applicationId),
      eq(applicationsTable.ownerId, ownerId),
    ));
    if (!application) return "missing" as const;
    if (application.status === "accepted") return "accepted" as const;
    const [grant] = await tx.insert(uploadGrantsTable).values({
      objectPath,
      ownerId,
      applicationId: application.id,
      originalName: parsed.data.name,
      contentType,
      size: parsed.data.size,
      status: "issued",
      expiresAt: new Date(Date.now() + UPLOAD_GRANT_TTL_MS),
    }).returning({ id: uploadGrantsTable.id });
    return { kind: "created" as const, grantId: grant.id };
  });
  if (result === "missing") {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (result === "accepted") {
    res.status(409).json({ error: "Accepted applications cannot be edited" });
    return;
  }
  const uploadUrl = `/api/storage/uploads/${result.grantId}/content`;
  res.json(RequestUploadUrlResponse.parse({ uploadUrl, objectPath }));
  },
);

router.put(
  "/storage/uploads/:grantId/content",
  resolveNurseryContext,
  requireNurseryPermission("write:application-document"),
  async (req, res): Promise<void> => {
  const grantId = Number(req.params.grantId);
  if (!Number.isSafeInteger(grantId) || grantId < 1) {
    res.status(400).json({ error: "Invalid upload grant" });
    return;
  }

  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    res.status(429).json({ error: "Too many uploads in progress" });
    return;
  }
  activeUploads += 1;
  const contentType = (req.header("content-type") ?? "").toLowerCase();
  const contentLength = Number(req.header("content-length"));
  const ownerId = nurseryContext(req).ownerId;
  const reservation = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from upload_grants where id = ${grantId} and owner_id = ${ownerId} for update`);
    const [grant] = await tx.select().from(uploadGrantsTable).where(and(
      eq(uploadGrantsTable.id, grantId),
      eq(uploadGrantsTable.ownerId, ownerId),
      eq(uploadGrantsTable.status, "issued"),
      isNull(uploadGrantsTable.consumedAt),
      gt(uploadGrantsTable.expiresAt, new Date()),
    ));
    if (!grant) return { kind: "missing" as const };
    const [application] = await tx.select({ status: applicationsTable.status })
      .from(applicationsTable)
      .where(and(
        eq(applicationsTable.id, grant.applicationId),
        eq(applicationsTable.ownerId, ownerId),
      ));
    if (!application) return { kind: "applicationMissing" as const };
    if (application.status === "accepted") return { kind: "accepted" as const };
    if (!Number.isSafeInteger(contentLength) || contentLength !== grant.size) {
      return { kind: "sizeMismatch" as const };
    }
    if (contentType !== grant.contentType || !isAllowedDocumentContentType(contentType)) {
      return { kind: "typeMismatch" as const };
    }
    const [reserved] = await tx.update(uploadGrantsTable).set({
      status: "uploading",
      expiresAt: new Date(Date.now() + UPLOAD_RESERVATION_TTL_MS),
    }).where(and(
      eq(uploadGrantsTable.id, grant.id),
      eq(uploadGrantsTable.status, "issued"),
    )).returning();
    return reserved
      ? { kind: "reserved" as const, grant: reserved }
      : { kind: "missing" as const };
  }).catch((error) => {
    activeUploads -= 1;
    throw error;
  });
  if (reservation.kind === "missing") {
    activeUploads -= 1;
    res.status(404).json({ error: "Valid upload grant not found" });
    return;
  }
  if (reservation.kind === "applicationMissing") {
    activeUploads -= 1;
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (reservation.kind === "accepted") {
    activeUploads -= 1;
    res.status(409).json({ error: "Accepted applications cannot be edited" });
    return;
  }
  if (reservation.kind === "sizeMismatch") {
    activeUploads -= 1;
    res.status(413).json({ error: "Upload size must exactly match the granted document size" });
    return;
  }
  if (reservation.kind === "typeMismatch") {
    activeUploads -= 1;
    res.status(415).json({ error: "Upload content type does not match the grant" });
    return;
  }

  try {
    await storage.uploadObjectEntity(
      reservation.grant.objectPath,
      req,
      reservation.grant.contentType,
      reservation.grant.size,
      MAX_DOCUMENT_SIZE,
      UPLOAD_RESERVATION_TTL_MS,
    );
    const [completed] = await db.update(uploadGrantsTable).set({
      status: "completed",
      expiresAt: new Date(Date.now() + COMPLETED_UPLOAD_TTL_MS),
    }).where(and(
      eq(uploadGrantsTable.id, reservation.grant.id),
      eq(uploadGrantsTable.ownerId, ownerId),
      eq(uploadGrantsTable.status, "uploading"),
      gt(uploadGrantsTable.expiresAt, new Date()),
    )).returning();
    if (!completed) {
      await deleteGrantedObject(reservation.grant.objectPath);
      res.status(410).json({ error: "Upload grant expired before completion" });
      return;
    }
    res.status(204).end();
  } catch (error) {
    await db.update(uploadGrantsTable).set({
      status: "cleaning",
      expiresAt: new Date(),
    }).where(and(
      eq(uploadGrantsTable.id, reservation.grant.id),
      eq(uploadGrantsTable.ownerId, ownerId),
      eq(uploadGrantsTable.status, "uploading"),
    ));
    if (error instanceof ObjectUploadSizeError) {
      res.status(413).json({ error: error.message });
      return;
    }
    if (error instanceof ObjectUploadTimeoutError) {
      res.status(408).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    activeUploads -= 1;
  }
  },
);

export default router;