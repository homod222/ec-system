import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AttachSiteGalleryItemBody,
  AttachSiteGalleryItemResponse,
  DeleteSiteGalleryItemParams,
  GetPublicSiteSettingsResponse,
  GetPublicSiteGalleryImageParams,
  ListPublicSiteGalleryResponse,
  ListSiteGalleryResponse,
  RequestSiteGalleryUploadUrlBody,
  RequestSiteGalleryUploadUrlResponse,
  UpdateSiteGalleryItemBody,
  UpdateSiteGalleryItemParams,
  UpdateSiteGalleryItemResponse,
} from "@workspace/api-zod";
import { db, nurserySettingsTable, siteGalleryItemsTable, uploadGrantsTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  auditNurseryOperation,
  nurseryContext,
  permitted,
  requireNurseryPermission,
  resolveNurseryContext,
} from "./nurseryOperations";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_GALLERY_SIZE = 10 * 1024 * 1024;
const GALLERY_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const GRANT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REGISTRATION_WHATSAPP = "96590916677";

async function hasImageSignature(file: Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>, contentType: string): Promise<boolean> {
  const response = await storage.downloadObject(file, 0);
  if (!response.body) return false;
  const reader = response.body.getReader();
  try {
    const chunks: number[] = [];
    while (chunks.length < 12) {
      const { value, done } = await reader.read();
      if (value) chunks.push(...value.slice(0, 12 - chunks.length));
      if (done) break;
    }
    const bytes = Uint8Array.from(chunks);
    if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (contentType === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
    return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function serialize(row: typeof siteGalleryItemsTable.$inferSelect) {
  const { ownerId: _ownerId, ...item } = row;
  return { ...item, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

router.get("/public/site-gallery", async (_req, res): Promise<void> => {
  const ownerId = process.env.PUBLIC_SITE_OWNER_ID?.trim();
  if (!ownerId) {
    res.json(ListPublicSiteGalleryResponse.parse([]));
    return;
  }
  const rows = await db.select({
    id: siteGalleryItemsTable.id,
    title: siteGalleryItemsTable.title,
    altText: siteGalleryItemsTable.altText,
  }).from(siteGalleryItemsTable).where(and(
    eq(siteGalleryItemsTable.ownerId, ownerId),
    eq(siteGalleryItemsTable.status, "published"),
  )).orderBy(asc(siteGalleryItemsTable.sortOrder), asc(siteGalleryItemsTable.createdAt));
  res.json(ListPublicSiteGalleryResponse.parse(rows.map((row) => ({
    ...row,
    imageUrl: `/api/public/site-gallery/${row.id}/image`,
  }))));
});

router.get("/public/site-settings", async (_req, res): Promise<void> => {
  const ownerId = process.env.PUBLIC_SITE_OWNER_ID?.trim();
  if (!ownerId) {
    res.json(GetPublicSiteSettingsResponse.parse({
      registrationWhatsApp: DEFAULT_REGISTRATION_WHATSAPP,
    }));
    return;
  }
  const [settings] = await db.select({
    registrationWhatsApp: nurserySettingsTable.registrationWhatsApp,
  }).from(nurserySettingsTable).where(eq(nurserySettingsTable.ownerId, ownerId)).limit(1);
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(GetPublicSiteSettingsResponse.parse({
    registrationWhatsApp: settings?.registrationWhatsApp ?? DEFAULT_REGISTRATION_WHATSAPP,
  }));
});

router.get("/public/site-gallery/:id/image", async (req, res): Promise<void> => {
  const params = GetPublicSiteGalleryImageParams.safeParse(req.params);
  const ownerId = process.env.PUBLIC_SITE_OWNER_ID?.trim();
  if (!params.success || !ownerId) {
    res.status(404).json({ error: "Published image not found" });
    return;
  }
  const [item] = await db.select().from(siteGalleryItemsTable).where(and(
    eq(siteGalleryItemsTable.id, params.data.id),
    eq(siteGalleryItemsTable.ownerId, ownerId),
    eq(siteGalleryItemsTable.status, "published"),
  ));
  if (!item) {
    res.status(404).json({ error: "Published image not found" });
    return;
  }
  try {
    const response = await storage.downloadObject(await storage.getObjectEntityFile(item.objectPath), 300);
    res.setHeader("Content-Type", item.contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!response.body) return void res.end();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Published image not found" });
      return;
    }
    throw error;
  }
});

router.get("/site-gallery", resolveNurseryContext, requireNurseryPermission("read:site-gallery"), async (req, res) => {
  const rows = await db.select().from(siteGalleryItemsTable).where(
    eq(siteGalleryItemsTable.ownerId, nurseryContext(req).ownerId),
  ).orderBy(asc(siteGalleryItemsTable.sortOrder), asc(siteGalleryItemsTable.createdAt));
  await auditNurseryOperation(req, "read", "site-gallery", null, null, { count: rows.length });
  res.json(ListSiteGalleryResponse.parse(rows.map(serialize)));
});

router.get("/site-gallery/:id/image", resolveNurseryContext, requireNurseryPermission("read:site-gallery"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return void res.status(404).json({ error: "Gallery image not found" });
  const [item] = await db.select().from(siteGalleryItemsTable).where(and(
    eq(siteGalleryItemsTable.id, id),
    eq(siteGalleryItemsTable.ownerId, nurseryContext(req).ownerId),
  ));
  if (!item) return void res.status(404).json({ error: "Gallery image not found" });
  try {
    const response = await storage.downloadObject(await storage.getObjectEntityFile(item.objectPath), 60);
    await auditNurseryOperation(req, "read-image", "site-gallery", String(item.id), null, null);
    res.setHeader("Content-Type", item.contentType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!response.body) return void res.end();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return void res.status(404).json({ error: "Gallery image not found" });
    throw error;
  }
});

router.post("/site-gallery/uploads/request-url", resolveNurseryContext, requireNurseryPermission("create:site-gallery"), async (req, res): Promise<void> => {
  const body = RequestSiteGalleryUploadUrlBody.safeParse(req.body);
  if (!body.success || !Number.isSafeInteger(body.data?.size) || body.data.size > MAX_GALLERY_SIZE) {
    res.status(400).json({ error: body.success ? "Image size must be between 1 byte and 10 MiB" : body.error.message });
    return;
  }
  const contentType = body.data.contentType.toLowerCase();
  if (!GALLERY_TYPES.has(contentType)) {
    res.status(415).json({ error: "Only JPEG, PNG, and WebP images are supported" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const objectPath = storage.createObjectEntityPath();
  const [grant] = await db.insert(uploadGrantsTable).values({
    ownerId,
    applicationId: null,
    targetType: "site-gallery",
    targetId: null,
    objectPath,
    originalName: body.data.name,
    contentType,
    size: body.data.size,
    status: "issued",
    expiresAt: new Date(Date.now() + GRANT_TTL_MS),
  }).returning({ id: uploadGrantsTable.id });
  await auditNurseryOperation(req, "request-upload", "site-gallery", null, null, {
    contentType, size: body.data.size,
  });
  res.json(RequestSiteGalleryUploadUrlResponse.parse({
    uploadUrl: `/api/storage/uploads/${grant.id}/content`,
    objectPath,
  }));
});

router.post("/site-gallery", resolveNurseryContext, requireNurseryPermission("create:site-gallery"), async (req, res): Promise<void> => {
  const body = AttachSiteGalleryItemBody.safeParse(req.body);
  if (!body.success || !Number.isSafeInteger(body.data?.size) || !Number.isSafeInteger(body.data?.sortOrder)) {
    res.status(400).json({ error: body.success ? "Size and order must be whole numbers" : body.error.message });
    return;
  }
  const { ownerId, actorId } = nurseryContext(req);
  const file = await storage.getObjectEntityFile(body.data.objectPath).catch(() => null);
  if (!file) {
    res.status(404).json({ error: "Completed gallery upload not found" });
    return;
  }
  const metadata = await storage.getObjectMetadata(file);
  if (metadata.size !== body.data.size || metadata.contentType !== body.data.contentType) {
    res.status(400).json({ error: "Stored image metadata does not match the upload grant" });
    return;
  }
  if (!await hasImageSignature(file, body.data.contentType)) {
    res.status(415).json({ error: "Stored object does not match the declared image type" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from upload_grants where object_path = ${body.data.objectPath} and owner_id = ${ownerId} for update`);
    const [grant] = await tx.select().from(uploadGrantsTable).where(and(
      eq(uploadGrantsTable.objectPath, body.data.objectPath),
      eq(uploadGrantsTable.ownerId, ownerId),
      eq(uploadGrantsTable.targetType, "site-gallery"),
      isNull(uploadGrantsTable.targetId),
      isNull(uploadGrantsTable.applicationId),
      eq(uploadGrantsTable.contentType, body.data.contentType),
      eq(uploadGrantsTable.size, body.data.size),
      eq(uploadGrantsTable.status, "completed"),
      isNull(uploadGrantsTable.consumedAt),
      gt(uploadGrantsTable.expiresAt, new Date()),
    ));
    if (!grant) return null;
    const [created] = await tx.insert(siteGalleryItemsTable).values({
      ownerId, createdBy: actorId, title: body.data.title, altText: body.data.altText,
      objectPath: body.data.objectPath, contentType: body.data.contentType,
      size: body.data.size, sortOrder: body.data.sortOrder, status: "draft",
    }).returning();
    const [consumed] = await tx.update(uploadGrantsTable).set({
      status: "consumed", consumedAt: new Date(), targetId: created.id,
    }).where(and(eq(uploadGrantsTable.id, grant.id), eq(uploadGrantsTable.status, "completed"))).returning();
    if (!consumed) throw new Error("Gallery upload grant was consumed concurrently");
    return created;
  });
  if (!result) {
    res.status(404).json({ error: "Valid completed gallery upload grant not found" });
    return;
  }
  await auditNurseryOperation(req, "create", "site-gallery", String(result.id), null, result as unknown as Record<string, unknown>);
  res.status(201).json(AttachSiteGalleryItemResponse.parse(serialize(result)));
});

router.patch("/site-gallery/:id", resolveNurseryContext, async (req, res): Promise<void> => {
  const params = UpdateSiteGalleryItemParams.safeParse(req.params);
  const body = UpdateSiteGalleryItemBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(body.data).length === 0 ||
      (body.success && body.data.sortOrder !== undefined && !Number.isSafeInteger(body.data.sortOrder))) {
    res.status(400).json({ error: params.success && body.success ? "At least one valid field is required" : params.success ? body.error?.message : params.error.message });
    return;
  }
  const changesMetadata = body.data.title !== undefined || body.data.altText !== undefined;
  if ((changesMetadata && !await permitted(req, "update:site-gallery")) ||
      (body.data.sortOrder !== undefined && !await permitted(req, "reorder:site-gallery")) ||
      (body.data.status !== undefined && !await permitted(req, "publish:site-gallery"))) {
    res.status(403).json({ error: "Operation not permitted" });
    return;
  }
  const { ownerId } = nurseryContext(req);
  const [before] = await db.select().from(siteGalleryItemsTable).where(and(
    eq(siteGalleryItemsTable.id, params.data.id), eq(siteGalleryItemsTable.ownerId, ownerId),
  ));
  if (!before) return void res.status(404).json({ error: "Gallery item not found" });
  if (before.status === "deleting") return void res.status(409).json({ error: "Gallery item is pending deletion" });
  const [updated] = await db.update(siteGalleryItemsTable).set({ ...body.data, updatedAt: new Date() }).where(and(
    eq(siteGalleryItemsTable.id, before.id), eq(siteGalleryItemsTable.ownerId, ownerId),
  )).returning();
  await auditNurseryOperation(req, body.data.status !== undefined ? "publish" : body.data.sortOrder !== undefined ? "reorder" : "update", "site-gallery", String(updated.id),
    before as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  res.json(UpdateSiteGalleryItemResponse.parse(serialize(updated)));
});

router.delete("/site-gallery/:id", resolveNurseryContext, requireNurseryPermission("delete:site-gallery"), async (req, res): Promise<void> => {
  const params = DeleteSiteGalleryItemParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: params.error.message });
  const { ownerId } = nurseryContext(req);
  const [deleting] = await db.update(siteGalleryItemsTable).set({ status: "deleting", updatedAt: new Date() }).where(and(
    eq(siteGalleryItemsTable.id, params.data.id), eq(siteGalleryItemsTable.ownerId, ownerId),
  )).returning();
  if (!deleting) return void res.status(404).json({ error: "Gallery item not found" });
  try {
    await storage.deleteObject(await storage.getObjectEntityFile(deleting.objectPath));
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) {
      res.status(503).json({ error: "Image deletion is pending; retry this delete request" });
      return;
    }
  }
  await db.delete(siteGalleryItemsTable).where(and(eq(siteGalleryItemsTable.id, deleting.id), eq(siteGalleryItemsTable.ownerId, ownerId)));
  await auditNurseryOperation(req, "delete", "site-gallery", String(deleting.id), deleting as unknown as Record<string, unknown>, null);
  res.status(204).end();
});

export default router;