import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const storageObjects = vi.hoisted(() => new Map<string, { size: number; contentType: string }>());

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: { role: req.headers["x-test-role"] ?? "owner" },
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
const parentA = `integration-parent-a-${randomUUID()}`;
const parentB = `integration-parent-b-${randomUUID()}`;
const legacyStaffName = `legacy-staff-${randomUUID()}`;
const auth = (owner: string, role = "owner") => ({
  "x-test-user": owner,
  "x-test-role": role,
});

let app: Awaited<typeof import("../src/app")>["default"];
let pool: Awaited<typeof import("@workspace/db")>["pool"];

async function createLegacyInvoice(ownerId: string, suffix: string) {
  const guardian = await pool.query<{ id: number }>(
    `insert into guardians (owner_id, name, phone)
     values ($1, $2, '0000000000') returning id`,
    [ownerId, `invoice-guardian-${suffix}`],
  );
  const child = await pool.query<{ id: number }>(
    `insert into children
       (owner_id, first_name, last_name, gender, birth_date, guardian_id, level)
     values ($1, 'Invoice', $2, 'female', '2021-01-01', $3, 'test') returning id`,
    [ownerId, suffix, guardian.rows[0].id],
  );
  const invoice = await pool.query<{ id: number; invoice_number: string }>(
    `insert into invoices
       (owner_id, invoice_number, guardian_id, child_id, amount, due_date, status)
     values ('__legacy__', $1, $2, $3, 25, '2026-12-31', 'pending')
     returning id, invoice_number`,
    [`integration-invoice-${suffix}`, guardian.rows[0].id, child.rows[0].id],
  );
  return {
    ...invoice.rows[0],
    guardianId: guardian.rows[0].id,
    childId: child.rows[0].id,
  };
}

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
  process.env.REPLIT_DEV_DOMAIN ||= "integration.test";
  ({ default: app } = await import("../src/app"));
  ({ pool } = await import("@workspace/db"));
});

afterAll(async () => {
  const owners = [ownerA, ownerB];
  await pool.query(
    "delete from staff where owner_id = '__legacy__' and name = $1",
    [legacyStaffName],
  );
  await pool.query(
    `delete from application_documents
       where application_id in (select id from applications where owner_id = any($1::text[]))`,
    [owners],
  );
  await pool.query(
    "delete from invoices where owner_id = any($1::text[]) or invoice_number like 'integration-invoice-%'",
    [owners],
  );
  await pool.query(
    `delete from attendance
       where child_id in (select id from children where owner_id = any($1::text[]))`,
    [owners],
  );
  for (const query of [
    "delete from audit_logs where owner_id = any($1::text[])",
    "delete from role_permissions where owner_id = any($1::text[])",
    "delete from operational_records where owner_id = any($1::text[])",
    "delete from upload_grants where owner_id = any($1::text[])",
    "delete from activities where owner_id = any($1::text[])",
    "delete from progress_reports where owner_id = any($1::text[])",
    "delete from child_activities where owner_id = any($1::text[])",
    "delete from parent_messages where owner_id = any($1::text[])",
    "delete from applications where owner_id = any($1::text[])",
    "delete from children where owner_id = any($1::text[])",
    "delete from classrooms where owner_id = any($1::text[])",
    "delete from guardians where owner_id = any($1::text[])",
  ]) {
    await pool.query(query, [owners]);
  }
  await pool.end();
});

