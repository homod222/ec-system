import { describe, expect, it } from "vitest";
import {
  createInvoiceCheckoutSession,
  isAmbiguousProviderFailure,
  isIncompleteExecutePaymentResponse,
} from "./financePayments";
import { InvoiceNotPayableError } from "./invoiceLedger";

describe("MyFatoorah invoice-creation uncertainty", () => {
  it("allows safe retry when InitiatePayment fails before invoice creation", () => {
    expect(isAmbiguousProviderFailure(false)).toBe(false);
    expect(isAmbiguousProviderFailure(false, 503)).toBe(false);
  });

  it("retains an ExecutePayment reservation after network, 5xx, or malformed success responses", () => {
    expect(isAmbiguousProviderFailure(true)).toBe(true);
    expect(isAmbiguousProviderFailure(true, 503)).toBe(true);
    expect(isAmbiguousProviderFailure(true, 200, true)).toBe(true);
    expect(isAmbiguousProviderFailure(true, 400)).toBe(false);
    expect(isIncompleteExecutePaymentResponse({ InvoiceId: 123 })).toBe(true);
    expect(isIncompleteExecutePaymentResponse({ PaymentURL: "https://example.com/pay" })).toBe(true);
    expect(isIncompleteExecutePaymentResponse({
      InvoiceId: 123,
      PaymentURL: "https://example.com/pay",
    })).toBe(false);
  });

  it.each(["draft", "cancelled"])("rejects a %s invoice before payment-provider configuration", async (status) => {
    await expect(createInvoiceCheckoutSession({
      invoice: { id: 1, ownerId: "owner", guardianId: 2, amount: 25, status } as any,
      guardian: { id: 2, ownerId: "owner" } as any,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    })).rejects.toBeInstanceOf(InvoiceNotPayableError);
  });
});
