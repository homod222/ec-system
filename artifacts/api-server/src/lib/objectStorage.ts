import { randomUUID } from "crypto";
import { Readable } from "stream";
import { File, Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const allowedDocumentContentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isAllowedDocumentContentType(contentType: string): boolean {
  return allowedDocumentContentTypes.has(contentType.toLowerCase());
}

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

export class ObjectStorageService {
  getPrivateObjectDir(): string {
    const directory = process.env.PRIVATE_OBJECT_DIR || "";
    if (!directory) {
      throw new Error("PRIVATE_OBJECT_DIR not set. Create a bucket in Object Storage first.");
    }
    return directory;
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const { bucketName, objectName } = this.privateObjectLocation(`uploads/${randomUUID()}`);
    return signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 300 });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    const url = new URL(rawPath);
    if (url.hostname !== "storage.googleapis.com") {
      throw new Error("Unexpected object storage upload URL");
    }
    const { bucketName, objectName } = this.privateObjectLocation("");
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const prefix = objectName ? `${bucketName}/${objectName}/` : `${bucketName}/`;
    if (!path.startsWith(prefix)) {
      throw new Error("Upload URL is outside the private object directory");
    }
    return `/objects/${path.slice(prefix.length)}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId) throw new ObjectNotFoundError();
    const { bucketName, objectName } = this.privateObjectLocation(entityId);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async downloadObject(file: File, cacheTtlSec = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) headers["Content-Length"] = String(metadata.size);
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream, { headers });
  }

  async getObjectMetadata(file: File): Promise<{ size: number; contentType: string }> {
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Object storage returned an invalid object size");
    }
    return {
      size,
      contentType: String(metadata.contentType || "").toLowerCase(),
    };
  }

  async deleteObject(file: File): Promise<void> {
    await file.delete({ ignoreNotFound: true });
  }

  privateObjectLocation(entityId: string) {
    const { bucketName, objectName } = parseObjectPath(this.getPrivateObjectDir());
    return {
      bucketName,
      objectName: [objectName.replace(/\/+$/, ""), entityId.replace(/^\/+/, "")]
        .filter(Boolean)
        .join("/"),
    };
  }
}

function parseObjectPath(path: string) {
  const parts = path.replace(/^\//, "").split("/");
  if (parts.length < 2) throw new Error("Invalid object storage path");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

async function signObjectURL({
  bucketName, objectName, method, ttlSec,
}: { bucketName: string; objectName: string; method: "PUT"; ttlSec: number }): Promise<string> {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName, object_name: objectName, method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Failed to sign object URL (${response.status})`);
  const { signed_url } = await response.json() as { signed_url: string };
  return signed_url;
}