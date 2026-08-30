import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  guardiansTable: {},
  phoneLoginIdentitiesTable: {},
  phoneOtpChallengesTable: {},
  staffTable: {},
}));
vi.mock("@clerk/express", () => ({ clerkClient: {}, getAuth: vi.fn() }));
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