import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const storageObjects = vi.hoisted(() => new Map<string, { size: number; contentType: string }>());

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: { role: "owner" },
  }),
  clerkClient: {
    users: {
      getUser: vi.fn(async () => ({
        publicMetadata: { role: "owner" },
        privateMetadata: {},
        emailAddresses: [{
          emailAddress: "integration@example.test",
          verification: { status: "verified" },
        }],
      })),
    },
  },
}));

vi.mock("../src/middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../src/lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}

  class ObjectStorageService {
    createObjectEntityPath() {
      const objectPath = `/objects/uploads/${randomUUID()}`;
      storageObjects.set(objectPath, { size: 12, contentType: "application/pdf" });
      return objectPath;
    }

    async uploadObjectEntity(
      objectPath: string,
      _source: unknown,
      contentType: string,
      expectedSize: number,
    ) {
      storageObjects.set(objectPath, { size: expectedSize, contentType });
    }

    async getObjectEntityUploadURL() {
      const id = randomUUID();
      const objectPath = `/objects/uploads/${id}`;
      storageObjects.set(objectPath, { size: 12, contentType: "application/pdf" });
      return `https://storage.test/private/uploads/${id}`;
    }

    normalizeObjectEntityPath(uploadUrl: string) {
      return `/objects/uploads/${uploadUrl.split("/").at(-1)}`;
    }

    async getObjectEntityFile(objectPath: string) {
      if (!storageObjects.has(objectPath)) throw new ObjectNotFoundError();
      return { objectPath };
    }

    async getObjectMetadata(file: { objectPath: string }) {
      const metadata = storageObjects.get(file.objectPath);
      if (!metadata) throw new ObjectNotFoundError();
      return metadata;
    }

    async downloadObject(file: { objectPath: string }) {
      if (!storageObjects.has(file.objectPath)) throw new ObjectNotFoundError();
      return new Response("test document", {
        headers: { "Content-Type": "application/pdf" },
      });
    }

    async deleteObject(file: { objectPath: string }) {
      storageObjects.delete(file.objectPath);
    }
  }

  return {
    ObjectNotFoundError,
    ObjectStorageService,
    isAllowedDocumentContentType: (value: string) =>
      ["application/pdf", "image/jpeg", "image/png"].includes(value),
  };
});

const ownerA = `integration-owner-a-${randomUUID()}`;
const ownerB = `integration-owner-b-${randomUUID()}`;
const auth = (owner: string) => ({ "x-test-user": owner });

let app: Awaited<typeof import("../src/app")>["default"];
let pool: Awaited<typeof import("@workspace/db")>["pool"];

const applicationInput = {
  firstName: "ليان",
  lastName: "الاختبار",
  gender: "female",
  birthDate: "2021-05-10",
  level: "تمهيدي",
  notes: "طلب اختبار تكامل",
  guardianName: "ولي الاختبار",
  guardianPhone: "0500000000",
  guardianEmail: "integration@example.test",
};

beforeAll(async () => {
  process.env.CLERK_SECRET_KEY ||= "test-secret";
  process.env.CLERK_PUBLISHABLE_KEY ||= "pk_test_placeholder";
  ({ default: app } = await import("../src/app"));
  ({ pool } = await import("@workspace/db"));
});

afterAll(async () => {
  const owners = [ownerA, ownerB];
  await pool.query(
    `delete from application_documents
       where application_id in (select id from applications where owner_id = any($1::text[]))`,
    [owners],
  );
  for (const query of [
    "delete from upload_grants where owner_id = any($1::text[])",
    "delete from activities where owner_id = any($1::text[])",
    "delete from applications where owner_id = any($1::text[])",
    "delete from children where owner_id = any($1::text[])",
    "delete from guardians where owner_id = any($1::text[])",
  ]) {
    await pool.query(query, [owners]);
  }
  await pool.end();
});

