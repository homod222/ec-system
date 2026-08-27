import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const storageObjects = vi.hoisted(() => new Map<string, { size: number; contentType: string }>());
const stripeSessions = vi.hoisted(() => new Map<string, Record<string, any>>());
const stripeSessionCreate = vi.hoisted(() => vi.fn(async (input: Record<string, any>) => {
  const id = `cs_test_${stripeSessions.size + 1}`;
  const session = { id, status: "open", url: `https://checkout.stripe.test/${id}`, metadata: input.metadata };
  stripeSessions.set(id, session);
  return session;
}));

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

vi.mock("../src/lib/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    products: {
      search: async () => ({ data: [{ id: "prod_nursery_test" }] }),
      create: async () => ({ id: "prod_nursery_test" }),
    },
    checkout: {
      sessions: {
        create: stripeSessionCreate,
        retrieve: async (id: string) => stripeSessions.get(id) ?? { id, status: "expired" },
        expire: async (id: string) => {
          const session = stripeSessions.get(id);
          if (session) session.status = "expired";
          return session;
        },
      },
    },
  }),
}));

vi.mock("../src/lib/exchangeRates", () => {
  class ExchangeRateUnavailableError extends Error {}
  const rate = { rate: 3.25, fetchedAt: new Date("2026-08-27T00:00:00Z"), sourceUpdatedAt: new Date("2026-08-27T00:00:00Z") };
  return {
    EXCHANGE_RATE_LOCK_ID: 1_263_555_172,
    ExchangeRateUnavailableError,
    getCurrentKwdToUsdRate: async () => rate,
    getStoredFreshKwdToUsdRate: async () => rate,
  };
});

