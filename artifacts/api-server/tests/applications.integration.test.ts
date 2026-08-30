import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import request from "supertest";

const storageObjects = vi.hoisted(() => new Map<string, { size: number; contentType: string; bytes: Uint8Array }>());
const failDeleteOnce = vi.hoisted(() => new Set<string>());
const stripeSessions = vi.hoisted(() => new Map<string, Record<string, any>>());
const stripeSessionCreate = vi.hoisted(() => vi.fn(async (input: Record<string, any>) => {
  const id = `cs_test_${stripeSessions.size + 1}`;
  const session = { id, status: "open", url: `https://checkout.stripe.test/${id}`, metadata: input.metadata };
  stripeSessions.set(id, session);
  return session;
}));
const clerkFixtures = vi.hoisted(() => ({
  ownerA: `integration-owner-a-${Math.random().toString(36).slice(2)}`,
  ownerB: `integration-owner-b-${Math.random().toString(36).slice(2)}`,
  legacyOwner: `integration-legacy-owner-${Math.random().toString(36).slice(2)}`,
  staffA: `integration-staff-a-${Math.random().toString(36).slice(2)}`,
  staffB: `integration-staff-b-${Math.random().toString(36).slice(2)}`,
}));
const clerkUsers = vi.hoisted(() => new Map<string, Record<string, any>>());
const clerkCreateUser = vi.hoisted(() => vi.fn(async (input: Record<string, any>) => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  const id = `integration-created-staff-${Math.random().toString(36).slice(2)}`;
  const user = {
    id,
    firstName: input.firstName,
    lastName: input.lastName,
    publicMetadata: { ...input.publicMetadata },
    privateMetadata: { ...input.privateMetadata },
    emailAddresses: (input.emailAddress ?? []).map((emailAddress: string) => ({
      emailAddress,
      verification: { status: "verified" },
    })),
  };
  clerkUsers.set(id, user);
  return user;
}));
const clerkSignInTokenCreate = vi.hoisted(() => vi.fn(async ({ userId }: { userId: string }) => ({
  token: `ticket-for-${userId}`,
})));
const whatsappMessages = vi.hoisted(() => [] as Array<{ to: string; body: string }>);

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: { role: req.headers["x-test-role"] ?? "owner" },
  }),
  clerkClient: {
    signInTokens: {
      createSignInToken: clerkSignInTokenCreate,
    },
    users: {
      getUser: vi.fn(async (userId: string) => {
        const users = {
          [clerkFixtures.ownerA]: { id: clerkFixtures.ownerA, publicMetadata: { role: "owner" }, firstName: "Owner", lastName: "A", emailAddresses: [] },
          [clerkFixtures.ownerB]: { id: clerkFixtures.ownerB, publicMetadata: { role: "owner" }, firstName: "Owner", lastName: "B", emailAddresses: [] },
          [clerkFixtures.legacyOwner]: {
            id: clerkFixtures.legacyOwner,
            publicMetadata: { role: "owner", accountStatus: "legacy" },
            privateMetadata: {},
            firstName: "Legacy",
            lastName: "Owner",
            emailAddresses: [],
          },
          [clerkFixtures.staffA]: { id: clerkFixtures.staffA, publicMetadata: { ownerId: clerkFixtures.ownerA, role: "Teacher" }, firstName: "Tenant", lastName: "A", emailAddresses: [] },
          [clerkFixtures.staffB]: { id: clerkFixtures.staffB, publicMetadata: { owner_id: clerkFixtures.ownerB, role: "Manager" }, emailAddresses: [{ emailAddress: "tenant-b@example.test" }] },
        };
        return clerkUsers.get(userId) ?? users[userId as keyof typeof users] ?? {
          id: userId, publicMetadata: { role: "owner" }, privateMetadata: {},
          emailAddresses: [{ emailAddress: "integration@example.test", verification: { status: "verified" } }],
        };
      }),
      createUser: clerkCreateUser,
      updateUserMetadata: vi.fn(async (
        userId: string,
        input: { publicMetadata?: Record<string, unknown>; privateMetadata?: Record<string, unknown> },
      ) => {
        const current = clerkUsers.get(userId) ?? {
          id: userId,
          publicMetadata: {},
          privateMetadata: {},
          emailAddresses: [],
        };
        const updated = {
          ...current,
          publicMetadata: input.publicMetadata ?? current.publicMetadata,
          privateMetadata: input.privateMetadata ?? current.privateMetadata,
        };
        clerkUsers.set(userId, updated);
        return updated;
      }),
      getUserList: vi.fn(async ({ limit = 100, offset = 0 }: { limit?: number; offset?: number }) => {
        const data = [
          { id: clerkFixtures.ownerA, publicMetadata: { role: "owner" }, firstName: "Owner", lastName: "A" },
          { id: clerkFixtures.ownerB, publicMetadata: { role: "owner" }, firstName: "Owner", lastName: "B" },
          { id: clerkFixtures.staffA, publicMetadata: { ownerId: clerkFixtures.ownerA, role: "Teacher" }, firstName: "Tenant", lastName: "A" },
          { id: clerkFixtures.staffB, publicMetadata: { owner_id: clerkFixtures.ownerB, role: "Manager" }, emailAddresses: [{ emailAddress: "tenant-b@example.test" }] },
        ];
        return { data: data.slice(offset, offset + limit), totalCount: data.length };
      }),
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
  sendWhatsAppText: vi.fn(async (to: string, body: string) => {
    whatsappMessages.push({ to, body });
    return { ok: true };
  }),
  sendPaymentConfirmation: vi.fn(async () => undefined),
  sendInvoiceReminder: vi.fn(async () => ({ status: "skipped", message: "test" })),
  sendParentMessageNotification: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}

  class ObjectStorageService {
    createObjectEntityPath() {
      const objectPath = `/objects/uploads/${randomUUID()}`;
      storageObjects.set(objectPath, { size: 12, contentType: "application/pdf", bytes: new Uint8Array() });
      return objectPath;
    }

    async uploadObjectEntity(
      objectPath: string,
      source: AsyncIterable<Uint8Array>,
      contentType: string,
      expectedSize: number,
    ) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of source) chunks.push(chunk);
      storageObjects.set(objectPath, { size: expectedSize, contentType, bytes: Buffer.concat(chunks) });
    }

    async getObjectEntityUploadURL() {
      const id = randomUUID();
      const objectPath = `/objects/uploads/${id}`;
      storageObjects.set(objectPath, { size: 12, contentType: "application/pdf", bytes: new Uint8Array() });
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
      const metadata = storageObjects.get(file.objectPath)!;
      return new Response(metadata.bytes, {
        headers: { "Content-Type": metadata.contentType },
      });
    }

    async deleteObject(file: { objectPath: string }) {
      if (failDeleteOnce.delete(file.objectPath)) throw new Error("temporary storage failure");
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

const ownerA = clerkFixtures.ownerA;
const ownerB = clerkFixtures.ownerB;
const staffA = clerkFixtures.staffA;
const staffB = clerkFixtures.staffB;
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

function staffOtpDigest(staffId: number, otp: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(`${staffId}:${otp}`)
    .digest("hex");
}

function readPdfInfoValue(bytes: Uint8Array, key: string) {
  const source = Buffer.from(bytes).toString("latin1");
  const infoReference = /\/Info\s+(\d+)\s+0\s+R/.exec(source);
  expect(infoReference, "PDF trailer must reference an Info dictionary").not.toBeNull();
  const infoObject = new RegExp(`${infoReference![1]}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*endobj`).exec(source);
  expect(infoObject, "PDF Info dictionary must be readable").not.toBeNull();
  const valueReference = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(infoObject![1]);
  expect(valueReference, `PDF Info dictionary must contain ${key}`).not.toBeNull();
  const valueObject = new RegExp(`${valueReference![1]}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*endobj`).exec(source);
  expect(valueObject, `PDF ${key} object must be readable`).not.toBeNull();
  const value = valueObject![1].trim();
  if (value.startsWith("<") && value.endsWith(">")) {
    const raw = Buffer.from(value.slice(1, -1), "hex");
    if (raw[0] === 0xfe && raw[1] === 0xff) {
      const codeUnits = [];
      for (let index = 2; index < raw.length; index += 2) codeUnits.push(raw.readUInt16BE(index));
      return String.fromCharCode(...codeUnits);
    }
    return raw.toString("utf8");
  }
  expect(value.startsWith("(") && value.endsWith(")"), `PDF ${key} must be a string`).toBe(true);
  return value.slice(1, -1).replace(/\\([\\()])/g, "$1");
}

async function createStaffAccountFixture(input: {
  ownerId?: string;
  clerkUserId?: string | null;
  accountStatus?: string;
  otp?: string | null;
  email?: string;
}) {
  const result = await pool.query<{ id: number }>(
    `insert into staff
       (owner_id, name, role, email, phone, clerk_user_id, account_status, otp_expires_at)
     values ($1, $2, 'teacher', $3, $4, $5, $6, $7)
     returning id`,
    [
      input.ownerId ?? ownerA,
      `account-staff-${randomUUID()}`,
      input.email ?? `staff-${randomUUID()}@example.test`,
      `500${Math.floor(Math.random() * 10_000_000).toString().padStart(7, "0")}`,
      input.clerkUserId ?? null,
      input.accountStatus ?? "unlinked",
      input.otp ? new Date(Date.now() + 10 * 60 * 1000) : null,
    ],
  );
  const id = result.rows[0].id;
  if (input.otp) {
    await pool.query("update staff set otp_hash = $1, otp_attempts = 0 where id = $2", [
      staffOtpDigest(id, input.otp),
      id,
    ]);
  }
  return id;
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
    "delete from phone_otp_challenges where clerk_user_id = any($1::text[]) or requested_by = any($1::text[])",
    [owners],
  );
  await pool.query(
    "delete from phone_login_identities where clerk_user_id = any($1::text[])",
    [owners],
  );
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
    "delete from staff_attendance where owner_id = any($1::text[])",
    "delete from invoice_receipts where owner_id = any($1::text[])",
    "delete from invoice_refunds where owner_id = any($1::text[])",
    "delete from invoice_payments where owner_id = any($1::text[])",
    "delete from invoice_lines where owner_id = any($1::text[])",
    "delete from child_contacts where owner_id = any($1::text[])",
    "delete from nursery_settings where owner_id = any($1::text[])",
    "delete from audit_logs where owner_id = any($1::text[])",
    "delete from site_gallery_items where owner_id = any($1::text[])",
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
    "delete from staff where owner_id = any($1::text[])",
  ]) {
    await pool.query(query, [owners]);
  }
  await pool.end();
});

