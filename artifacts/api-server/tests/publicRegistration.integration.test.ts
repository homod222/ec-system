import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const clerkUsers = vi.hoisted(() => new Map<string, Record<string, any>>());
const whatsappMessages = vi.hoisted(() => [] as Array<{ to: string; otp: string }>);
const verifyPassword = vi.hoisted(() => vi.fn(async ({ password }: { userId: string; password: string }) => {
  if (password !== "CorrectPassword123!") throw new Error("invalid password");
}));
const createUser = vi.hoisted(() => vi.fn(async (input: Record<string, any>) => {
  const id = `public-registration-created-${randomUUID()}`;
  const user = {
    id,
    publicMetadata: input.publicMetadata ?? {},
    privateMetadata: input.privateMetadata ?? {},
    emailAddresses: (input.emailAddress ?? []).map((emailAddress: string) => ({
      emailAddress,
      verification: { status: "verified" },
    })),
  };
  clerkUsers.set(id, user);
  return user;
}));
const updateUser = vi.hoisted(() => vi.fn(async (id: string, input: Record<string, any>) => {
  const user = clerkUsers.get(id);
  if (!user) throw new Error("not found");
  const updated = { ...user, ...input };
  clerkUsers.set(id, updated);
  return updated;
}));
const ownerId = `public-registration-owner-${randomUUID()}`;

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: { role: req.headers["x-test-role"] ?? "owner" },
  }),
  clerkClient: {
    signInTokens: { createSignInToken: vi.fn(async ({ userId }: { userId: string }) => ({ token: `ticket-${userId}` })) },
    users: {
      getUser: vi.fn(async (id: string) => clerkUsers.get(id) ?? (id === ownerId
        ? { id, publicMetadata: { role: "owner" }, privateMetadata: {}, emailAddresses: [] }
        : Promise.reject(new Error("not found")))),
      getUserList: vi.fn(async ({ emailAddress }: { emailAddress: string[] }) => ({
        data: [...clerkUsers.values()].filter((user) =>
          user.emailAddresses.some((entry: { emailAddress: string }) =>
            entry.emailAddress.toLowerCase() === emailAddress[0].toLowerCase())),
      })),
      createUser,
      updateUser,
      deleteUser: vi.fn(async (id: string) => clerkUsers.delete(id)),
      verifyPassword,
    },
  },
}));

vi.mock("../src/middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../src/lib/notifications", () => ({
  sendWhatsAppOtp: vi.fn(async (to: string, otp: string) => {
    whatsappMessages.push({ to, otp });
    return { ok: true };
  }),
  sendWhatsAppText: vi.fn(async () => ({ ok: true })),
  sendPaymentConfirmation: vi.fn(async () => undefined),
  sendInvoiceReminder: vi.fn(async () => ({ status: "skipped" })),
  sendParentMessageNotification: vi.fn(async () => undefined),
}));

let app: Awaited<typeof import("../src/app")>["default"];
let pool: Awaited<typeof import("@workspace/db")>["pool"];
const challengeIds: string[] = [];
const loginAttemptHashes = new Set<string>();
const createdStaffIds: number[] = [];
const createdGuardianIds: number[] = [];
const createdAliasIds: number[] = [];
const registrationAttemptIpHashes = new Set<string>();

const digest = (value: string) => createHash("sha256")
  .update(`${process.env.OTP_PEPPER!}:${value}`)
  .digest("hex");
const phone = () => `5${Math.floor(Math.random() * 10_000_000).toString().padStart(7, "0")}`;
const password = "CorrectPassword123!";
const uniqueIp = () => `2001:db8:${randomUUID().slice(0, 4)}::1`;
const trackedRegistrationIp = () => {
  const value = uniqueIp();
  registrationAttemptIpHashes.add(digest(`staff-registration:ip:${value}`));
  return value;
};
const staffRequest = (email: string, value = phone()) => ({
  name: "Public Registration Staff",
  email,
  phone: value,
});
const rememberChallenge = (response: { body: Record<string, any> }) => {
  if (response.body.challengeId) challengeIds.push(response.body.challengeId);
  return response.body.challengeId as string;
};

