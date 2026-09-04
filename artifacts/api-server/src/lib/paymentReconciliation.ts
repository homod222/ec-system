import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  activitiesTable,
  db,
  guardiansTable,
  invoicePaymentsTable,
  invoicesTable,
  paymentAttemptsTable,
  type PaymentAttempt,
} from "@workspace/db";
import { sendPaymentConfirmation } from "./notifications";
import { logger } from "./logger";
import type { MyFatoorahPaymentStatus } from "./financePayments";
import { refreshBillingProgressForInvoice } from "./billingPlans";

type PaymentWebhook = {
  Event?: { Code?: number; Name?: string; Reference?: string };
  Data?: {
    Invoice?: {
      Id?: string;
      Status?: string;
      ExpirationDate?: string;
      ExternalIdentifier?: string;
    };
    Transaction?: {
      Status?: string;
      PaymentId?: string;
      Error?: { Message?: string };
    };
    Amount?: { PayCurrency?: string; ValueInPayCurrency?: string };
  };
};

function signatureData(payload: PaymentWebhook): string {
  const invoice = payload.Data?.Invoice;
  const transaction = payload.Data?.Transaction;
  return [
    `Invoice.Id=${invoice?.Id ?? ""}`,
    `Invoice.Status=${invoice?.Status ?? ""}`,
    `Transaction.Status=${transaction?.Status ?? ""}`,
    `Transaction.PaymentId=${transaction?.PaymentId ?? ""}`,
    `Invoice.ExternalIdentifier=${invoice?.ExternalIdentifier ?? ""}`,
  ].join(",");
}

