export const settledPaymentStatuses = ["completed", "succeeded"] as const;

const checkoutPayableStatuses = new Set(["issued", "pending", "partial", "overdue"]);

export class InvoiceNotPayableError extends Error {
  constructor() {
    super("Invoice is not payable or has no outstanding balance");
    this.name = "InvoiceNotPayableError";
  }
}

export function invoiceOutstandingBalance(
  invoiceAmount: number,
  payments: ReadonlyArray<{ amount: number }>,
  refunds: ReadonlyArray<{ amount: number }>,
) {
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const refunded = refunds.reduce((sum, refund) => sum + refund.amount, 0);
  return Math.max(0, invoiceAmount - paid + refunded);
}

export function requireCheckoutPayable(status: string, balance: number) {
  if (!checkoutPayableStatuses.has(status) || balance <= 0.0005) {
    throw new InvoiceNotPayableError();
  }
}