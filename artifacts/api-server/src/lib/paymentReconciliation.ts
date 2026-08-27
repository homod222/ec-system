import type Stripe from "stripe";
import { db, guardiansTable, invoicesTable, invoicePaymentsTable, invoiceRefundsTable, activitiesTable } from "@workspace/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { sendPaymentConfirmation } from "./notifications";
import { logger } from "./logger";
import {
  invoiceOutstandingBalance,
  requireCheckoutPayable,
  settledPaymentStatuses,
} from "./invoiceLedger";

function extractInvoiceId(obj: { metadata?: Record<string, string> | null }): number | null {
  const raw = obj.metadata?.invoiceId;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function parseRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const rate = Number(raw);
  return Number.isFinite(rate) ? rate : null;
}

async function markInvoicePaid(
  invoiceId: number,
  paymentIntentId: string | null,
  charged: { amount: number; currency: string; exchangeRate: number | null } | null,
  settlementAmountKwd: number | null,
) {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${invoiceId} for update`);
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice) return null;
    if (paymentIntentId) {
      const [existing] = await tx.select({ id: invoicePaymentsTable.id }).from(invoicePaymentsTable).where(and(
        eq(invoicePaymentsTable.invoiceId, invoiceId),
        eq(invoicePaymentsTable.ownerId, invoice.ownerId),
        eq(invoicePaymentsTable.reference, paymentIntentId),
        inArray(invoicePaymentsTable.status, [...settledPaymentStatuses]),
      )).limit(1);
      if (existing) return null;
    }
    const [payments, refunds] = await Promise.all([
      tx.select({ amount: invoicePaymentsTable.amount }).from(invoicePaymentsTable).where(and(
        eq(invoicePaymentsTable.invoiceId, invoiceId),
        eq(invoicePaymentsTable.ownerId, invoice.ownerId),
        inArray(invoicePaymentsTable.status, [...settledPaymentStatuses]),
      )),
      tx.select({ amount: invoiceRefundsTable.amount }).from(invoiceRefundsTable).where(and(
        eq(invoiceRefundsTable.invoiceId, invoiceId),
        eq(invoiceRefundsTable.ownerId, invoice.ownerId),
      )),
    ]);
    const outstanding = invoiceOutstandingBalance(invoice.amount, payments, refunds);
    requireCheckoutPayable(invoice.status, outstanding);
    const settledAmount = settlementAmountKwd ?? outstanding;
    if (settledAmount <= 0 || settledAmount - outstanding > 0.0005) {
      throw new Error("Stripe settlement does not match the invoice outstanding balance");
    }
    const paidAt = new Date();
    const chargedNote = charged
      ? ` (تم تحصيل ${charged.amount} ${charged.currency.toUpperCase()} عبر Stripe)`
      : "";
    await tx.insert(invoicePaymentsTable).values({
      ownerId: invoice.ownerId,
      invoiceId: invoice.id,
      method: "payment_link",
      amount: settledAmount,
      currency: "KWD",
      status: "completed",
      reference: paymentIntentId,
      note: chargedNote || null,
      recordedBy: "Stripe",
    });
    const remaining = Math.max(0, outstanding - settledAmount);
    const [updated] = await tx.update(invoicesTable).set({
      status: remaining <= 0.0005 ? "paid" : "partial",
      paidAt: remaining <= 0.0005 ? paidAt : null,
      stripePaymentIntentId: paymentIntentId,
      lastPaymentStatus: "succeeded",
      lastPaymentError: null,
      paymentMethod: "payment_link",
      paymentReference: paymentIntentId,
      ...(charged ? {
        chargedCurrency: charged.currency,
        chargedAmount: charged.amount,
        exchangeRate: charged.exchangeRate,
      } : {}),
    }).where(eq(invoicesTable.id, invoice.id)).returning();
    await tx.insert(activitiesTable).values({
      ownerId: invoice.ownerId,
      type: "payment",
      title: `تم سداد فاتورة ${invoice.invoiceNumber}`,
      description: `تم استلام دفعة بمبلغ ${settledAmount} د.ك عبر Stripe${chargedNote}`,
      actor: "Stripe",
    });
    return updated;
  });
  if (!result) return;

  const [guardian] = await db.select().from(guardiansTable).where(eq(guardiansTable.id, result.guardianId)).limit(1);
  if (guardian) {
    await sendPaymentConfirmation(result, guardian);
  }

  logger.info({ invoiceId }, "Invoice marked as paid via Stripe webhook");
}

async function markInvoicePaymentFailed(invoiceId: number, errorMessage: string) {
  await db
    .update(invoicesTable)
    .set({ lastPaymentStatus: "failed", lastPaymentError: errorMessage.slice(0, 500) })
    .where(and(eq(invoicesTable.id, invoiceId), ne(invoicesTable.status, "paid")));
  logger.warn({ invoiceId, errorMessage }, "Stripe payment attempt failed for invoice");
}

/**
 * Domain-specific webhook reconciliation, separate from StripeSync's own
 * `processWebhook` (which only mirrors Stripe objects into the `stripe.*`
 * schema). This is where we update our own `invoices` table and trigger
 * payment-confirmation notifications.
 *
 * Must only be called AFTER `WebhookHandlers.processWebhook` has successfully
 * verified the same payload's signature -- we intentionally don't re-verify
 * here, since Replit's managed-webhook flow keeps the signing secret internal
 * to StripeSync and doesn't expose it to application code.
 */
export async function reconcileInvoicePayment(payload: Buffer): Promise<void> {
  const event = JSON.parse(payload.toString("utf8")) as Stripe.Event;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const invoiceId = extractInvoiceId(session);
      if (invoiceId === null) return;
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
      const charged =
        session.amount_total != null && session.currency
          ? {
              amount: session.amount_total / 100,
              currency: session.currency,
              exchangeRate: parseRate(session.metadata?.exchangeRateKwdToUsd),
            }
          : null;
      await markInvoicePaid(invoiceId, paymentIntentId, charged, parseRate(session.metadata?.settlementAmountKwd));
      return;
    }
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const invoiceId = extractInvoiceId(paymentIntent);
      if (invoiceId === null) return;
      const charged = {
        amount: (paymentIntent.amount_received || paymentIntent.amount) / 100,
        currency: paymentIntent.currency,
        exchangeRate: parseRate(paymentIntent.metadata?.exchangeRateKwdToUsd),
      };
      await markInvoicePaid(invoiceId, paymentIntent.id, charged, parseRate(paymentIntent.metadata?.settlementAmountKwd));
      return;
    }
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const invoiceId = extractInvoiceId(paymentIntent);
      if (invoiceId === null) return;
      const message = paymentIntent.last_payment_error?.message ?? "فشلت عملية الدفع";
      await markInvoicePaymentFailed(invoiceId, message);
      return;
    }
    default:
      return;
  }
}
