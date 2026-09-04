import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  guardiansTable: {},
  phoneLoginIdentitiesTable: {},
  phoneOtpChallengesTable: {},
  publicAuthAccountsTable: {},
  staffTable: {},
}));
vi.mock("./localAuth", () => ({ getLocalAuth: vi.fn(), hashPassword: vi.fn(), verifyPassword: vi.fn(), signJwt: vi.fn() }));
vi.mock("./notifications", () => ({ sendWhatsAppOtp: vi.fn() }));

describe("phone authentication", async () => {
  const { createPhoneAuthRouter, normalizeKuwaitPhone } = await import("../routes/phoneAuth");

  it("normalizes supported Kuwait mobile formats", () => {
    expect(normalizeKuwaitPhone("5000 1234")).toBe("96550001234");
    expect(normalizeKuwaitPhone("+965 6000 1234")).toBe("96560001234");
    expect(normalizeKuwaitPhone("00965 9000 1234")).toBe("96590001234");
  });

  it("rejects landlines, non-Kuwait numbers, and malformed input", () => {
    expect(normalizeKuwaitPhone("2222 1234")).toBeNull();
    expect(normalizeKuwaitPhone("+966 5000 1234")).toBeNull();
    expect(normalizeKuwaitPhone("500123")).toBeNull();
  });

  it("accepts an injected sender without contacting WhatsApp", () => {
    const sender = vi.fn(async () => ({ ok: true as const }));
    expect(createPhoneAuthRouter(sender)).toBeTruthy();
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("replacement authentication contracts", async () => {
  const {
    RequestPublicRegistrationBody,
    VerifyPublicRegistrationBody,
    SignInWithPhonePasswordBody,
  } = await import("@workspace/api-zod");

  it("requires a Kuwait registration identity with a triple full name", () => {
    expect(RequestPublicRegistrationBody.safeParse({
      phone: "+965 5000 1234",
      fullName: "أحمد محمد علي",
      email: "parent@example.com",
      accountType: "guardian",
    }).success).toBe(true);
    expect(RequestPublicRegistrationBody.safeParse({
      phone: "+965 5000 1234",
      fullName: "أحمد علي",
      email: "parent@example.com",
      accountType: "guardian",
    }).success).toBe(false);
    expect(RequestPublicRegistrationBody.safeParse({
      phone: "+965 5000 1234",
      fullName: "أحمد محمد علي",
      email: "invalid",
      accountType: "owner",
    }).success).toBe(false);
  });

  it("accepts an optional positive public registration branch", () => {
    expect(RequestPublicRegistrationBody.safeParse({
      phone: "+965 5000 1234",
      fullName: "أحمد محمد علي",
      email: "parent@example.com",
      accountType: "guardian",
      branchId: 7,
    }).success).toBe(true);
    expect(RequestPublicRegistrationBody.safeParse({
      phone: "+965 5000 1234",
      fullName: "أحمد محمد علي",
      email: "parent@example.com",
      accountType: "guardian",
      branchId: 0,
    }).success).toBe(false);
  });

  it("creates the password only in the OTP verification step", () => {
    const request = RequestPublicRegistrationBody.parse({
      phone: "50001234",
      fullName: "Test Middle User",
      email: "staff@example.com",
      accountType: "staff",
      password: "not-accepted-here",
    });
    expect(request).not.toHaveProperty("password");
    expect(VerifyPublicRegistrationBody.safeParse({
      challengeId: "12345678-1234-1234-1234-123456789012",
      otp: "123456",
      password: "safe-password-123",
    }).success).toBe(true);
    expect(VerifyPublicRegistrationBody.safeParse({
      challengeId: "12345678-1234-1234-1234-123456789012",
      otp: "123456",
      password: "12345678",
    }).success).toBe(false);
  });

  it("requires phone and password for subsequent sign-in", () => {
    expect(SignInWithPhonePasswordBody.safeParse({
      phone: "50001234",
      password: "safe-password",
    }).success).toBe(true);
    expect(SignInWithPhonePasswordBody.safeParse({ phone: "50001234" }).success).toBe(false);
  });
});