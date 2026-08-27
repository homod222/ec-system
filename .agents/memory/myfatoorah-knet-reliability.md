---
name: MyFatoorah KNET reliability
description: Non-obvious MyFatoorah v2 response, signature, retry, and reconciliation behavior for KNET payments.
---

Treat every MyFatoorah invoice as an immutable payment attempt reserved locally before `ExecutePayment`. Reuse a failed transaction's existing payable link; only create another attempt after the provider confirms cancellation or expiry. Once `ExecutePayment` may have created an invoice, every later failure—including failure to persist the returned provider ID locally—must leave the reservation recoverable. Repair missed webhooks and ambiguous outcomes through `GetPaymentStatus` using the attempt's unique customer reference.

**Why:** MyFatoorah does not accept an idempotency key for `ExecutePayment`, and network/5xx/malformed-success outcomes can leave a real provider invoice without a saved local ID. Replacing provider IDs also loses valid late success events from older links.

**How to apply:** Retain every provider invoice ID, validate KWD amount/currency on reconciliation, supersede sibling attempts after first success, and flag any later success as an overpayment requiring review.

The current v2 `InitiatePayment` sandbox response wraps methods under `Data.PaymentMethods` rather than returning `Data` as a direct array. Accept both shapes for compatibility.

**Why:** The narrative documentation and live sandbox response differ, and assuming the documented direct-array shape prevents KNET discovery.

**How to apply:** Test the live sandbox response shape whenever changing MyFatoorah API versions.

For Webhook v2 `PAYMENT_STATUS_CHANGED`, sign exactly:
`Invoice.Id`, `Invoice.Status`, `Transaction.Status`, `Transaction.PaymentId`, `Invoice.ExternalIdentifier`.
Join as comma-separated `key=value` pairs, substitute empty strings for missing values, then compare Base64 HMAC-SHA256 using the webhook secret.

**Why:** Property order and exact casing are part of MyFatoorah's signature input.

**How to apply:** Fail closed before any database update, and keep a regression test built from the provider's documented canonical string.