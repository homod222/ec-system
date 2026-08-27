import { describe, expect, it } from "vitest";
import {
  isAmbiguousProviderFailure,
  isIncompleteExecutePaymentResponse,
} from "./financePayments";

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
});