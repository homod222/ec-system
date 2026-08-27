import type Stripe from "stripe";
import {
  childrenTable,
  db,
  guardiansTable,
  invoicesTable,
  type Guardian,
  type Invoice,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";
import {
  EXCHANGE_RATE_LOCK_ID,
  getCurrentKwdToUsdRate,
  getStoredFreshKwdToUsdRate,
} from "./exchangeRates";

const INVOICE_PRODUCT_NAME = "رسوم الحضانة";

/**
 * Nursery invoices carry an arbitrary, per-invoice amount, so there is no
 * fixed catalog of Stripe Prices to reuse. We keep a single Stripe Product
 * (created once, found by name afterwards) and attach a dynamic `price_data`
 * to each Checkout Session -- this keeps the product catalog itself living in
 * Stripe (per the platform convention) while still supporting one-off custom
 * amounts.
 */
let cachedProductId: string | null = null;

async function getOrCreateInvoiceProduct(stripe: Stripe): Promise<string> {
  if (cachedProductId) return cachedProductId;

  const existing = await stripe.products.search({
    query: `name:'${INVOICE_PRODUCT_NAME}' AND active:'true'`,
  });
  if (existing.data.length > 0) {
    cachedProductId = existing.data[0].id;
    return cachedProductId;
  }

  const product = await stripe.products.create({
    name: INVOICE_PRODUCT_NAME,
    description: "سداد فواتير رسوم الحضانة",
  });
  cachedProductId = product.id;
  return cachedProductId;
}

/**
 * Invoices are denominated in Kuwaiti Dinar (KWD), but the connected Stripe
 * account rejects KWD as a presentment currency (confirmed via a live API
 * call: `Invalid currency: kwd ... Your account currently supports these
 * currencies: usd, aed, ...` -- KWD is not in that list at all, so this is an
 * account/region limitation, not something fixable by adding a bank account
 * from application code). The user chose to keep invoices in KWD and let the
 * integration pick a Stripe-supported charge currency, so we charge in USD
 * using a recently fetched market rate. Checkout is stopped if no sufficiently
 * fresh rate is available, rather than silently charging with stale data.
 */
const CHARGE_CURRENCY = "usd";

/**
 * KWD is a three-decimal currency; USD is a two-decimal currency. Convert the
 * KWD invoice amount to USD, then to the smallest unit (cents) Stripe expects.
 */
function toStripeAmount(amountKwd: number, exchangeRate: number): number {
  return Math.round(amountKwd * exchangeRate * 100);
}

/**
 * Origins the app is allowed to redirect a guardian back to after Stripe
 * checkout. Built only from server-controlled deployment env vars, never
 * from client input -- accepting an arbitrary caller-supplied return URL
 * would let an authenticated caller point Stripe's post-payment redirect at
 * an attacker-controlled domain (open-redirect / phishing vector).
 */
function getAllowedReturnOrigins(): string[] {
  const domains = new Set<string>();
  process.env.REPLIT_DOMAINS?.split(",").forEach((domain) => {
    const trimmed = domain.trim();
    if (trimmed) domains.add(trimmed);
  });
  if (process.env.REPLIT_DEV_DOMAIN) domains.add(process.env.REPLIT_DEV_DOMAIN);
  return Array.from(domains, (domain) => `https://${domain}`);
}

export function isAllowedReturnUrl(url: string): boolean {
  try {
    return getAllowedReturnOrigins().includes(new URL(url).origin);
  } catch {
    return false;
  }
}

export async function createInvoiceCheckoutSession(params: {
  invoice: Invoice;
  guardian: Guardian;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  // Refresh on demand before entering the shared publication lock. Attempting
  // an exclusive refresh while holding the shared lock would self-deadlock.
  // Do this before any Stripe work so an expired rate cannot even begin
  // preparing a payment session.
  await getCurrentKwdToUsdRate();
  const stripe = await getUncachableStripeClient();
  const productId = await getOrCreateInvoiceProduct(stripe);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(${EXCHANGE_RATE_LOCK_ID})`);
    // A database-backed advisory lock serializes checkout creation for the
    // invoice across concurrent requests and API instances. The second caller
    // sees and reuses the session stored by the first instead of minting
    // another payable link.
    await tx.execute(sql`select pg_advisory_xact_lock(${params.invoice.id})`);

    const [currentInvoiceRow] = await tx
      .select({ invoice: invoicesTable })
      .from(invoicesTable)
      .innerJoin(childrenTable, and(
        eq(invoicesTable.childId, childrenTable.id),
        eq(invoicesTable.ownerId, childrenTable.ownerId),
      ))
      .innerJoin(guardiansTable, and(
        eq(invoicesTable.guardianId, guardiansTable.id),
        eq(invoicesTable.ownerId, guardiansTable.ownerId),
      ))
      .where(and(
        eq(invoicesTable.id, params.invoice.id),
        eq(invoicesTable.ownerId, params.invoice.ownerId),
        eq(invoicesTable.guardianId, params.guardian.id),
      ))
      .limit(1);
    const currentInvoice = currentInvoiceRow?.invoice;
    if (!currentInvoice || currentInvoice.status === "paid") {
      throw new Error("Invoice is no longer payable");
    }

    const {
      rate: exchangeRate,
      fetchedAt: exchangeRateFetchedAt,
      sourceUpdatedAt: exchangeRateSourceUpdatedAt,
    } = await getStoredFreshKwdToUsdRate();
    const rateVersion = String(exchangeRateSourceUpdatedAt.getTime());

    let replaceExistingSession = false;
    if (currentInvoice.stripeCheckoutSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(currentInvoice.stripeCheckoutSessionId);
        if (
          existing.status === "open" &&
          existing.url &&
          existing.metadata?.exchangeRateVersion === rateVersion
        ) {
          return { url: existing.url, sessionId: existing.id };
        }
        if (existing.status === "open") {
          await stripe.checkout.sessions.expire(existing.id);
          replaceExistingSession = true;
        } else if (existing.status === "expired") {
          replaceExistingSession = true;
        } else {
          throw new Error("Invoice payment is already processing");
        }
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          "statusCode" in err &&
          (err as { statusCode?: number }).statusCode === 404
        ) {
          replaceExistingSession = true;
        } else {
          throw err;
        }
      }
    }

    const nextAttempt = currentInvoice.stripeCheckoutAttempt + 1;
    await tx
      .update(invoicesTable)
      .set({ stripeCheckoutAttempt: nextAttempt })
      .where(eq(invoicesTable.id, currentInvoice.id));

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: CHARGE_CURRENCY,
              unit_amount: toStripeAmount(currentInvoice.amount, exchangeRate),
              product: productId,
            },
          },
        ],
        customer_email: params.guardian.email ?? undefined,
        metadata: {
          invoiceId: String(currentInvoice.id),
          invoiceNumber: currentInvoice.invoiceNumber,
          originalAmountKwd: String(currentInvoice.amount),
          exchangeRateKwdToUsd: String(exchangeRate),
          exchangeRateFetchedAt: exchangeRateFetchedAt.toISOString(),
          exchangeRateVersion: rateVersion,
        },
        payment_intent_data: {
          metadata: {
            invoiceId: String(currentInvoice.id),
            originalAmountKwd: String(currentInvoice.amount),
            exchangeRateKwdToUsd: String(exchangeRate),
            exchangeRateFetchedAt: exchangeRateFetchedAt.toISOString(),
            exchangeRateVersion: rateVersion,
          },
        },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        // Keep a payable link short-lived even if a provider update or
        // scheduler failure prevents proactive revocation. Stripe requires at
        // least 30 minutes, so allow a small clock-skew margin.
        expires_at: Math.floor(Date.now() / 1_000) + 31 * 60,
      },
      {
        // The persisted attempt increments only when replacing/creating under
        // the invoice lock. If Stripe succeeds but the DB transaction fails,
        // the increment rolls back and a retry reuses this same key/session.
        idempotencyKey: `invoice-checkout-${currentInvoice.id}-${nextAttempt}-${rateVersion}`,
      },
    );

    if (session.status !== "open" || !session.url) {
      throw new Error("Stripe did not return an open checkout session");
    }

    await tx
      .update(invoicesTable)
      .set({ stripeCheckoutSessionId: session.id })
      .where(eq(invoicesTable.id, currentInvoice.id));

    logger.info(
      {
        invoiceId: currentInvoice.id,
        sessionId: session.id,
        exchangeRate,
        rateVersion,
        checkoutAttempt: nextAttempt,
        replacedExistingSession: replaceExistingSession,
      },
      "Created Stripe checkout session for invoice",
    );

    return { url: session.url, sessionId: session.id };
  });
}