async function insertStaff(input: { email?: string; phone?: string; status?: string; clerkUserId?: string | null } = {}) {
  const result = await pool.query<{ id: number }>(
    `insert into staff (owner_id, name, role, email, phone, clerk_user_id, account_status)
     values ($1, 'Public Registration Staff', 'teacher', $2, $3, $4, $5) returning id`,
    [ownerId, input.email ?? `staff-${randomUUID()}@example.test`, input.phone ?? phone(),
      input.clerkUserId ?? null, input.status ?? "approved"],
  );
  createdStaffIds.push(result.rows[0].id);
  return result.rows[0].id;
}

async function requestActivation(identifier: string) {
  const response = await request(app).post("/api/auth/registration/staff/activation/request")
    .set("x-forwarded-for", uniqueIp())
    .send({ identifier }).expect(200);
  const challengeId = rememberChallenge(response);
  return { challengeId, otp: whatsappMessages.at(-1)?.otp };
}

beforeAll(async () => {
  process.env.CLERK_SECRET_KEY = "public-registration-clerk-secret";
  process.env.OTP_PEPPER = "public-registration-otp-pepper";
  process.env.PUBLIC_SITE_OWNER_ID = ownerId;
  ({ default: app } = await import("../src/app"));
  ({ pool } = await import("@workspace/db"));
  const { runApplicationMigrations } = await import("../src/lib/applicationMigrations");
  await runApplicationMigrations();
});

afterAll(async () => {
  if (challengeIds.length) await pool.query("delete from phone_otp_challenges where id = any($1::text[])", [challengeIds]);
  if (loginAttemptHashes.size) await pool.query(
    "delete from password_login_attempts where identifier_hash = any($1::text[])",
    [[...loginAttemptHashes]],
  );
  if (registrationAttemptIpHashes.size) await pool.query(
    "delete from password_login_attempts where ip_hash = any($1::text[])",
    [[...registrationAttemptIpHashes]],
  );
  if (createdAliasIds.length) await pool.query("delete from phone_login_identities where id = any($1::int[])", [createdAliasIds]);
  if (createdGuardianIds.length) {
    await pool.query("delete from guardian_registration_claims where guardian_id = any($1::int[])", [createdGuardianIds]);
    await pool.query("delete from guardians where id = any($1::int[])", [createdGuardianIds]);
  }
  if (createdStaffIds.length) await pool.query("delete from audit_logs where owner_id = $1 and entity_id = any($2::text[])", [ownerId, createdStaffIds.map(String)]);
  await pool.query("delete from audit_logs where owner_id = $1", [ownerId]);
  if (createdStaffIds.length) await pool.query("delete from staff where id = any($1::int[])", [createdStaffIds]);
  await pool.end();
});