describe.sequential("application registration regression flow", () => {
  it("atomically enforces the phone OTP request limit under concurrency", async () => {
    const localPhone = `5${Math.floor(1_000_000 + Math.random() * 9_000_000)}`;
    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      request(app).post("/api/auth/phone/request").send({ phone: localPhone }),
    ));
    expect(responses.filter(response => response.status === 200)).toHaveLength(4);
    expect(responses.filter(response => response.status === 429)).toHaveLength(4);
    const challengeIds = responses
      .filter(response => response.status === 200)
      .map(response => response.body.challengeId);
    await pool.query("delete from phone_otp_challenges where id = any($1::text[])", [challengeIds]);
  });

  it("recognizes active staff and linked guardians without exposing full names", async () => {
    const staffClerkId = `phone-staff-${randomUUID()}`;
    const guardianClerkId = `phone-guardian-${randomUUID()}`;
    const staffPhone = `6${Math.floor(1_000_000 + Math.random() * 9_000_000)}`;
    const guardianPhone = `9${Math.floor(1_000_000 + Math.random() * 9_000_000)}`;
    await pool.query(
      `insert into staff (owner_id, name, role, email, phone, clerk_user_id, account_status)
       values ($1, 'أحمد الاختبار', 'teacher', $2, $3, $4, 'active')`,
      [ownerA, `phone-staff-${randomUUID()}@example.test`, staffPhone, staffClerkId],
    );
    await pool.query(
      `insert into guardians (owner_id, name, phone, clerk_user_id)
       values ($1, 'سارة الاختبار', $2, $3)`,
      [ownerA, `+965 ${guardianPhone.slice(0, 4)} ${guardianPhone.slice(4)}`, guardianClerkId],
    );

    const staffLogin = await request(app).post("/api/auth/phone/request").send({ phone: staffPhone }).expect(200);
    expect(staffLogin.body).toMatchObject({ recognized: true, firstName: "أحمد" });
    expect(whatsappMessages.at(-1)?.to).toBe(`965${staffPhone}`);

    const guardianLogin = await request(app).post("/api/auth/phone/request").send({ phone: guardianPhone }).expect(200);
    expect(guardianLogin.body).toMatchObject({ recognized: true, firstName: "سارة" });
    expect(whatsappMessages.at(-1)?.to).toBe(`965${guardianPhone}`);

    await pool.query("delete from phone_otp_challenges where id = any($1::text[])", [[
      staffLogin.body.challengeId,
      guardianLogin.body.challengeId,
    ]]);
  });

  it("enrolls an owner phone and issues a single-use WhatsApp login ticket with first-name greeting", async () => {
    const phone = "5000 8765";
    const enrollment = await request(app).post("/api/auth/phone/enrollment/request")
      .set(auth(ownerA)).send({ phone }).expect(200);
    expect(enrollment.body).toMatchObject({ recognized: true, firstName: "Owner" });
    const enrollmentMessage = whatsappMessages.at(-1);
    expect(enrollmentMessage?.to).toBe("96550008765");
    const enrollmentOtp = enrollmentMessage?.body.match(/\b\d{6}\b/)?.[0];
    expect(enrollmentOtp).toBeTruthy();

    await request(app).post("/api/auth/phone/enrollment/verify").set(auth(ownerA)).send({
      challengeId: enrollment.body.challengeId,
      otp: enrollmentOtp,
    }).expect(200).expect(({ body }) => {
      expect(body).toEqual({ enrolled: true, phone: "96550008765" });
    });

    const login = await request(app).post("/api/auth/phone/request").send({ phone: "+96550008765" }).expect(200);
    expect(login.body).toMatchObject({ recognized: true, firstName: "Owner" });
    expect(login.body.firstName).not.toContain(" ");
    const loginOtp = whatsappMessages.at(-1)?.body.match(/\b\d{6}\b/)?.[0];
    expect(loginOtp).toBeTruthy();

    const verified = await request(app).post("/api/auth/phone/verify").send({
      challengeId: login.body.challengeId,
      otp: loginOtp,
    }).expect(200);
    expect(verified.body).toEqual({ ticket: `ticket-for-${ownerA}` });
    expect(clerkSignInTokenCreate).toHaveBeenLastCalledWith({ userId: ownerA, expiresInSeconds: 60 });

    await request(app).post("/api/auth/phone/verify").send({
      challengeId: login.body.challengeId,
      otp: loginOtp,
    }).expect(400);
  });

  it("atomically caps concurrent invalid OTP attempts", async () => {
    const staffId = await createStaffAccountFixture({
      accountStatus: "pending_verification",
      otp: "123456",
    });

    const responses = await Promise.all(Array.from({ length: 6 }, () =>
      request(app)
        .post(`/api/staff/${staffId}/account/verify`)
        .send({ otp: "000000", password: "ValidPassword123!" }),
    ));

    expect(responses.filter(({ status }) => status === 400)).toHaveLength(4);
    expect(responses.filter(({ status }) => status === 429)).toHaveLength(2);
    const stored = await pool.query<{ otp_attempts: number }>(
      "select otp_attempts from staff where id = $1",
      [staffId],
    );
    expect(stored.rows[0].otp_attempts).toBe(5);
  });

  it("creates only one Clerk account for concurrent valid OTP verification", async () => {
    clerkCreateUser.mockClear();
    const staffId = await createStaffAccountFixture({
      accountStatus: "pending_verification",
      otp: "654321",
    });

    const responses = await Promise.all(Array.from({ length: 2 }, () =>
      request(app)
        .post(`/api/staff/${staffId}/account/verify`)
        .send({ otp: "654321", password: "ValidPassword123!" }),
    ));

    expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(responses.filter(({ status }) => [404, 409].includes(status))).toHaveLength(1);
    expect(clerkCreateUser).toHaveBeenCalledTimes(1);
    const stored = await pool.query<{ clerk_user_id: string | null; account_status: string }>(
      "select clerk_user_id, account_status from staff where id = $1",
      [staffId],
    );
    expect(stored.rows[0]).toMatchObject({
      clerk_user_id: expect.stringMatching(/^integration-created-staff-/),
      account_status: "active",
    });
  });

  it("restores a valid OTP after Clerk provisioning fails and succeeds on retry without duplicates", async () => {
    clerkCreateUser.mockClear();
    clerkCreateUser.mockRejectedValueOnce(new Error("Simulated Clerk provisioning failure"));
    const otp = "246810";
    const staffId = await createStaffAccountFixture({
      accountStatus: "pending_verification",
      otp,
    });

    const failed = await request(app)
      .post(`/api/staff/${staffId}/account/verify`)
      .send({ otp, password: "ValidPassword123!" });

    expect(failed.status).toBe(500);
    const restored = await pool.query<{
      account_status: string;
      clerk_user_id: string | null;
      otp_hash: string | null;
      otp_expires_at: Date | null;
      otp_attempts: number;
    }>(
      `select account_status, clerk_user_id, otp_hash, otp_expires_at, otp_attempts
         from staff where id = $1`,
      [staffId],
    );
    expect(restored.rows[0]).toMatchObject({
      account_status: "pending_verification",
      clerk_user_id: null,
      otp_hash: staffOtpDigest(staffId, otp),
      otp_attempts: 0,
    });
    expect(restored.rows[0].otp_expires_at?.getTime()).toBeGreaterThan(Date.now());

    const failedAudit = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from audit_logs
        where operation = 'verify-staff-account' and entity_id = $1`,
      [String(staffId)],
    );
    expect(failedAudit.rows[0].count).toBe("0");

    const retried = await request(app)
      .post(`/api/staff/${staffId}/account/verify`)
      .send({ otp, password: "ValidPassword123!" });

    expect(retried.status).toBe(200);
    expect(clerkCreateUser).toHaveBeenCalledTimes(2);
    const createdAccounts = [...clerkUsers.values()].filter(
      (user) => user.privateMetadata?.staffId === staffId,
    );
    expect(createdAccounts).toHaveLength(1);

    const activated = await pool.query<{ account_status: string; clerk_user_id: string | null }>(
      "select account_status, clerk_user_id from staff where id = $1",
      [staffId],
    );
    expect(activated.rows[0]).toMatchObject({
      account_status: "active",
      clerk_user_id: createdAccounts[0].id,
    });
    const successfulAudit = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from audit_logs
        where operation = 'verify-staff-account' and entity_id = $1`,
      [String(staffId)],
    );
    expect(successfulAudit.rows[0].count).toBe("1");
  });

  it("rejects relinking an active record or a Clerk user linked elsewhere", async () => {
    const activeUserId = `integration-linked-user-${randomUUID()}`;
    clerkUsers.set(activeUserId, {
      id: activeUserId,
      publicMetadata: { ownerId: ownerA, role: "teacher", accountStatus: "active" },
      privateMetadata: {},
      emailAddresses: [],
    });
    const activeStaffId = await createStaffAccountFixture({
      clerkUserId: activeUserId,
      accountStatus: "active",
    });
    const availableStaffId = await createStaffAccountFixture({});

    await request(app).post(`/api/staff/${activeStaffId}/account`).set(auth(ownerA)).send({
      mode: "link",
      clerkUserId: `integration-other-user-${randomUUID()}`,
      role: "teacher",
    }).expect(409);

    await request(app).post(`/api/staff/${availableStaffId}/account`).set(auth(ownerA)).send({
      mode: "link",
      clerkUserId: activeUserId,
      role: "teacher",
    }).expect(409);
  });

  it("revokes access immediately after disabling and unlinking a staff account", async () => {
    const userId = `integration-access-user-${randomUUID()}`;
    clerkUsers.set(userId, {
      id: userId,
      publicMetadata: { ownerId: ownerA, role: "teacher", accountStatus: "active" },
      privateMetadata: {},
      emailAddresses: [],
    });
    const staffId = await createStaffAccountFixture({
      clerkUserId: userId,
      accountStatus: "active",
    });

    await request(app).get("/api/dashboard/summary").set(auth(userId, "teacher")).expect(200);
    await request(app).patch(`/api/staff/${staffId}/account`).set(auth(ownerA)).send({
      status: "disabled",
    }).expect(200);
    await request(app).get("/api/dashboard/summary").set(auth(userId, "teacher")).expect(403);

    await request(app).patch(`/api/staff/${staffId}/account`).set(auth(ownerA)).send({
      status: "active",
    }).expect(200);
    await request(app).get("/api/dashboard/summary").set(auth(userId, "teacher")).expect(200);
    await request(app).patch(`/api/staff/${staffId}/account`).set(auth(ownerA)).send({
      status: "unlinked",
    }).expect(200);
    await request(app).get("/api/dashboard/summary").set(auth(userId, "teacher")).expect(403);
  });

  it("does not disable an owner because unrelated legacy metadata contains accountStatus", async () => {
    await request(app)
      .get("/api/permission-catalog")
      .set(auth(clerkFixtures.legacyOwner))
      .expect(200);
  });

  it("limits permission principals and overrides to the authenticated tenant", async () => {
    await request(app).get("/api/permission-principals").set(auth(ownerA)).expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([
          expect.objectContaining({ userId: ownerA, role: "owner" }),
          expect.objectContaining({ userId: staffA, role: "teacher", label: "Tenant A" }),
        ]));
        expect(body).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ userId: ownerB }),
          expect.objectContaining({ userId: staffB }),
        ]));
      });

    await request(app).put("/api/user-permissions/bulk").set(auth(ownerA)).send({
      userId: staffA,
      changes: [{ operation: "read:dashboard", allowed: false }],
    }).expect(200).expect(({ body }) => expect(body).toEqual([
      expect.objectContaining({ userId: staffA, allowed: false, effectiveAllowed: false }),
    ]));

    await request(app).put("/api/user-permissions/bulk").set(auth(ownerA)).send({
      userId: staffA,
      changes: [{ operation: "read:dashboard", allowed: null }],
    }).expect(200).expect(({ body }) => expect(body).toEqual([
      expect.objectContaining({ userId: staffA, allowed: null, effectiveAllowed: true }),
    ]));

    await request(app).put("/api/user-permissions/bulk").set(auth(ownerA)).send({
      userId: staffB,
      changes: [{ operation: "read:dashboard", allowed: true }],
    }).expect(404);

    await request(app).put("/api/permissions").set(auth(ownerA)).send({
      role: "admin", operation: "read:dashboard", allowed: false,
    }).expect(200);
    await request(app).put("/api/user-permissions/bulk").set(auth(ownerA)).send({
      userId: ownerA,
      changes: [{ operation: "read:dashboard", allowed: true }],
    }).expect(200);
    await request(app).put("/api/user-permissions/bulk").set(auth(ownerA)).send({
      userId: ownerA,
      changes: [{ operation: "read:dashboard", allowed: null }],
    }).expect(200).expect(({ body }) => expect(body).toEqual([
      expect.objectContaining({ userId: ownerA, allowed: null, effectiveAllowed: true }),
    ]));
  });

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
            expect.objectContaining({
              resource: "revenue",
              amount: 25,
              data: expect.objectContaining({ invoiceId }),
            }),
          ]));
        }
      });
    await request(app).get("/api/reports?domain=financial&dateTo=2000-01-01").set(auth(ownerA)).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ count: 0, totalAmount: 0, records: [] }));
    await request(app).get("/api/reports?domain=financial&dateFrom=01%2F01%2F2024").set(auth(ownerA)).expect(400);
    await request(app).get("/api/reports/export?domain=financial&format=pdf").set(auth(ownerA)).expect(200)
      .expect("Content-Type", /application\/pdf/)
      .expect("Content-Disposition", /nursery-report-financial-.*\.pdf/);
    await request(app).get("/api/reports/export?domain=financial&format=xlsx").set(auth(ownerA)).expect(200)
      .expect("Content-Type", /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/)
      .expect("Content-Disposition", /nursery-report-financial-.*\.xlsx/);
    await request(app).get("/api/reports/export?domain=financial&format=pdf")
      .set(auth(ownerA, "teacher")).expect(403);
    await request(app).get("/api/finance/summary").set(auth(ownerA)).expect(200)
      .expect(({ body }) => expect(body.collectedThisMonth).toBeGreaterThanOrEqual(50));
  });

  it("validates exported report contents, filter boundaries, and tenant isolation", async () => {
    const suffix = randomUUID();
    const nurseryName = `Integration Nursery ${suffix}`;
    const branchId = 710001;
    const otherBranchId = 710002;
    const classroom = await pool.query<{ id: number }>(
      `insert into classrooms (owner_id, name, level, teacher_name, capacity, branch_id)
       values ($1, $2, 'integration', 'teacher', 10, $3) returning id`,
      [ownerA, `Report classroom ${suffix}`, branchId],
    );
    const otherClassroom = await pool.query<{ id: number }>(
      `insert into classrooms (owner_id, name, level, teacher_name, capacity, branch_id)
       values ($1, $2, 'integration', 'teacher', 10, $3) returning id`,
      [ownerA, `Other report classroom ${suffix}`, otherBranchId],
    );
    await pool.query(
      `insert into nursery_settings (owner_id, nursery_name, updated_by)
       values ($1, $2, $1)
       on conflict (owner_id) do update set nursery_name = excluded.nursery_name, updated_by = excluded.updated_by`,
      [ownerA, nurseryName],
    );

    const operationalToken = `operational-included-${suffix}`;
    const academicToken = `academic-included-${suffix}`;
    const excludedTokens = [
      `wrong-date-${suffix}`,
      `wrong-branch-${suffix}`,
      `wrong-classroom-${suffix}`,
      `wrong-status-${suffix}`,
      `other-tenant-${suffix}`,
    ];
    await pool.query(
      `insert into operational_records
         (owner_id, resource, subject_id, branch_id, title, status, occurred_on, amount, data, created_by)
       values
         ($1, 'setting', $2, $3, $4, 'active', '2026-02-01', 11, '{}', $1),
         ($1, 'curriculum', $2, $3, $5, 'active', '2026-02-28', 12, '{}', $1),
         ($1, 'setting', $2, $3, $6, 'active', '2026-01-31', 13, '{}', $1),
         ($1, 'setting', $2, $7, $8, 'active', '2026-02-10', 14, '{}', $1),
         ($1, 'setting', $9, $3, $10, 'active', '2026-02-10', 15, '{}', $1),
         ($1, 'setting', $2, $3, $11, 'inactive', '2026-02-10', 16, '{}', $1),
         ($12, 'setting', $2, $3, $13, 'active', '2026-02-10', 17, '{}', $12)`,
      [
        ownerA, classroom.rows[0].id, branchId, operationalToken, academicToken,
        excludedTokens[0], otherBranchId, excludedTokens[1], otherClassroom.rows[0].id,
        excludedTokens[2], excludedTokens[3], ownerB, excludedTokens[4],
      ],
    );

    const guardian = await pool.query<{ id: number }>(
      `insert into guardians (owner_id, name, phone) values ($1, $2, $3) returning id`,
      [ownerA, `Report guardian ${suffix}`, `report-${suffix}`],
    );
    const child = await pool.query<{ id: number }>(
      `insert into children
         (owner_id, first_name, last_name, gender, birth_date, guardian_id, classroom_id, level)
       values ($1, 'Report', $2, 'female', '2021-01-01', $3, $4, 'integration') returning id`,
      [ownerA, suffix, guardian.rows[0].id, classroom.rows[0].id],
    );
    const financialToken = `FIN-INCLUDED-${suffix}`;
    const invoice = await pool.query<{ id: number }>(
      `insert into invoices
         (owner_id, invoice_number, guardian_id, child_id, amount, due_date, status)
       values ($1, $2, $3, $4, 21, '2026-12-31', 'paid') returning id`,
      [ownerA, financialToken, guardian.rows[0].id, child.rows[0].id],
    );
    await pool.query(
      `insert into invoice_payments
         (owner_id, invoice_id, method, amount, status, reference, recorded_by, created_at)
       values
         ($1, $2, 'cash', 21, 'completed', 'boundary-start', $1, '2026-02-01T00:00:00.000Z'),
         ($1, $2, 'cash', 22, 'completed', 'boundary-end', $1, '2026-02-28T23:59:59.999Z'),
         ($1, $2, 'cash', 23, 'completed', 'outside-date', $1, '2026-03-01T00:00:00.000Z')`,
      [ownerA, invoice.rows[0].id],
    );

    const commonFilters = `branchId=${branchId}&classroomId=${classroom.rows[0].id}&status=active`
      + "&dateFrom=2026-02-01&dateTo=2026-02-28";
    const operational = await request(app)
      .get(`/api/reports?domain=operational&${commonFilters}`)
      .set(auth(ownerA))
      .expect(200);
    expect(operational.body).toMatchObject({ count: 2, totalAmount: 23 });
    expect(operational.body.records.map((record: { title: string }) => record.title).sort())
      .toEqual([academicToken, operationalToken].sort());

    const academic = await request(app)
      .get(`/api/reports?domain=academic&${commonFilters}`)
      .set(auth(ownerA))
      .expect(200);
    expect(academic.body).toMatchObject({ count: 1, totalAmount: 12 });
    expect(academic.body.records.map((record: { title: string }) => record.title)).toEqual([academicToken]);

    const financialFilters = `branchId=${branchId}&classroomId=${classroom.rows[0].id}&status=paid`
      + "&dateFrom=2026-02-01&dateTo=2026-02-28";
    const financial = await request(app)
      .get(`/api/reports?domain=financial&${financialFilters}`)
      .set(auth(ownerA))
      .expect(200);
    expect(financial.body).toMatchObject({ count: 2, totalAmount: 43, byStatus: { payment: 2 } });
    expect(financial.body.records.every((record: { title: string }) => record.title === financialToken)).toBe(true);
    expect(financial.body.records.map((record: { amount: number }) => record.amount).sort()).toEqual([21, 22]);

    const workbookResponse = await request(app)
      .get(`/api/reports/export?domain=financial&format=xlsx&${financialFilters}`)
      .set(auth(ownerA))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookResponse.body);
    expect(workbook.worksheets.map(({ name }) => name)).toEqual(["ملخص التقرير", "البيانات"]);
    const summary = workbook.getWorksheet("ملخص التقرير")!;
    expect(summary.getCell("A1").value).toBe(nurseryName);
    expect(summary.getColumn(1).values).toEqual(expect.arrayContaining([
      "نوع التقرير", "الفترة", "الفرع", "الفصل", "الحالة", "إجمالي السجلات", "الإجمالي المالي",
    ]));
    expect(summary.getRow(3).values).toEqual([undefined, "نوع التقرير", "financial"]);
    expect(summary.getRow(4).values).toEqual([undefined, "الفترة", "2026-02-01 — 2026-02-28"]);
    expect(summary.getRow(5).values).toEqual([undefined, "الفرع", String(branchId)]);
    expect(summary.getRow(6).values).toEqual([undefined, "الفصل", String(classroom.rows[0].id)]);
    expect(summary.getRow(7).values).toEqual([undefined, "الحالة", "paid"]);
    expect(summary.getRow(9).values).toEqual([undefined, "إجمالي السجلات", 2]);
    expect(summary.getRow(10).values).toEqual([undefined, "الإجمالي المالي", 43]);
    const records = workbook.getWorksheet("البيانات")!;
    expect(records.getRow(1).values).toEqual([
      undefined, "المعرف", "النوع", "العنوان", "الحالة", "التاريخ", "المبلغ",
      "معرف الفرع", "معرف الطفل", "معرف الفصل",
    ]);
    expect(records.rowCount).toBe(3);
    expect([records.getCell("B2").value, records.getCell("B3").value]).toEqual(["revenue", "revenue"]);
    expect([records.getCell("C2").value, records.getCell("C3").value]).toEqual([financialToken, financialToken]);
    expect([records.getCell("F2").value, records.getCell("F3").value].sort()).toEqual([21, 22]);
    expect([records.getCell("G2").value, records.getCell("G3").value]).toEqual([branchId, branchId]);
    expect([records.getCell("I2").value, records.getCell("I3").value])
      .toEqual([classroom.rows[0].id, classroom.rows[0].id]);

    const pdfResponse = await request(app)
      .get(`/api/reports/export?domain=academic&format=pdf&${commonFilters}`)
      .set(auth(ownerA))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(readPdfInfoValue(pdfResponse.body, "Subject")).toBe(nurseryName);
    expect(readPdfInfoValue(pdfResponse.body, "Keywords")).toBe([
      "domain=academic",
      "dateFrom=2026-02-01",
      "dateTo=2026-02-28",
      `branchId=${branchId}`,
      `classroomId=${classroom.rows[0].id}`,
      "status=active",
    ].join(";"));
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

  it("serves the catalog and applies tenant-isolated bulk permission changes", async () => {
    await request(app)
      .get("/api/permission-catalog")
      .set(auth(ownerA))
      .expect(200)
      .expect(({ body }) => {
        const operations = body.flatMap((group: { operations: string[] }) => group.operations);
        expect(operations).toContain("read:dashboard");
        expect(new Set(operations).size).toBe(operations.length);
      });

    await request(app)
      .put("/api/permissions/bulk")
      .set(auth(ownerA))
      .send({
        changes: [
          { role: "teacher", operation: "read:dashboard", allowed: false },
          { role: "teacher", operation: "read:curriculum", allowed: true },
        ],
      })
      .expect(200)
      .expect(({ body }) => expect(body).toHaveLength(2));

    await request(app)
      .put("/api/permissions/bulk")
      .set(auth(ownerA))
      .send({ changes: [{ role: "teacher", operation: "read:not-real", allowed: true }] })
      .expect(400);

    await request(app)
      .put("/api/user-permissions/bulk")
      .set(auth(ownerA))
      .send({
        userId: ownerA,
        changes: [{ operation: "read:dashboard", allowed: false }],
      })
      .expect(200)
      .expect(({ body }) => expect(body[0]).toMatchObject({
        allowed: false,
        effectiveAllowed: false,
      }));

    await request(app)
      .put("/api/user-permissions/bulk")
      .set(auth(ownerA))
      .send({
        userId: ownerA,
        changes: [{ operation: "read:dashboard", allowed: null }],
      })
      .expect(200)
      .expect(({ body }) => expect(body[0]).toMatchObject({
        allowed: null,
        effectiveAllowed: true,
      }));

    await request(app)
      .get("/api/user-permissions")
      .query({ userId: ownerA })
      .set(auth(ownerA))
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));

    await request(app)
      .put("/api/user-permissions/bulk")
      .set(auth(ownerA))
      .send({
        userId: ownerB,
        changes: [{ operation: "read:dashboard", allowed: false }],
      })
      .expect(404);
  });

  it("enforces the six-role sensitive CRUD matrix, audits success, and leaves denied writes unchanged", async () => {
    const matrix = [
      { role: "admin", resource: "expense", allowed: { read: true, create: true, update: true, delete: true } },
      { role: "supervisor", resource: "expense", allowed: { read: true, create: true, update: true, delete: true } },
      { role: "teacher", resource: "curriculum", allowed: { read: true, create: true, update: true, delete: false } },
      { role: "accountant", resource: "expense", allowed: { read: true, create: true, update: true, delete: false } },
      { role: "receptionist", resource: "branch", allowed: { read: true, create: false, update: false, delete: false } },
      { role: "parent", resource: "expense", allowed: { read: false, create: false, update: false, delete: false } },
    ] as const;

    for (const { role, resource, allowed } of matrix) {
      const token = `${role}-${randomUUID()}`;
      const seeded = await request(app)
        .post(`/api/operations/${resource}`)
        .set(auth(ownerA))
        .send({ title: `seed-${token}`, status: "active", data: { token } })
        .expect(201);
      const seededId = seeded.body.id as number;

      await request(app)
        .get(`/api/operations/${resource}`)
        .set(auth(ownerA, role))
        .expect(allowed.read ? 200 : 403);

      const beforeCreate = await pool.query<{ count: string }>(
        "select count(*) from operational_records where owner_id = $1 and resource = $2",
        [ownerA, resource],
      );
      const createResponse = await request(app)
        .post(`/api/operations/${resource}`)
        .set(auth(ownerA, role))
        .send({ title: `created-${token}`, status: "active", data: { token } })
        .expect(allowed.create ? 201 : 403);
      const afterCreate = await pool.query<{ count: string }>(
        "select count(*) from operational_records where owner_id = $1 and resource = $2",
        [ownerA, resource],
      );
      expect(Number(afterCreate.rows[0].count) - Number(beforeCreate.rows[0].count))
        .toBe(allowed.create ? 1 : 0);

      const updateTitle = `updated-${token}`;
      await request(app)
        .patch(`/api/operations/${resource}/${seededId}`)
        .set(auth(ownerA, role))
        .send({ title: updateTitle })
        .expect(allowed.update ? 200 : 403);
      const afterUpdate = await pool.query<{ title: string }>(
        "select title from operational_records where id = $1 and owner_id = $2",
        [seededId, ownerA],
      );
      expect(afterUpdate.rows[0].title).toBe(allowed.update ? updateTitle : `seed-${token}`);

      await request(app)
        .delete(`/api/operations/${resource}/${seededId}`)
        .set(auth(ownerA, role))
        .expect(allowed.delete ? 204 : 403);
      const afterDelete = await pool.query<{ count: string }>(
        "select count(*) from operational_records where id = $1 and owner_id = $2",
        [seededId, ownerA],
      );
      expect(Number(afterDelete.rows[0].count)).toBe(allowed.delete ? 0 : 1);

      const actorAudit = await pool.query<{
        operation: string;
        actor_role: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
      }>(
        `select operation, actor_role, before, after
           from audit_logs
          where owner_id = $1 and actor_id = $1 and actor_role = $2
            and (
              entity_id = $3
              or entity_id = $4
            )
          order by id`,
        [ownerA, role, String(seededId), allowed.create ? String(createResponse.body.id) : ""],
      );
      const expectedOperations = [
        ...(allowed.create ? ["create"] : []),
        ...(allowed.update ? ["update"] : []),
        ...(allowed.delete ? ["delete"] : []),
      ];
      expect(actorAudit.rows.map(({ operation }) => operation)).toEqual(expectedOperations);
      expect(actorAudit.rows.every(({ actor_role }) => actor_role === role)).toBe(true);
      for (const row of actorAudit.rows) {
        if (row.operation === "create") expect(row).toMatchObject({ before: null, after: expect.any(Object) });
        if (row.operation === "update") expect(row).toMatchObject({ before: expect.any(Object), after: expect.any(Object) });
        if (row.operation === "delete") expect(row).toMatchObject({ before: expect.any(Object), after: null });
      }
    }
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

  it("manages gallery uploads with permissions, isolation, and published-only public output", async () => {
    const upload = await request(app).post("/api/site-gallery/uploads/request-url").set(auth(ownerA)).send({
      name: "gallery.jpg", size: 12, contentType: "image/jpeg",
    }).expect(200);
    await request(app).put(upload.body.uploadUrl).set(auth(ownerA))
      .set("content-type", "image/jpeg").set("content-length", "12")
      .send(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])).expect(204);
    const attached = await request(app).post("/api/site-gallery").set(auth(ownerA)).send({
      title: "صورة اختبار", altText: "وصف الصورة", objectPath: upload.body.objectPath,
      contentType: "image/jpeg", size: 12, sortOrder: 2,
    }).expect(201);
    expect(attached.body.status).toBe("draft");
    const invalidUpload = await request(app).post("/api/site-gallery/uploads/request-url").set(auth(ownerA)).send({
      name: "not-an-image.jpg", size: 12, contentType: "image/jpeg",
    }).expect(200);
    await request(app).put(invalidUpload.body.uploadUrl).set(auth(ownerA))
      .set("content-type", "image/jpeg").set("content-length", "12").send(Buffer.from("not an image")).expect(204);
    await request(app).post("/api/site-gallery").set(auth(ownerA)).send({
      title: "مرفوضة", altText: "مرفوضة", objectPath: invalidUpload.body.objectPath,
      contentType: "image/jpeg", size: 12, sortOrder: 0,
    }).expect(415);
    const raceUpload = await request(app).post("/api/site-gallery/uploads/request-url").set(auth(ownerA)).send({
      name: "race.jpg", size: 12, contentType: "image/jpeg",
    }).expect(200);
    await request(app).put(raceUpload.body.uploadUrl).set(auth(ownerA))
      .set("content-type", "image/jpeg").set("content-length", "12")
      .send(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])).expect(204);
    const racePayload = { title: "سباق", altText: "سباق", objectPath: raceUpload.body.objectPath, contentType: "image/jpeg", size: 12, sortOrder: 0 };
    const raceAttach = await Promise.all([
      request(app).post("/api/site-gallery").set(auth(ownerA)).send(racePayload),
      request(app).post("/api/site-gallery").set(auth(ownerA)).send(racePayload),
    ]);
    expect(raceAttach.map((response) => response.status).sort()).toEqual([201, 404]);
    await request(app).post("/api/site-gallery").set(auth(ownerA)).send({
      title: "إعادة", altText: "إعادة", objectPath: upload.body.objectPath,
      contentType: "image/jpeg", size: 12, sortOrder: 2,
    }).expect(404);
    await request(app).get("/api/site-gallery").set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body).toEqual([]));

    process.env.PUBLIC_SITE_OWNER_ID = ownerA;
    await request(app).get("/api/public/site-gallery").expect(200)
      .expect(({ body }) => expect(body).toEqual([]));
    await request(app).patch(`/api/site-gallery/${attached.body.id}`).set(auth(ownerA))
      .send({ status: "published" }).expect(200);
    await request(app).get("/api/public/site-gallery").expect(200).expect(({ body }) => {
      expect(body).toEqual([expect.objectContaining({
        id: attached.body.id, title: "صورة اختبار",
        imageUrl: `/api/public/site-gallery/${attached.body.id}/image`,
      })]);
      expect(body[0].objectPath).toBeUndefined();
    });
    await request(app).get(`/api/public/site-gallery/${attached.body.id}/image`).expect(200)
      .expect("Content-Type", /image\/jpeg/);
    await request(app).patch(`/api/site-gallery/${attached.body.id}`).set(auth(ownerA))
      .send({ status: "hidden" }).expect(200);
    await request(app).get(`/api/public/site-gallery/${attached.body.id}/image`).expect(404);

    await request(app).put("/api/permissions").set(auth(ownerA)).send({
      role: "manager", operation: "create:site-gallery", allowed: false,
    }).expect(200);
    await request(app).post("/api/site-gallery/uploads/request-url").set(auth(ownerA, "manager")).send({
      name: "denied.png", size: 12, contentType: "image/png",
    }).expect(403);
    await request(app).put("/api/user-permissions").set(auth(ownerA)).send({
      userId: ownerA, operation: "create:site-gallery", allowed: true,
    }).expect(200);
    await request(app).post("/api/site-gallery/uploads/request-url").set(auth(ownerA, "manager")).send({
      name: "override.png", size: 12, contentType: "image/png",
    }).expect(200);
    await request(app).put("/api/user-permissions").set(auth(ownerA)).send({
      userId: ownerA, operation: "reorder:site-gallery", allowed: false,
    }).expect(200);
    await request(app).patch(`/api/site-gallery/${attached.body.id}`).set(auth(ownerA, "manager"))
      .send({ sortOrder: 5 }).expect(403);
    failDeleteOnce.add(upload.body.objectPath);
    await request(app).delete(`/api/site-gallery/${attached.body.id}`).set(auth(ownerA)).expect(503);
    await request(app).get("/api/site-gallery").set(auth(ownerA)).expect(200)
      .expect(({ body }) => expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: attached.body.id, status: "deleting" })])));
    await request(app).delete(`/api/site-gallery/${attached.body.id}`).set(auth(ownerA)).expect(204);
    await request(app).get("/api/site-gallery").set(auth(ownerA)).expect(200)
      .expect(({ body }) => expect(body.some((item: { id: number }) => item.id === attached.body.id)).toBe(false));
    delete process.env.PUBLIC_SITE_OWNER_ID;
  });

  it("saves a normalized registration WhatsApp number and exposes only the selected public value", async () => {
    const settingsInput = {
      nurseryName: "حضانة الاختبار",
      registrationWhatsApp: "90916677",
      timezone: "Asia/Kuwait",
      currency: "KWD",
      workingHours: {},
      calendar: {},
    };
    await request(app).put("/api/nursery/settings").set(auth(ownerA)).send(settingsInput).expect(200)
      .expect(({ body }) => expect(body.registrationWhatsApp).toBe("96590916677"));
    await request(app).put("/api/nursery/settings").set(auth(ownerB)).send({
      ...settingsInput,
      registrationWhatsApp: "+96555555555",
    }).expect(200);

    process.env.PUBLIC_SITE_OWNER_ID = ownerA;
    await request(app).get("/api/public/site-settings").expect(200).expect(({ body }) => {
      expect(body).toEqual({ registrationWhatsApp: "96590916677" });
      expect(body.nurseryName).toBeUndefined();
      expect(body.timezone).toBeUndefined();
    });
    process.env.PUBLIC_SITE_OWNER_ID = ownerB;
    await request(app).get("/api/public/site-settings").expect(200)
      .expect(({ body }) => expect(body).toEqual({ registrationWhatsApp: "96555555555" }));

    await request(app).put("/api/nursery/settings").set(auth(ownerA)).send({
      ...settingsInput,
      registrationWhatsApp: "123",
    }).expect(400);
    delete process.env.PUBLIC_SITE_OWNER_ID;
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
        expect.objectContaining({
          resource: "revenue",
          amount: 45,
          data: expect.objectContaining({ invoiceId: stripeInvoice.body.id }),
        }),
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
    await request(app).post(`/api/parent/invoices/${cancelledCheckoutInvoice.body.id}/checkout-session`)
      .set(auth(operationsParent, "parent"))
      .send({ returnUrl: parentReturnUrl }).expect(409);
    const partialCheckoutInvoice = await request(app).post("/api/invoices").set(auth(ownerB)).send({
      childId, dueDate: "2026-12-31", status: "issued",
      lines: [{ type: "fee", description: "Partial checkout", quantity: 1, unitAmount: 100 }],
    }).expect(201);
    await request(app).post(`/api/invoices/${partialCheckoutInvoice.body.id}/payments`).set(auth(ownerB))
      .send({ method: "cash", amount: 30 }).expect(201);
    const previousApiKey = process.env.MYFATOORAH_API_KEY;
    const previousWebhookSecret = process.env.MYFATOORAH_WEBHOOK_SECRET;
    const providerInvoiceId = 1_000_000 + partialCheckoutInvoice.body.id;
    process.env.MYFATOORAH_API_KEY = "integration-test-key";
    process.env.MYFATOORAH_WEBHOOK_SECRET = "integration-test-webhook-secret";
    const providerFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        IsSuccess: true,
        Data: [{ PaymentMethodId: 1, PaymentMethodCode: "KNET" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        IsSuccess: true,
        Data: {
          InvoiceId: providerInvoiceId,
          PaymentURL: `https://myfatoorah.test/pay/${providerInvoiceId}`,
        },
      }), { status: 200 }));
    try {
      await request(app).post(`/api/invoices/${partialCheckoutInvoice.body.id}/checkout-session`).set(auth(ownerB))
        .send({ returnUrl: adminReturnUrl }).expect(200)
        .expect(({ body }) => expect(body.url).toBe(`https://myfatoorah.test/pay/${providerInvoiceId}`));
      expect(providerFetch).toHaveBeenCalledTimes(2);
    } finally {
      providerFetch.mockRestore();
      if (previousApiKey === undefined) delete process.env.MYFATOORAH_API_KEY;
      else process.env.MYFATOORAH_API_KEY = previousApiKey;
      if (previousWebhookSecret === undefined) delete process.env.MYFATOORAH_WEBHOOK_SECRET;
      else process.env.MYFATOORAH_WEBHOOK_SECRET = previousWebhookSecret;
    }
    await request(app).post(`/api/invoices/${partialCheckoutInvoice.body.id}/payments`).set(auth(ownerB))
      .send({ method: "cash", amount: 70 }).expect(201);
    await request(app).get(`/api/invoices/${partialCheckoutInvoice.body.id}`).set(auth(ownerB)).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ paidAmount: 100, balance: 0, status: "paid" }));
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