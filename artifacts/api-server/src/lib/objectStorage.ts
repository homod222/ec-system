import { randomUUID } from "crypto";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
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

export class ObjectUploadSizeError extends Error {
  constructor() {
    super("Uploaded object size does not match the upload grant");
    this.name = "ObjectUploadSizeError";
  }
}

export class ObjectUploadTimeoutError extends Error {
  constructor() {
    super("Upload timed out");
    this.name = "ObjectUploadTimeoutError";
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

  createObjectEntityPath(): string {
    return `/objects/uploads/${randomUUID()}`;
  }

  async uploadObjectEntity(
    objectPath: string,
    source: Readable,
    contentType: string,
    expectedSize: number,
    maxSize: number,
    timeoutMs: number,
  ): Promise<void> {
    let totalSize = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalSize += chunk.byteLength;
        if (totalSize > expectedSize || totalSize > maxSize) {
          callback(new ObjectUploadSizeError());
          return;
        }
        callback(null, chunk);
      },
    });
    const destination = this.objectEntityFile(objectPath).createWriteStream({
      resumable: false,
      metadata: { contentType },
      validation: "crc32c",
    });
    const timeout = setTimeout(() => {
      limiter.destroy(new ObjectUploadTimeoutError());
    }, timeoutMs);
    timeout.unref();
    try {
      await pipeline(source, limiter, destination);
      if (totalSize !== expectedSize) {
        throw new ObjectUploadSizeError();
      }
    } catch (error) {
      try {
        await this.deleteObject(this.objectEntityFile(objectPath));
      } catch {
        // Preserve the upload failure; periodic grant cleanup retries deletion.
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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
    const file = this.objectEntityFile(objectPath);
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

  private objectEntityFile(objectPath: string): File {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId) throw new ObjectNotFoundError();
    const { bucketName, objectName } = this.privateObjectLocation(entityId);
    return objectStorageClient.bucket(bucketName).file(objectName);
  }
}

function parseObjectPath(path: string) {
  const parts = path.replace(/^\//, "").split("/");
  if (parts.length < 2) throw new Error("Invalid object storage path");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}
