import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  paymentNotificationsTable: {},
}));

describe("WhatsApp notifications", async () => {
  const { sendWhatsAppOtp } = await import("./notifications");

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ULTRAMSG_INSTANCE_ID = "instance12345";
    process.env.ULTRAMSG_TOKEN = "test-token";
  });

  it("sends OTP through UltraMsg without putting credentials in headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sent: "true", id: 1 }), { status: 200 }),
    );

    await expect(sendWhatsAppOtp("5000 1234", "123456")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.ultramsg.com/instance12345/messages/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    const body = request?.body as URLSearchParams;
    expect(body.get("to")).toBe("+96550001234");
    expect(body.get("body")).toContain("123456");
    expect(body.get("token")).toBe("test-token");
    expect(JSON.stringify(request?.headers)).not.toContain("test-token");
  });

  it("does not expose the OTP or provider response body when delivery fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Provider echoed token and OTP 654321", { status: 401 }),
    );

    const result = await sendWhatsAppOtp("5000 1234", "654321");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("HTTP 401");
      expect(result.error).not.toContain("654321");
      expect(result.error).not.toContain("Provider echoed");
    }
  });

  it("fails explicitly when UltraMsg is not configured", async () => {
    delete process.env.ULTRAMSG_TOKEN;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await sendWhatsAppOtp("5000 1234", "123456");

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});