describe.sequential("public account lifecycle", () => {
  it("uses one generic password-login failure and reserves throttled attempts before verification", async () => {
    const unknown = `unknown-${randomUUID()}@example.test`;
    const known = `known-${randomUUID()}@example.test`;
    const clerkId = `password-user-${randomUUID()}`;
    clerkUsers.set(clerkId, {
      id: clerkId,
      publicMetadata: { ownerId, role: "teacher", accountStatus: "active" },
      privateMetadata: { staffId: 1 },
      emailAddresses: [{ emailAddress: known, verification: { status: "verified" } }],
    });
    await insertStaff({ email: known, clerkUserId: clerkId, status: "active" });
    loginAttemptHashes.add(digest(`identifier:${unknown}`));
    loginAttemptHashes.add(digest(`identifier:${known}`));

    const unknownResponse = await request(app).post("/api/auth/password-login").set("x-forwarded-for", "198.51.100.41")
      .send({ identifier: unknown, password }).expect(400);
    const wrongResponse = await request(app).post("/api/auth/password-login").set("x-forwarded-for", "198.51.100.42")
      .send({ identifier: known, password: "WrongPassword123!" }).expect(400);
    expect(unknownResponse.body).toEqual({ error: "Invalid credentials" });
    expect(wrongResponse.body).toEqual(unknownResponse.body);

    for (let index = 0; index < 7; index += 1) {
      await request(app).post("/api/auth/password-login").set("x-forwarded-for", "198.51.100.42")
        .send({ identifier: known, password: "WrongPassword123!" }).expect(400);
    }
    const verificationCalls = verifyPassword.mock.calls.length;
    const throttled = await request(app).post("/api/auth/password-login").set("x-forwarded-for", "198.51.100.42")
      .send({ identifier: known, password }).expect(400);
    expect(throttled.body).toEqual(unknownResponse.body);
    expect(verifyPassword).toHaveBeenCalledTimes(verificationCalls);
  });

  it("retires the legacy staff password-reset URLs", async () => {
    for (const path of ["/api/staff/password-reset/request", "/api/staff/password-reset/complete"]) {
      await request(app).post(path).set("x-test-user", ownerId).send({}).expect(410);
    }
  });

  it("resets the owner by email through the owner's verified phone alias", async () => {
    const email = `owner-${randomUUID()}@example.test`;
    const aliasPhone = `965${phone()}`;
    clerkUsers.set(ownerId, {
      id: ownerId,
      publicMetadata: { role: "owner" },
      privateMetadata: {},
      emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
    });
    const alias = await pool.query<{ id: number }>(
      `insert into phone_login_identities (clerk_user_id, normalized_phone, first_name)
       values ($1, $2, 'Owner') returning id`,
      [ownerId, aliasPhone],
    );
    createdAliasIds.push(alias.rows[0].id);
    const requested = await request(app).post("/api/auth/password-reset/request")
      .set("x-forwarded-for", "198.51.100.51").send({ identifier: email }).expect(200);
    const challengeId = rememberChallenge(requested);
    expect(whatsappMessages.at(-1)?.to).toBe(aliasPhone);
    const callsBefore = updateUser.mock.calls.length;
    await request(app).post("/api/auth/password-reset/complete")
      .send({ challengeId, otp: whatsappMessages.at(-1)?.otp, password }).expect(200)
      .expect({ accepted: true });
    expect(updateUser).toHaveBeenCalledTimes(callsBefore + 1);
    expect(updateUser).toHaveBeenLastCalledWith(ownerId, { password });
    await pool.query("delete from phone_login_identities where id = $1", [alias.rows[0].id]);
  });

  it("resets the owner by email through a verified Clerk phone without an alias", async () => {
    const email = `owner-clerk-phone-${randomUUID()}@example.test`;
    const verifiedPhone = `+965${phone()}`;
    clerkUsers.set(ownerId, {
      id: ownerId,
      publicMetadata: { role: "owner" },
      privateMetadata: {},
      emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
      phoneNumbers: [{ phoneNumber: verifiedPhone, verification: { status: "verified" } }],
    });
    const requested = await request(app).post("/api/auth/password-reset/request")
      .set("x-forwarded-for", uniqueIp()).send({ identifier: email }).expect(200);
    const challengeId = rememberChallenge(requested);
    expect(whatsappMessages.at(-1)?.to).toBe(verifiedPhone.replace("+", ""));
    const callsBefore = updateUser.mock.calls.length;
    await request(app).post("/api/auth/password-reset/complete")
      .send({ challengeId, otp: whatsappMessages.at(-1)?.otp, password }).expect(200)
      .expect({ accepted: true });
    expect(updateUser).toHaveBeenCalledTimes(callsBefore + 1);
    expect(updateUser).toHaveBeenLastCalledWith(ownerId, { password });
  });

  it("rejects a staff reset if its current database binding is disabled after the OTP request", async () => {
    const email = `disabled-reset-${randomUUID()}@example.test`;
    const clerkId = `disabled-reset-user-${randomUUID()}`;
    const staffId = await insertStaff({ email, clerkUserId: clerkId, status: "active" });
    clerkUsers.set(clerkId, {
      id: clerkId,
      publicMetadata: { ownerId, role: "teacher", accountStatus: "active" },
      privateMetadata: { staffId },
      emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
    });
    const requested = await request(app).post("/api/auth/password-reset/request")
      .set("x-forwarded-for", "198.51.100.52").send({ identifier: email }).expect(200);
    const challengeId = rememberChallenge(requested);
    const otp = whatsappMessages.at(-1)?.otp;
    await pool.query("update staff set account_status = 'disabled', clerk_user_id = null where id = $1", [staffId]);
    const callsBefore = updateUser.mock.calls.length;
    await request(app).post("/api/auth/password-reset/complete")
      .send({ challengeId, otp, password }).expect(400).expect({ error: "Invalid or expired code" });
    expect(updateUser).toHaveBeenCalledTimes(callsBefore);
  });

  it("rejects a guardian reset after its current Clerk binding is invalidated", async () => {
    const email = `invalidated-guardian-${randomUUID()}@example.test`;
    const guardianPhone = phone();
    const clerkId = `invalidated-guardian-user-${randomUUID()}`;
    const guardian = await pool.query<{ id: number }>(
      `insert into guardians (owner_id, name, phone, email, clerk_user_id)
       values ($1, 'Invalidated Guardian', $2, $3, $4) returning id`,
      [ownerId, guardianPhone, email, clerkId],
    );
    const guardianId = guardian.rows[0].id;
    createdGuardianIds.push(guardianId);
    clerkUsers.set(clerkId, {
      id: clerkId,
      publicMetadata: { ownerId, role: "parent", accountStatus: "active" },
      privateMetadata: { guardianId },
      emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
    });
    const requested = await request(app).post("/api/auth/password-reset/request")
      .set("x-forwarded-for", "198.51.100.53").send({ identifier: guardianPhone }).expect(200);
    const challengeId = rememberChallenge(requested);
    const otp = whatsappMessages.at(-1)?.otp;
    await pool.query("update guardians set clerk_user_id = null where id = $1", [guardianId]);
    const callsBefore = updateUser.mock.calls.length;
    await request(app).post("/api/auth/password-reset/complete")
      .send({ challengeId, otp, password }).expect(400).expect({ error: "Invalid or expired code" });
    expect(updateUser).toHaveBeenCalledTimes(callsBefore);
  });

  it("does not provision through the unauthenticated retired legacy staff verification handler", async () => {
    const staffId = await insertStaff({ status: "pending_verification" });
    const createsBefore = createUser.mock.calls.length;
    await request(app).post(`/api/staff/${staffId}/account/verify`)
      .send({ otp: "123456", password }).expect(401);
    expect(createUser).toHaveBeenCalledTimes(createsBefore);
    const stored = await pool.query<{ account_status: string; clerk_user_id: string | null }>(
      "select account_status, clerk_user_id from staff where id = $1", [staffId],
    );
    expect(stored.rows[0]).toEqual({ account_status: "pending_verification", clerk_user_id: null });
  });

  it("approves an authenticated admin invitation without sending a legacy OTP", async () => {
    const staffId = await insertStaff({ status: "unlinked" });
    const messagesBefore = whatsappMessages.length;
    const response = await request(app).post(`/api/staff/${staffId}/account`)
      .set("x-test-user", ownerId)
      .send({ mode: "invite", role: "teacher" }).expect(200);
    expect(response.body).toMatchObject({
      staffId,
      clerkUserId: null,
      accountStatus: "approved",
      setupComplete: false,
      otpSent: false,
    });
    expect(whatsappMessages).toHaveLength(messagesBefore);
    const stored = await pool.query<{ account_status: string; otp_hash: string | null }>(
      "select account_status, otp_hash from staff where id = $1", [staffId],
    );
    expect(stored.rows[0]).toEqual({ account_status: "approved", otp_hash: null });
  });

  it("serializes same-email staff registration even when concurrent requests use different phones", async () => {
    const email = `duplicate-${randomUUID()}@example.test`;
    const sourceIp = trackedRegistrationIp();
    const responses = await Promise.all([phone(), phone()].map((value) =>
      request(app).post("/api/auth/registration/staff").set("x-forwarded-for", sourceIp).send(staffRequest(email, value)).expect(200),
    ));
    expect(responses.map(response => response.body)).toEqual([
      { status: "pending_approval" }, { status: "pending_approval" },
    ]);
    const rows = await pool.query<{ id: number }>(
      "select id from staff where owner_id = $1 and lower(email) = $2", [ownerId, email],
    );
    expect(rows.rows).toHaveLength(1);
    createdStaffIds.push(rows.rows[0].id);
  });

  it("bounds unique staff registration submissions from one IP", async () => {
    const sourceIp = trackedRegistrationIp();
    const suffix = randomUUID();
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      request(app).post("/api/auth/registration/staff")
        .set("x-forwarded-for", sourceIp)
        .send(staffRequest(`bounded-${index}-${suffix}@example.test`, String(55_010_000 + index))),
    ));
    expect(responses.filter(response => response.status === 200)).toHaveLength(10);
    expect(responses.filter(response => response.status === 429)).toHaveLength(2);
    const rows = await pool.query<{ id: number }>(
      "select id from staff where owner_id = $1 and email like $2",
      [ownerId, `bounded-%-${suffix}@example.test`],
    );
    expect(rows.rows).toHaveLength(10);
    createdStaffIds.push(...rows.rows.map(row => row.id));
  });

  it("keeps approved staff retryable after invalid and expired activation OTPs", async () => {
    const email = `retryable-${randomUUID()}@example.test`;
    const staffId = await insertStaff({ email });
    const invalid = await requestActivation(email);
    await request(app).post("/api/auth/registration/staff/complete")
      .send({ challengeId: invalid.challengeId, otp: "000000", password }).expect(400);
    const expired = await requestActivation(email);
    await pool.query("update phone_otp_challenges set expires_at = now() - interval '1 second' where id = $1", [expired.challengeId]);
    await request(app).post("/api/auth/registration/staff/complete")
      .send({ challengeId: expired.challengeId, otp: expired.otp, password }).expect(400);
    const stored = await pool.query<{ account_status: string; clerk_user_id: string | null }>(
      "select account_status, clerk_user_id from staff where id = $1", [staffId],
    );
    expect(stored.rows[0]).toEqual({ account_status: "approved", clerk_user_id: null });
  });

  it("leaves staff approved when Clerk account creation fails", async () => {
    const email = `clerk-failure-${randomUUID()}@example.test`;
    const staffId = await insertStaff({ email });
    const activation = await requestActivation(email);
    createUser.mockRejectedValueOnce(new Error("Clerk unavailable"));
    await request(app).post("/api/auth/registration/staff/complete")
      .send({ challengeId: activation.challengeId, otp: activation.otp, password }).expect(500);
    const stored = await pool.query<{ account_status: string; clerk_user_id: string | null }>(
      "select account_status, clerk_user_id from staff where id = $1", [staffId],
    );
    expect(stored.rows[0]).toEqual({ account_status: "approved", clerk_user_id: null });
  });

  it("recovers a marked orphan staff account instead of creating another Clerk user", async () => {
    const email = `orphan-staff-${randomUUID()}@example.test`;
    const staffId = await insertStaff({ email });
    const clerkId = `orphan-staff-user-${randomUUID()}`;
    clerkUsers.set(clerkId, {
      id: clerkId,
      publicMetadata: { ownerId, role: "teacher", accountStatus: "active" },
      privateMetadata: { staffId },
      emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
    });
    const activation = await requestActivation(email);
    const beforeCreates = createUser.mock.calls.length;
    await request(app).post("/api/auth/registration/staff/complete")
      .send({ challengeId: activation.challengeId, otp: activation.otp, password }).expect(200)
      .expect({ status: "created" });
    expect(createUser).toHaveBeenCalledTimes(beforeCreates);
    const stored = await pool.query<{ account_status: string; clerk_user_id: string | null }>(
      "select account_status, clerk_user_id from staff where id = $1", [staffId],
    );
    expect(stored.rows[0]).toEqual({ account_status: "active", clerk_user_id: clerkId });
  });

  it("reconciles a guardian claim only for its valid marked Clerk user", async () => {
    const email = `guardian-claim-${randomUUID()}@example.test`;
    const guardian = await pool.query<{ id: number }>(
      "insert into guardians (owner_id, name, phone, email) values ($1, 'Claim Guardian', $2, $3) returning id",
      [ownerId, phone(), email],
    );
    const guardianId = guardian.rows[0].id;
    createdGuardianIds.push(guardianId);
    const registration = await request(app).post("/api/auth/registration/guardian/request")
      .send({ name: "Claim Guardian User", phone: (await pool.query<{ phone: string }>("select phone from guardians where id = $1", [guardianId])).rows[0].phone, email })
      .expect(200);
    const challengeId = rememberChallenge(registration);
    const clerkId = `guardian-marked-${randomUUID()}`;
    clerkUsers.set(clerkId, {
      id: clerkId,
      publicMetadata: { ownerId, role: "parent", accountStatus: "active" },
      privateMetadata: { guardianId },
      emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
    });
    await pool.query(
      "insert into guardian_registration_claims (guardian_id, challenge_id, clerk_user_id, expires_at) values ($1, $2, $3, now() + interval '10 minutes')",
      [guardianId, challengeId, clerkId],
    );
    await request(app).post("/api/auth/registration/guardian/complete")
      .send({ challengeId, otp: whatsappMessages.at(-1)?.otp, password }).expect(200).expect({ status: "created" });
    const linked = await pool.query<{ clerk_user_id: string | null }>("select clerk_user_id from guardians where id = $1", [guardianId]);
    expect(linked.rows[0].clerk_user_id).toBe(clerkId);
  });

  it("never links a claim whose Clerk tenant metadata does not match", async () => {
    const email = `guardian-mismatch-${randomUUID()}@example.test`;
    const guardianPhone = phone();
    const guardian = await pool.query<{ id: number }>(
      "insert into guardians (owner_id, name, phone, email) values ($1, 'Mismatch Guardian', $2, $3) returning id",
      [ownerId, guardianPhone, email],
    );
    const guardianId = guardian.rows[0].id;
    createdGuardianIds.push(guardianId);
    const registration = await request(app).post("/api/auth/registration/guardian/request")
      .send({ name: "Mismatch Guardian User", phone: guardianPhone, email }).expect(200);
    const challengeId = rememberChallenge(registration);
    const clerkId = `guardian-wrong-tenant-${randomUUID()}`;
    clerkUsers.set(clerkId, {
      id: clerkId,
      publicMetadata: { ownerId: `other-${ownerId}`, role: "parent", accountStatus: "active" },
      privateMetadata: { guardianId },
      emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
    });
    await pool.query(
      "insert into guardian_registration_claims (guardian_id, challenge_id, clerk_user_id, expires_at) values ($1, $2, $3, now() + interval '10 minutes')",
      [guardianId, challengeId, clerkId],
    );
    await request(app).post("/api/auth/registration/guardian/complete")
      .send({ challengeId, otp: whatsappMessages.at(-1)?.otp, password }).expect(200).expect({ status: "needs_admin" });
    const linked = await pool.query<{ clerk_user_id: string | null }>("select clerk_user_id from guardians where id = $1", [guardianId]);
    expect(linked.rows[0].clerk_user_id).toBeNull();
  });
});