describe.sequential("application registration regression flow", () => {
  it("creates, edits, uploads, reviews and accepts an application, then renews the active child", async () => {
    const created = await request(app)
      .post("/api/applications")
      .set(auth(ownerA))
      .send(applicationInput)
      .expect(201);
    const applicationId = created.body.id as number;
    expect(created.body).toMatchObject({ status: "new", type: "new", documents: [] });

    await request(app)
      .patch(`/api/applications/${applicationId}`)
      .set(auth(ownerA))
      .send({ notes: "تم تعديل الطلب" })
      .expect(200)
      .expect(({ body }) => expect(body.notes).toBe("تم تعديل الطلب"));

    const upload = await request(app)
      .post("/api/storage/uploads/request-url")
      .set(auth(ownerA))
      .send({
        applicationId,
        name: "birth-certificate.pdf",
        size: 12,
        contentType: "application/pdf",
      })
      .expect(200);
    await request(app)
      .put(upload.body.uploadUrl)
      .set(auth(ownerA))
      .set("content-type", "application/pdf")
      .set("content-length", "12")
      .send(Buffer.from("test content"))
      .expect(204);

    const document = await request(app)
      .post(`/api/applications/${applicationId}/documents`)
      .set(auth(ownerA))
      .send({
        name: "birth-certificate.pdf",
        size: 12,
        contentType: "application/pdf",
        objectPath: upload.body.objectPath,
      })
      .expect(201);

    await request(app)
      .patch(`/api/applications/${applicationId}/status`)
      .set(auth(ownerA))
      .send({ status: "reviewing" })
      .expect(200);

    const accepted = await request(app)
      .post(`/api/applications/${applicationId}/accept`)
      .set(auth(ownerA))
      .expect(200);
    const childId = accepted.body.childId as number;
    expect(accepted.body.status).toBe("accepted");

    const children = await request(app).get("/api/children").set(auth(ownerA)).expect(200);
    expect(children.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: childId, status: "active", fullName: "ليان الاختبار" }),
    ]));

    await request(app)
      .get(`/api/applications/${applicationId}/documents/${document.body.id}/content`)
      .set(auth(ownerA))
      .expect(200)
      .expect("Content-Type", /application\/octet-stream/);

    const renewal = await request(app)
      .post(`/api/children/${childId}/renewals`)
      .set(auth(ownerA))
      .expect(201);
    expect(renewal.body).toMatchObject({ type: "renewal", status: "new", sourceChildId: childId });

    await request(app)
      .patch(`/api/applications/${renewal.body.id}/status`)
      .set(auth(ownerA))
      .send({ status: "reviewing" })
      .expect(200);

    const acceptedRenewal = await request(app)
      .post(`/api/applications/${renewal.body.id}/accept`)
      .set(auth(ownerA))
      .expect(200);
    expect(acceptedRenewal.body).toMatchObject({
      type: "renewal",
      status: "accepted",
      childId,
      sourceChildId: childId,
    });
  });

  it("isolates applications, children and documents and returns 404/409 for invalid operations", async () => {
    const created = await request(app)
      .post("/api/applications")
      .set(auth(ownerA))
      .send({ ...applicationInput, firstName: "عزل" })
      .expect(201);

    const upload = await request(app)
      .post("/api/storage/uploads/request-url")
      .set(auth(ownerA))
      .send({
        applicationId: created.body.id,
        name: "isolation.pdf",
        size: 12,
        contentType: "application/pdf",
      })
      .expect(200);
    await request(app)
      .put(upload.body.uploadUrl)
      .set(auth(ownerA))
      .set("content-type", "application/pdf")
      .set("content-length", "12")
      .send(Buffer.from("test content"))
      .expect(204);
    const document = await request(app)
      .post(`/api/applications/${created.body.id}/documents`)
      .set(auth(ownerA))
      .send({
        name: "isolation.pdf",
        size: 12,
        contentType: "application/pdf",
        objectPath: upload.body.objectPath,
      })
      .expect(201);

    await request(app).get(`/api/applications/${created.body.id}`).set(auth(ownerB)).expect(404);
    await request(app)
      .patch(`/api/applications/${created.body.id}`)
      .set(auth(ownerB))
      .send({ notes: "اختراق" })
      .expect(404);
    await request(app)
      .post("/api/storage/uploads/request-url")
      .set(auth(ownerB))
      .send({
        applicationId: created.body.id,
        name: "isolation.pdf",
        size: 12,
        contentType: "application/pdf",
      })
      .expect(404);
    await request(app)
      .get(`/api/applications/${created.body.id}/documents/${document.body.id}/content`)
      .set(auth(ownerB))
      .expect(404);
    await request(app).get("/api/children").set(auth(ownerB)).expect(200, []);

    await request(app)
      .post(`/api/applications/${created.body.id}/accept`)
      .set(auth(ownerA))
      .expect(409);
    await request(app)
      .patch(`/api/applications/${created.body.id}/status`)
      .set(auth(ownerA))
      .send({ status: "new" })
      .expect(409);

    await request(app)
      .patch(`/api/applications/${created.body.id}/status`)
      .set(auth(ownerA))
      .send({ status: "reviewing" })
      .expect(200);
    await request(app)
      .patch(`/api/applications/${created.body.id}/status`)
      .set(auth(ownerA))
      .send({ status: "new" })
      .expect(409);

    await request(app).get("/api/applications/2147483647").set(auth(ownerA)).expect(404);
    await request(app).post("/api/children/2147483647/renewals").set(auth(ownerA)).expect(404);
  });
});