export function verifyMyFatoorahWebhook(payload: PaymentWebhook, signature: string): boolean {
  const secret = process.env.MYFATOORAH_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(signatureData(payload), "utf8").digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

async function markPaid(
  attempt: PaymentAttempt,
  paymentId: string | null,
  amount: number,
  currency: string,
): Promise<void> {
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    currency.toUpperCase() !== "KWD" ||
    Math.abs(amount - attempt.amount) > 0.000_5
  ) {
    throw new Error("Invalid KWD charge details from MyFatoorah");
  }

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${attempt.invoiceId})`);
    const [currentAttempt] = await tx.select().from(paymentAttemptsTable)
      .where(eq(paymentAttemptsTable.id, attempt.id)).limit(1);
    if (!currentAttempt || currentAttempt.status === "succeeded") {
      return { kind: "replay" as const };
    }
    const [invoice] = await tx.select().from(invoicesTable)
      .where(eq(invoicesTable.id, attempt.invoiceId)).limit(1);
    if (!invoice) return { kind: "missing" as const };

    await tx.update(paymentAttemptsTable).set({
      status: "succeeded",
      providerPaymentId: paymentId,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(eq(paymentAttemptsTable.id, attempt.id));

    if (invoice.status === "paid") {
      return { kind: "duplicate" as const, invoice };
    }

    await tx.update(paymentAttemptsTable).set({
      status: "superseded",
      errorMessage: "تم سداد الفاتورة من خلال محاولة دفع أخرى",
      updatedAt: new Date(),
    }).where(and(
      eq(paymentAttemptsTable.invoiceId, attempt.invoiceId),
      ne(paymentAttemptsTable.id, attempt.id),
      inArray(paymentAttemptsTable.status, ["creating", "pending", "failed"]),
    ));

    const [updated] = await tx.update(invoicesTable).set({
      status: "paid",
      paidAt: new Date(),
      myFatoorahPaymentId: paymentId,
      lastPaymentStatus: "succeeded",
      lastPaymentError: null,
      chargedCurrency: "KWD",
      chargedAmount: amount,
      exchangeRate: null,
      paymentMethod: "payment_link",
      paymentReference: paymentId,
    }).where(eq(invoicesTable.id, attempt.invoiceId)).returning();
    await tx.insert(invoicePaymentsTable).values({
      ownerId: updated.ownerId,
      invoiceId: updated.id,
      method: "payment_link",
      amount: updated.amount,
      currency: "KWD",
      status: "completed",
      reference: paymentId,
      note: `تم التحصيل عبر KNET / MyFatoorah`,
      recordedBy: "MyFatoorah",
    });
    return { kind: "paid" as const, invoice: updated };
  });
  if (outcome.kind === "replay" || outcome.kind === "missing") return;
  if (outcome.kind === "paid" || outcome.kind === "duplicate") {
    await refreshBillingProgressForInvoice(outcome.invoice.id);
  }

  const [guardian] = await db.select().from(guardiansTable)
    .where(eq(guardiansTable.id, outcome.invoice.guardianId)).limit(1);
  if (outcome.kind === "duplicate") {
    await db.insert(activitiesTable).values({
      ownerId: outcome.invoice.ownerId,
      branchId: outcome.invoice.branchId ?? null,
      type: "payment_overpayment",
      title: `دفعة مكررة للفاتورة ${outcome.invoice.invoiceNumber}`,
      description: `وصلت دفعة إضافية بمبلغ ${amount} د.ك عبر KNET وتتطلب المراجعة والاسترداد`,
      actor: "MyFatoorah / KNET",
    });
    logger.error({
      invoiceId: attempt.invoiceId,
      paymentAttemptId: attempt.id,
      paymentId,
    }, "Duplicate MyFatoorah payment requires refund review");
    return;
  }

  await db.insert(activitiesTable).values({
    ownerId: outcome.invoice.ownerId,
    branchId: outcome.invoice.branchId ?? null,
    type: "payment",
    title: `تم سداد فاتورة ${outcome.invoice.invoiceNumber}`,
    description: `تم استلام دفعة بمبلغ ${amount} د.ك عبر KNET`,
    actor: "MyFatoorah / KNET",
  });
  if (guardian) await sendPaymentConfirmation(outcome.invoice, guardian);
  logger.info({ invoiceId: attempt.invoiceId, paymentAttemptId: attempt.id, paymentId }, "Invoice marked paid via MyFatoorah");
}

async function markNotPaid(
  attempt: PaymentAttempt,
  status: "failed" | "cancelled",
  message: string,
  paymentId?: string | null,
): Promise<void> {
  await db.update(paymentAttemptsTable).set({
    status: status === "failed"
      ? (attempt.paymentUrl ? "pending" : "creating")
      : "cancelled",
    providerPaymentId: paymentId ?? attempt.providerPaymentId,
    errorMessage: message.slice(0, 500),
    updatedAt: new Date(),
  }).where(eq(paymentAttemptsTable.id, attempt.id));
  await db.update(invoicesTable).set({
    lastPaymentStatus: status,
    lastPaymentError: message.slice(0, 500),
  }).where(and(eq(invoicesTable.id, attempt.invoiceId), ne(invoicesTable.status, "paid")));
  logger.warn({ invoiceId: attempt.invoiceId, paymentAttemptId: attempt.id, status }, "MyFatoorah KNET payment did not complete");
}

export async function reconcilePaymentAttemptFromStatus(
  attempt: PaymentAttempt,
  status: MyFatoorahPaymentStatus,
): Promise<void> {
  if (!attempt.providerInvoiceId && status.InvoiceId) {
    await db.update(paymentAttemptsTable).set({
      providerInvoiceId: String(status.InvoiceId),
      updatedAt: new Date(),
    }).where(eq(paymentAttemptsTable.id, attempt.id));
  }
  const transactions = status.InvoiceTransactions ?? [];
  const successful = [...transactions].reverse().find((transaction) => {
    const value = transaction.TransactionStatus?.toUpperCase();
    return value === "SUCCSS" || value === "SUCCESS";
  });
  if (status.InvoiceStatus?.toUpperCase() === "PAID" && successful) {
    await markPaid(
      attempt,
      successful.PaymentId ?? null,
      Number(successful.PaidCurrencyValue ?? status.InvoiceValue),
      successful.PaidCurrency ?? "KWD",
    );
    return;
  }
  const invoiceStatus = status.InvoiceStatus?.toUpperCase();
  const expirationTime = status.ExpiryDate ? Date.parse(status.ExpiryDate) : Number.NaN;
  const expired = Number.isFinite(expirationTime) && expirationTime <= Date.now();
  if (
    invoiceStatus === "CANCELED" ||
    invoiceStatus === "CANCELLED" ||
    invoiceStatus === "EXPIRED" ||
    expired
  ) {
    await markNotPaid(attempt, "cancelled", "تم إلغاء أو انتهاء صلاحية عملية الدفع عبر KNET");
    return;
  }
  const failed = [...transactions].reverse().find((transaction) =>
    transaction.TransactionStatus?.toUpperCase() === "FAILED");
  if (failed) {
    await markNotPaid(attempt, "failed", failed.Error || "فشلت عملية الدفع عبر KNET", failed.PaymentId);
  }
}

export async function reconcileInvoicePayment(payload: PaymentWebhook): Promise<void> {
  if (payload.Event?.Code !== 1 || payload.Event?.Name !== "PAYMENT_STATUS_CHANGED") return;
  const providerInvoiceId = payload.Data?.Invoice?.Id;
  if (!providerInvoiceId) return;
  const [attempt] = await db.select().from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.providerInvoiceId, providerInvoiceId)).limit(1);
  if (!attempt) {
    logger.warn({ providerInvoiceId }, "Ignored MyFatoorah webhook for an unknown payment attempt");
    return;
  }
  const invoiceStatus = payload.Data?.Invoice?.Status?.toUpperCase();
  const expirationTime = payload.Data?.Invoice?.ExpirationDate
    ? Date.parse(payload.Data.Invoice.ExpirationDate)
    : Number.NaN;
  if (
    invoiceStatus === "CANCELED" ||
    invoiceStatus === "CANCELLED" ||
    invoiceStatus === "EXPIRED" ||
    (Number.isFinite(expirationTime) && expirationTime <= Date.now())
  ) {
    await markNotPaid(attempt, "cancelled", "تم إلغاء أو انتهاء صلاحية عملية الدفع عبر KNET");
    return;
  }
  const status = payload.Data?.Transaction?.Status?.toUpperCase();
  if (status === "SUCCESS") {
    await markPaid(
      attempt,
      payload.Data?.Transaction?.PaymentId ?? null,
      Number(payload.Data?.Amount?.ValueInPayCurrency),
      payload.Data?.Amount?.PayCurrency ?? "",
    );
  } else if (status === "FAILED") {
    await markNotPaid(attempt, "failed", payload.Data?.Transaction?.Error?.Message || "فشلت عملية الدفع عبر KNET");
  } else if (status === "CANCELED" || status === "CANCELLED") {
    await markNotPaid(attempt, "cancelled", "تم إلغاء عملية الدفع عبر KNET");
  }
}

export type { PaymentWebhook };