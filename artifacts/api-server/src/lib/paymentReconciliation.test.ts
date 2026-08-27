import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { verifyMyFatoorahWebhook, type PaymentWebhook } from "./paymentReconciliation";
import app from "../app";

const payload: PaymentWebhook = {
  Event: { Code: 1, Name: "PAYMENT_STATUS_CHANGED", Reference: "WH-1" },
  Data: {
    Invoice: { Id: "6409988", Status: "PAID", ExternalIdentifier: "811" },
    Transaction: { Status: "SUCCESS", PaymentId: "07076409988323998875" },
    Amount: { PayCurrency: "KWD", ValueInPayCurrency: "125.000" },
  },
};

afterEach(() => {
  delete process.env.MYFATOORAH_WEBHOOK_SECRET;
});

describe("MyFatoorah webhook verification", () => {
  it("accepts the documented HMAC-SHA256 signature order", () => {
    process.env.MYFATOORAH_WEBHOOK_SECRET = "test-secret";
    const canonical = "Invoice.Id=6409988,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=07076409988323998875,Invoice.ExternalIdentifier=811";
    const signature = createHmac("sha256", "test-secret").update(canonical).digest("base64");
    expect(verifyMyFatoorahWebhook(payload, signature)).toBe(true);
  });

  it("rejects modified or unsigned events", () => {
    process.env.MYFATOORAH_WEBHOOK_SECRET = "test-secret";
    expect(verifyMyFatoorahWebhook(payload, "invalid")).toBe(false);
    delete process.env.MYFATOORAH_WEBHOOK_SECRET;
    expect(verifyMyFatoorahWebhook(payload, "anything")).toBe(false);
  });

  it("rejects webhook requests without a valid provider signature", async () => {
    process.env.MYFATOORAH_WEBHOOK_SECRET = "test-secret";
    await request(app).post("/api/myfatoorah/webhook").send(payload).expect(400);
    await request(app)
      .post("/api/myfatoorah/webhook")
      .set("myfatoorah-signature", "invalid")
      .send(payload)
      .expect(401);
  });
});