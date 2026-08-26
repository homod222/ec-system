import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { applicationsTable, db, uploadGrantsTable } from "@workspace/db";
import { isAllowedDocumentContentType, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const UPLOAD_GRANT_TTL_MS = 5 * 60 * 1000;

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

router.post("/storage/uploads/request-url", requireAuth, async (req, res): Promise<void> => {
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
  const ownerId = getAuth(req).userId!;
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
  const uploadUrl = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadUrl);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from applications where id = ${parsed.data.applicationId} and owner_id = ${ownerId} for update`);
    const [application] = await tx.select().from(applicationsTable).where(and(
      eq(applicationsTable.id, parsed.data.applicationId),
      eq(applicationsTable.ownerId, ownerId),
    ));
    if (!application) return "missing" as const;
    if (application.status === "accepted") return "accepted" as const;
    await tx.insert(uploadGrantsTable).values({
      objectPath,
      ownerId,
      applicationId: application.id,
      originalName: parsed.data.name,
      contentType,
      size: parsed.data.size,
      expiresAt: new Date(Date.now() + UPLOAD_GRANT_TTL_MS),
    });
    return "created" as const;
  });
  if (result === "missing") {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (result === "accepted") {
    res.status(409).json({ error: "Accepted applications cannot be edited" });
    return;
  }
  res.json(RequestUploadUrlResponse.parse({ uploadUrl, objectPath }));
});

export default router;