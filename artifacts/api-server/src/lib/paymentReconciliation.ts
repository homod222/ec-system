import type Stripe from "stripe";
import { db, guardiansTable, invoicesTable, invoicePaymentsTable, activitiesTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { sendPaymentConfirmation } from "./notifications";
import { logger } from "./logger";

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
) {
  const [updated] = await db
    .update(invoicesTable)
    .set({
      status: "paid",
      paidAt: new Date(),
      stripePaymentIntentId: paymentIntentId,
      lastPaymentStatus: "succeeded",
      lastPaymentError: null,
      paymentMethod: "payment_link",
      paymentReference: paymentIntentId,
      ...(charged
        ? {
            chargedCurrency: charged.currency,
            chargedAmount: charged.amount,
            exchangeRate: charged.exchangeRate,
          }
        : {}),
    })
    .where(and(eq(invoicesTable.id, invoiceId), ne(invoicesTable.status, "paid")))
    .returning();

  if (!updated) {
    // Already marked paid by a previous event (e.g. both checkout.session.completed
    // and payment_intent.succeeded fired) -- idempotent no-op.
    return;
  }

  const chargedNote =
    updated.chargedAmount != null && updated.chargedCurrency
      ? ` (تم تحصيل ${updated.chargedAmount} ${updated.chargedCurrency.toUpperCase()} عبر Stripe)`
      : "";
  await db.insert(invoicePaymentsTable).values({
    ownerId: updated.ownerId,
    invoiceId: updated.id,
    method: "payment_link",
    amount: updated.amount,
    currency: "KWD",
    status: "succeeded",
    reference: paymentIntentId,
    note: chargedNote || null,
    recordedBy: "Stripe",
  });
  await db.insert(activitiesTable).values({
    ownerId: updated.ownerId,
    type: "payment",
    title: `تم سداد فاتورة ${updated.invoiceNumber}`,
    description: `تم استلام دفعة بمبلغ ${updated.amount} د.ك عبر Stripe${chargedNote}`,
    actor: "Stripe",
  });

  const [guardian] = await db.select().from(guardiansTable).where(eq(guardiansTable.id, updated.guardianId)).limit(1);
  if (guardian) {
    await sendPaymentConfirmation(updated, guardian);
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
      await markInvoicePaid(invoiceId, paymentIntentId, charged);
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
      await markInvoicePaid(invoiceId, paymentIntent.id, charged);
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