vi.mock("../src/lib/notifications", () => ({
  sendPaymentConfirmation: vi.fn(async () => undefined),
  sendInvoiceReminder: vi.fn(async () => ({ status: "skipped", message: "test" })),
  sendParentMessageNotification: vi.fn(async () => undefined),
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
const operationsParent = `integration-parent-operations-${randomUUID()}`;
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
     values ($1, $2, $3) returning id`,
    [ownerId, `invoice-guardian-${suffix}`, `legacy-${suffix}`],
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
  const { runApplicationMigrations } = await import("../src/lib/applicationMigrations");
  await runApplicationMigrations();
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
    "delete from invoice_receipts where owner_id = any($1::text[])",
    "delete from invoice_refunds where owner_id = any($1::text[])",
    "delete from invoice_payments where owner_id = any($1::text[])",
    "delete from invoice_lines where owner_id = any($1::text[])",
    "delete from child_contacts where owner_id = any($1::text[])",
    "delete from nursery_settings where owner_id = any($1::text[])",
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
  it("backfills legacy paid invoices into the settled ledger idempotently", async () => {
    const cash = await createLegacyInvoice(ownerA, `paid-cash-${randomUUID()}`);
    const stripe = await createLegacyInvoice(ownerA, `paid-stripe-${randomUUID()}`);
    await pool.query(
      `update invoices
       set status = 'paid', paid_at = '2026-08-01T09:00:00Z',
           payment_method = 'cash', payment_reference = 'CASH-LEGACY'
       where id = $1`,
      [cash.id],
    );
    await pool.query(
      `update invoices
       set status = 'paid', paid_at = '2026-08-02T09:00:00Z',
           payment_method = 'payment_link', payment_reference = 'pi_legacy_paid',
           stripe_payment_intent_id = 'pi_legacy_paid'
       where id = $1`,
      [stripe.id],
    );
    const { runApplicationMigrations } = await import("../src/lib/applicationMigrations");
    await runApplicationMigrations();
    await runApplicationMigrations();

    const ledger = await pool.query<{
      invoice_id: number; owner_id: string; method: string; amount: number;
      reference: string; status: string;
    }>(
      `select invoice_id, owner_id, method, amount::float8 as amount, reference, status
       from invoice_payments where invoice_id = any($1::int[]) order by invoice_id`,
      [[cash.id, stripe.id]],
    );
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invoice_id: cash.id, owner_id: ownerA, method: "cash",
        amount: 25, reference: "CASH-LEGACY", status: "completed",
      }),
      expect.objectContaining({
        invoice_id: stripe.id, owner_id: ownerA, method: "payment_link",
        amount: 25, reference: "pi_legacy_paid", status: "completed",
      }),
    ]));
    for (const invoiceId of [cash.id, stripe.id]) {
      await request(app).get(`/api/invoices/${invoiceId}`).set(auth(ownerA)).expect(200)
        .expect(({ body }) => expect(body).toMatchObject({ paidAmount: 25, balance: 0, status: "paid" }));
      await request(app).post(`/api/invoices/${invoiceId}/checkout-session`).set(auth(ownerA))
        .send({ returnUrl: `https://${process.env.REPLIT_DEV_DOMAIN}/nursery-management/finance` }).expect(409);
    }
    await request(app).get("/api/reports?domain=financial").set(auth(ownerA)).expect(200)
      .expect(({ body }) => {
        for (const invoiceId of [cash.id, stripe.id]) {
          expect(body.records).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: invoiceId, data: expect.objectContaining({ paidAmount: 25 }) }),
          ]));
        }
      });
    await request(app).get("/api/finance/summary").set(auth(ownerA)).expect(200)
      .expect(({ body }) => expect(body.collectedThisMonth).toBeGreaterThanOrEqual(50));
  });

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

  it("runs the internal dossier, invoice, payment, attendance, report and parent visibility flow", async () => {
    const created = await request(app).post("/api/applications").set(auth(ownerB))
      .send({ ...applicationInput, firstName: "تشغيل", guardianEmail: "operations@example.test" }).expect(201);
    const upload = await request(app).post("/api/storage/uploads/request-url").set(auth(ownerB)).send({
      applicationId: created.body.id, name: "operations.pdf", size: 12, contentType: "application/pdf",
    }).expect(200);
    await request(app).put(upload.body.uploadUrl).set(auth(ownerB))
      .set("content-type", "application/pdf").set("content-length", "12")
      .send(Buffer.from("test content")).expect(204);
    await request(app).post(`/api/applications/${created.body.id}/documents`).set(auth(ownerB)).send({
      name: "operations.pdf", size: 12, contentType: "application/pdf", objectPath: upload.body.objectPath,
    }).expect(201);
    await request(app).patch(`/api/applications/${created.body.id}/status`).set(auth(ownerB))
      .send({ status: "reviewing" }).expect(200);
    const accepted = await request(app).post(`/api/applications/${created.body.id}/accept`)
      .set(auth(ownerB)).expect(200);
    const childId = accepted.body.childId as number;
    const repeated = await request(app).post(`/api/applications/${created.body.id}/accept`)
      .set(auth(ownerB)).expect(200);
    expect(repeated.body.childId).toBe(childId);
    const sharedApplications = await Promise.all(["أ", "ب"].map((suffix) => request(app)
      .post("/api/applications").set(auth(ownerB)).send({
        ...applicationInput, firstName: `تزامن${suffix}`, guardianEmail: "shared-guardian@example.test",
      }).expect(201)));
    await Promise.all(sharedApplications.map((application) => request(app)
      .patch(`/api/applications/${application.body.id}/status`).set(auth(ownerB)).send({ status: "reviewing" }).expect(200)));
    const sharedAccepted = await Promise.all(sharedApplications.map((application) => request(app)
      .post(`/api/applications/${application.body.id}/accept`).set(auth(ownerB)).expect(200)));
    const sharedGuardianIds = await pool.query<{ guardian_id: number }>(
      "select guardian_id from children where id = any($1::int[])",
      [sharedAccepted.map((application) => application.body.childId)],
    );
    expect(new Set(sharedGuardianIds.rows.map((row) => row.guardian_id)).size).toBe(1);

    await request(app).post(`/api/children/${childId}/contacts`).set(auth(ownerB)).send({
      type: "authorized_pickup", name: "المستلم", relationship: "uncle", identityNumber: "CID-10",
    }).expect(201);
    await request(app).get(`/api/children/${childId}/contacts`).set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "authorized_pickup", identityNumber: "CID-10" }),
      ])));
    const operationsGuardian = await pool.query<{ id: number }>("select guardian_id as id from children where id = $1", [childId]);
    await pool.query("update guardians set clerk_user_id = $1 where id = $2", [operationsParent, operationsGuardian.rows[0].id]);

    const invoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "issued",
      lines: [
        { type: "fee", description: "Tuition", quantity: 1, unitAmount: 100 },
        { type: "addon", description: "Meals", quantity: 1, unitAmount: 20 },
        { type: "discount", description: "Sibling discount", quantity: 1, unitAmount: 10 },
      ],
    }).expect(201);
    expect(invoice.body).toMatchObject({ amount: 110, balance: 110, status: "issued" });
    const receipt = await request(app).post(`/api/invoices/${invoice.body.id}/payments`)
      .set(auth(ownerB)).send({ method: "cash", amount: 110, reference: "CASH-10" }).expect(201);
    const stripeInvoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "issued",
      lines: [{ type: "fee", description: "Stripe reconciliation", quantity: 1, unitAmount: 45 }],
    }).expect(201);
    await pool.query(
      `insert into invoice_payments
        (owner_id, invoice_id, method, amount, currency, status, reference, recorded_by)
       values ($1, $2, 'payment_link', 45, 'KWD', 'succeeded', 'pi_legacy_test', 'Stripe')`,
      [ownerB, stripeInvoice.body.id],
    );
    await pool.query(
      "update invoices set status = 'paid', payment_method = 'payment_link', payment_reference = 'pi_legacy_test' where id = $1",
      [stripeInvoice.body.id],
    );
    await request(app).get(`/api/invoices/${stripeInvoice.body.id}`).set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ paidAmount: 45, refundedAmount: 0, balance: 0, status: "paid" }));
    await request(app).get("/api/reports?domain=financial").set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body.records).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: stripeInvoice.body.id, data: expect.objectContaining({ paidAmount: 45 }) }),
      ])));
    await request(app).post(`/api/invoices/${stripeInvoice.body.id}/payments`).set(auth(ownerB))
      .send({ method: "cash", amount: 45 }).expect(409);
    await request(app).post(`/api/invoices/${stripeInvoice.body.id}/refunds`).set(auth(ownerB))
      .send({ amount: 10, reason: "Stripe refund regression" }).expect(201);
    await request(app).get(`/api/invoices/${stripeInvoice.body.id}`).set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ paidAmount: 45, refundedAmount: 10, balance: 10, status: "partial" }));
    const draftInvoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "draft",
      lines: [{ type: "fee", description: "Draft checkout", quantity: 1, unitAmount: 25 }],
    }).expect(201);
    const adminReturnUrl = `https://${process.env.REPLIT_DEV_DOMAIN}/nursery-management/finance`;
    const parentReturnUrl = `https://${process.env.REPLIT_DEV_DOMAIN}/nursery-management/parent/invoices`;
    await request(app).post(`/api/invoices/${draftInvoice.body.id}/checkout-session`).set(auth(ownerB))
      .send({ returnUrl: adminReturnUrl }).expect(409);
    await request(app).post(`/api/parent/invoices/${draftInvoice.body.id}/checkout-session`).set(auth(operationsParent, "parent"))
      .send({ returnUrl: parentReturnUrl }).expect(409);
    const cancelledCheckoutInvoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "issued",
      lines: [{ type: "fee", description: "Cancelled checkout", quantity: 1, unitAmount: 25 }],
    }).expect(201);
    await request(app).post(`/api/invoices/${cancelledCheckoutInvoice.body.id}/cancel`).set(auth(ownerB))
      .send({ reason: "Do not collect" }).expect(200);
    await request(app).post(`/api/invoices/${cancelledCheckoutInvoice.body.id}/checkout-session`).set(auth(ownerB))
      .send({ returnUrl: adminReturnUrl }).expect(409);
    const partialCheckoutInvoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "issued",
      lines: [{ type: "fee", description: "Partial checkout", quantity: 1, unitAmount: 100 }],
    }).expect(201);
    await request(app).post(`/api/invoices/${partialCheckoutInvoice.body.id}/payments`).set(auth(ownerB))
      .send({ method: "cash", amount: 30 }).expect(201);
    await request(app).post(`/api/invoices/${partialCheckoutInvoice.body.id}/checkout-session`).set(auth(ownerB))
      .send({ returnUrl: adminReturnUrl }).expect(200);
    const checkoutInput = stripeSessionCreate.mock.calls.at(-1)?.[0] as any;
    expect(checkoutInput.line_items[0].price_data.unit_amount).toBe(22_750);
    expect(checkoutInput.metadata.settlementAmountKwd).toBe("70");
    const { reconcileInvoicePayment } = await import("../src/lib/paymentReconciliation");
    const paymentIntent = {
      id: "pi_partial_checkout_test",
      metadata: checkoutInput.payment_intent_data.metadata,
      amount_received: 22_750,
      amount: 22_750,
      currency: "usd",
    };
    const settlementEvent = Buffer.from(JSON.stringify({
      type: "payment_intent.succeeded", data: { object: paymentIntent },
    }));
    await reconcileInvoicePayment(settlementEvent);
    await reconcileInvoicePayment(settlementEvent);
    await request(app).get(`/api/invoices/${partialCheckoutInvoice.body.id}`).set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ paidAmount: 100, balance: 0, status: "paid" }));
    const stripeSettlementRows = await pool.query<{ count: string }>(
      "select count(*)::text as count from invoice_payments where invoice_id = $1 and reference = $2",
      [partialCheckoutInvoice.body.id, paymentIntent.id],
    );
    expect(Number(stripeSettlementRows.rows[0].count)).toBe(1);
    const concurrentInvoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "issued",
      lines: [{ type: "fee", description: "Concurrent balance", quantity: 1, unitAmount: 100 }],
    }).expect(201);
    const concurrentPayments = await Promise.all([1, 2].map(() => request(app)
      .post(`/api/invoices/${concurrentInvoice.body.id}/payments`).set(auth(ownerB))
      .send({ method: "cash", amount: 60 })));
    expect(concurrentPayments.map((response) => response.status).sort()).toEqual([201, 409]);
    const concurrentRefunds = await Promise.all([1, 2].map(() => request(app)
      .post(`/api/invoices/${concurrentInvoice.body.id}/refunds`).set(auth(ownerB))
      .send({ amount: 40, reason: "Concurrency test" })));
    expect(concurrentRefunds.map((response) => response.status).sort()).toEqual([201, 409]);
    const paymentRefundInvoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "issued",
      lines: [{ type: "fee", description: "Payment refund race", quantity: 1, unitAmount: 100 }],
    }).expect(201);
    await request(app).post(`/api/invoices/${paymentRefundInvoice.body.id}/payments`).set(auth(ownerB))
      .send({ method: "cash", amount: 30 }).expect(201);
    const paymentRefundRace = await Promise.all([
      request(app).post(`/api/invoices/${paymentRefundInvoice.body.id}/payments`).set(auth(ownerB))
        .send({ method: "cash", amount: 50 }),
      request(app).post(`/api/invoices/${paymentRefundInvoice.body.id}/refunds`).set(auth(ownerB))
        .send({ amount: 30, reason: "Race refund" }),
    ]);
    expect(paymentRefundRace.map((response) => response.status).sort()).toEqual([201, 201]);
    await request(app).get(`/api/invoices/${paymentRefundInvoice.body.id}`).set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ paidAmount: 80, refundedAmount: 30, balance: 50, status: "partial" }));
    const cancellationInvoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "issued",
      lines: [{ type: "fee", description: "Cancel race", quantity: 1, unitAmount: 50 }],
    }).expect(201);
    const [cancelled, racedPayment] = await Promise.all([
      request(app).post(`/api/invoices/${cancellationInvoice.body.id}/cancel`).set(auth(ownerB)).send({ reason: "Void" }),
      request(app).post(`/api/invoices/${cancellationInvoice.body.id}/payments`).set(auth(ownerB)).send({ method: "cash", amount: 50 }),
    ]);
    expect([cancelled.status, racedPayment.status].sort()).toEqual([200, 409]);

    await request(app).post("/api/attendance").set(auth(ownerB)).send({
      childId, date: "2026-08-31", status: "present", checkOut: "13:00", pickupIdentity: "NOT-AUTHORIZED",
    }).expect(403);
    await request(app).post("/api/attendance").set(auth(ownerB)).send({
      childId, date: "2026-09-01", status: "present", checkIn: "07:30",
      checkOut: "13:00", pickupName: "المستلم", pickupIdentity: "CID-10",
    }).expect(201);
    await request(app).post("/api/attendance").set(auth(ownerB)).send({
      childId, date: "2026-09-01", status: "late", checkIn: "08:10",
      correctionReason: "تصحيح وقت الوصول",
    }).expect(201);
    await request(app).get(`/api/attendance/history?childId=${childId}&dateFrom=2026-09-01&dateTo=2026-09-01`)
      .set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body[0]).toMatchObject({ status: "late", correctionReason: "تصحيح وقت الوصول" }));
    await request(app).get("/api/reports?domain=financial").set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body.totalAmount).toBeGreaterThanOrEqual(110));

    const parentDocuments = await request(app).get("/api/parent/documents").set(auth(operationsParent, "parent")).expect(200);
    expect(parentDocuments.body).toEqual(expect.arrayContaining([expect.objectContaining({ name: "operations.pdf" })]));
    expect(parentDocuments.body[0].objectPath).toBeUndefined();
    await request(app).get(`/api/parent/documents/${parentDocuments.body[0].id}/content`)
      .set(auth(operationsParent, "parent")).expect(200).expect("Content-Type", /application\/octet-stream/);
    await request(app).get("/api/parent/receipts").set(auth(operationsParent, "parent")).expect(200)
      .expect(({ body }) => expect(body).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: receipt.body.id, amount: 110 }),
      ])));

    await request(app).post("/api/invoices").set(auth(ownerB, "teacher")).send({
      childId, dueDate: "2026-12-31",
      lines: [{ type: "fee", description: "Denied", quantity: 1, unitAmount: 1 }],
    }).expect(403);
    await request(app).get(`/api/children/${childId}/contacts`).set(auth(ownerA)).expect(404);
  });
});