describe.sequential("application registration regression flow", () => {
  it("enforces operational role permissions and owner isolation", async () => {
    const insertedStaff = await pool.query<{ id: number }>(
      "insert into staff (owner_id, name, role, phone) values ('__legacy__', $1, 'teacher', '0000000000') returning id",
      [legacyStaffName],
    );
    for (const owner of [ownerA, ownerB]) {
      const legacyStaff = await request(app).get("/api/staff").set(auth(owner)).expect(200);
      expect(legacyStaff.body).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: legacyStaffName }),
      ]));
      await request(app)
        .post("/api/staff-attendance")
        .set(auth(owner))
        .send({
          staffId: insertedStaff.rows[0].id,
          date: "2026-08-26",
          status: "present",
        })
        .expect(404);
    }

    const invoiceA = await createLegacyInvoice(ownerA, `a-${randomUUID()}`);
    const invoiceB = await createLegacyInvoice(ownerB, `b-${randomUUID()}`);
    await pool.query("update guardians set clerk_user_id = $1 where id = $2", [parentA, invoiceA.guardianId]);
    await pool.query("update guardians set clerk_user_id = $1 where id = $2", [parentB, invoiceB.guardianId]);
    const leakToken = `cross-tenant-${randomUUID()}`;
    const classroom = await pool.query<{ id: number }>(
      `insert into classrooms (owner_id, name, level, teacher_name, capacity)
       values ($1, $2, 'test', 'teacher', 10) returning id`,
      [ownerA, leakToken],
    );
    const mismatchedChild = await pool.query<{ id: number }>(
      `insert into children
         (owner_id, first_name, last_name, gender, birth_date, guardian_id, classroom_id, level)
       values ($1, $2, 'hidden', 'female', '2021-01-01', $3, $4, 'test') returning id`,
      [ownerA, leakToken, invoiceB.guardianId, classroom.rows[0].id],
    );
    await pool.query(
      "insert into attendance (child_id, date, status, note) values ($1, '2026-08-26', 'present', $2)",
      [mismatchedChild.rows[0].id, leakToken],
    );
    await pool.query(
      `insert into progress_reports (owner_id, child_id, title, summary, period, educator_name)
       values ($1, $2, $3, $3, 'test', 'teacher')`,
      [ownerA, mismatchedChild.rows[0].id, leakToken],
    );
    await pool.query(
      `insert into child_activities (owner_id, child_id, category, title, description, educator_name)
       values ($1, $2, 'test', $3, $3, 'teacher')`,
      [ownerA, mismatchedChild.rows[0].id, leakToken],
    );
    await pool.query(
      `insert into parent_messages
         (owner_id, guardian_id, sender_type, sender_name, subject, content, read)
       values ($1, $2, 'staff', 'staff', $3, $3, false)`,
      [ownerA, invoiceB.guardianId, leakToken],
    );
    const inconsistentInvoice = await pool.query<{ id: number; invoice_number: string }>(
      `insert into invoices
         (owner_id, invoice_number, guardian_id, child_id, amount, due_date, status)
       values ('__legacy__', $1, $2, $3, 25, '2026-12-31', 'pending')
       returning id, invoice_number`,
      [`integration-invoice-inconsistent-${randomUUID()}`, invoiceB.guardianId, invoiceA.childId],
    );
    const { runApplicationMigrations } = await import("../src/lib/applicationMigrations");
    await runApplicationMigrations();
    const migratedInvoices = await pool.query<{ id: number; owner_id: string }>(
      "select id, owner_id from invoices where id = any($1::int[]) order by id",
      [[invoiceA.id, invoiceB.id]],
    );
    expect(migratedInvoices.rows).toEqual([
      { id: invoiceA.id, owner_id: ownerA },
      { id: invoiceB.id, owner_id: ownerB },
    ]);
    const quarantinedInvoice = await pool.query<{ owner_id: string }>(
      "select owner_id from invoices where id = $1",
      [inconsistentInvoice.rows[0].id],
    );
    expect(quarantinedInvoice.rows[0].owner_id).toBe("__legacy__");
    const ownerAInvoices = await request(app).get("/api/invoices").set(auth(ownerA)).expect(200);
    expect(ownerAInvoices.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceNumber: invoiceA.invoice_number }),
    ]));
    expect(ownerAInvoices.body).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceNumber: invoiceB.invoice_number }),
    ]));
    const ownerBInvoices = await request(app).get("/api/invoices").set(auth(ownerB)).expect(200);
    expect(ownerBInvoices.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceNumber: invoiceB.invoice_number }),
    ]));
    expect(ownerBInvoices.body).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceNumber: invoiceA.invoice_number }),
    ]));
    for (const owner of [ownerA, ownerB]) {
      expect(
        (owner === ownerA ? ownerAInvoices.body : ownerBInvoices.body)
          .some(({ invoiceNumber }: { invoiceNumber: string }) =>
            invoiceNumber === inconsistentInvoice.rows[0].invoice_number),
      ).toBe(false);
      await request(app)
        .post(`/api/invoices/${inconsistentInvoice.rows[0].id}/reminder`)
        .set(auth(owner))
        .expect(404);
    }
    for (const owner of [ownerA, ownerB]) {
      await request(app)
        .get("/api/dashboard/summary")
        .set(auth(owner))
        .expect(200)
        .expect(({ body }) => expect(body.pendingPayments).toBe(25));
      await request(app)
        .get("/api/finance/summary")
        .set(auth(owner))
        .expect(200)
        .expect(({ body }) => expect(body.outstanding).toBe(25));
    }
    for (const [parent, ownInvoice] of [[parentA, invoiceA], [parentB, invoiceB]] as const) {
      await request(app)
        .get("/api/parent/overview")
        .set(auth(parent, "parent"))
        .expect(200)
        .expect(({ body }) => {
          expect(body.outstandingBalance).toBe(25);
          expect(body.unreadMessages).toBe(0);
          expect(JSON.stringify(body)).not.toContain(leakToken);
        });
      await request(app)
        .get("/api/parent/invoices")
        .set(auth(parent, "parent"))
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual(expect.arrayContaining([
            expect.objectContaining({ invoiceNumber: ownInvoice.invoice_number }),
          ]));
          expect(body).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ invoiceNumber: inconsistentInvoice.rows[0].invoice_number }),
          ]));
        });
      await request(app)
        .post(`/api/parent/invoices/${inconsistentInvoice.rows[0].id}/checkout-session`)
        .set(auth(parent, "parent"))
        .send({ returnUrl: `https://${process.env.REPLIT_DEV_DOMAIN}/parent/invoices` })
        .expect(404);
      for (const path of [
        "/api/parent/children",
        "/api/parent/attendance",
        "/api/parent/progress-reports",
        "/api/parent/activities",
        "/api/parent/messages",
      ]) {
        await request(app)
          .get(path)
          .set(auth(parent, "parent"))
          .expect(200)
          .expect(({ body }) => expect(JSON.stringify(body)).not.toContain(leakToken));
      }
      for (const path of [
        "/api/parent/attendance",
        "/api/parent/progress-reports",
        "/api/parent/activities",
      ]) {
        await request(app)
          .get(`${path}?childId=${mismatchedChild.rows[0].id}`)
          .set(auth(parent, "parent"))
          .expect(404);
      }
    }
    await request(app)
      .post(`/api/invoices/${invoiceA.id}/reminder`)
      .set(auth(ownerB))
      .expect(404);

    const title = `integration-expense-${randomUUID()}`;
    await request(app)
      .post("/api/operations/expense")
      .set(auth(ownerA))
      .send({ title, status: "approved", amount: 25 })
      .expect(201);

    await request(app)
      .get("/api/operations/expense")
      .set(auth(ownerB))
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));

    await request(app)
      .get("/api/operations/expense")
      .set(auth(ownerA, "teacher"))
      .expect(403);

    await request(app)
      .get("/api/operations/expense")
      .set(auth(ownerA, "accountant"))
      .expect(200)
      .expect(({ body }) => expect(body.some((row: { title: string }) => row.title === title)).toBe(true));

    await request(app)
      .get("/api/operations/curriculum")
      .set(auth(ownerA, "teacher"))
      .expect(200);

    await request(app)
      .get("/api/permissions")
      .set(auth(ownerA, "teacher"))
      .expect(403);

    await request(app)
      .get("/api/finance/summary")
      .set(auth(ownerA, "staff"))
      .expect(403);

    await request(app)
      .get("/api/finance/summary")
      .set(auth(ownerA, "accountant"))
      .expect(200);

    for (const role of ["teacher", "accountant", "receptionist"]) {
      await request(app)
        .get("/api/session/context")
        .set(auth(ownerA, role))
        .expect(200)
        .expect(({ body }) => expect(body.role).toBe("admin"));
    }

    await request(app)
      .get("/api/children")
      .set(auth(ownerA, "receptionist"))
      .expect(200);

    await request(app)
      .put("/api/permissions")
      .set(auth(ownerA))
      .send({ role: "manager", operation: "read:invoice", allowed: false })
      .expect(200);

    await request(app)
      .get("/api/invoices")
      .set(auth(ownerA, "manager"))
      .expect(403);

    const protectedApplication = await request(app)
      .post("/api/applications")
      .set(auth(ownerA))
      .send({ ...applicationInput, firstName: "صلاحيات" })
      .expect(201);

    await request(app)
      .patch(`/api/applications/${protectedApplication.body.id}`)
      .set(auth(ownerA, "staff"))
      .send({ notes: "يجب ألا يحفظ" })
      .expect(403);

    await request(app)
      .post("/api/applications")
      .set(auth(ownerA, "receptionist"))
      .send({ ...applicationInput, firstName: "استقبال" })
      .expect(201);

    await request(app)
      .put("/api/permissions")
      .set(auth(ownerA))
      .send({ role: "manager", operation: "write:application", allowed: false })
      .expect(200);

    await request(app)
      .patch(`/api/applications/${protectedApplication.body.id}`)
      .set(auth(ownerA, "manager"))
      .send({ notes: "منع مخصص" })
      .expect(403);

    await request(app)
      .put("/api/permissions")
      .set(auth(ownerA))
      .send({ role: "manager", operation: "accept:application", allowed: false })
      .expect(200);

    await request(app)
      .post(`/api/applications/${protectedApplication.body.id}/accept`)
      .set(auth(ownerA, "manager"))
      .expect(403);
  });

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

    const auditResult = await pool.query<{
      actor_id: string;
      owner_id: string;
      operation: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>(
      `select actor_id, owner_id, operation, before, after
         from audit_logs
        where entity_type = 'application' and entity_id = $1
        order by id`,
      [String(applicationId)],
    );
    expect(auditResult.rows.map((row) => row.operation)).toEqual([
      "create", "update", "update-status", "accept",
    ]);
    expect(auditResult.rows.every((row) => row.actor_id === ownerA && row.owner_id === ownerA)).toBe(true);
    expect(auditResult.rows[1]).toMatchObject({
      before: expect.objectContaining({ status: "new" }),
      after: expect.objectContaining({ status: "new" }),
    });
    expect(auditResult.rows[2]).toMatchObject({
      before: expect.objectContaining({ status: "new" }),
      after: expect.objectContaining({ status: "reviewing" }),
    });
    expect(auditResult.rows[3]).toMatchObject({
      before: expect.objectContaining({ status: "reviewing" }),
      after: expect.objectContaining({ status: "accepted", childId }),
    });
    const otherOwnerAudit = await request(app).get("/api/audit-logs").set(auth(ownerB)).expect(200);
    expect(otherOwnerAudit.body).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "application", entityId: String(applicationId) }),
    ]));

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
    await request(app)
      .get("/api/children")
      .set(auth(ownerB))
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ firstName: "عزل" }),
        ]));
      });

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