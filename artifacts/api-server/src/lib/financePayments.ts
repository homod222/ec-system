import type Stripe from "stripe";
import { db, invoicesTable, type Guardian, type Invoice } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";

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
 * using a fixed conversion rate.
 *
 * KWD is one of the world's higher-valued, historically stable currencies
 * (Kuwait's central bank pegs it to an undisclosed basket of currencies), so a
 * fixed rate is a reasonable approximation, but it WILL drift from the market
 * rate over time. This should be reviewed periodically or replaced with a
 * live FX-rate lookup if precise conversion becomes important.
 */
const KWD_TO_USD_RATE = 3.26; // approximate, set 2026-08-26
const CHARGE_CURRENCY = "usd";

/**
 * KWD is a three-decimal currency; USD is a two-decimal currency. Convert the
 * KWD invoice amount to USD, then to the smallest unit (cents) Stripe expects.
 */
function toStripeAmount(amountKwd: number): number {
  return Math.round(amountKwd * KWD_TO_USD_RATE * 100);
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
  const stripe = await getUncachableStripeClient();

  // Reuse an existing, still-open Checkout Session for this invoice instead
  // of creating a second payable link. Without this, repeated or concurrent
  // "Pay now" clicks before the webhook lands would each mint a fresh
  // session, and a guardian could complete more than one of them -- a real
  // double-charge risk.
  if (params.invoice.stripeCheckoutSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(params.invoice.stripeCheckoutSessionId);
      if (existing.status === "open" && existing.url) {
        return { url: existing.url, sessionId: existing.id };
      }
    } catch (err) {
      logger.warn(
        { err, invoiceId: params.invoice.id },
        "Could not retrieve existing Stripe checkout session, creating a new one",
      );
    }
  }

  const productId = await getOrCreateInvoiceProduct(stripe);

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CHARGE_CURRENCY,
            unit_amount: toStripeAmount(params.invoice.amount),
            product: productId,
          },
        },
      ],
      customer_email: params.guardian.email ?? undefined,
      metadata: {
        invoiceId: String(params.invoice.id),
        invoiceNumber: params.invoice.invoiceNumber,
        originalAmountKwd: String(params.invoice.amount),
        exchangeRateKwdToUsd: String(KWD_TO_USD_RATE),
      },
      payment_intent_data: {
        metadata: {
          invoiceId: String(params.invoice.id),
          originalAmountKwd: String(params.invoice.amount),
          exchangeRateKwdToUsd: String(KWD_TO_USD_RATE),
        },
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    },
    {
      // Stable per-invoice key: if two requests race to create a session for
      // the same invoice before either has written stripeCheckoutSessionId
      // back to the DB, Stripe itself serializes them and returns the same
      // session object to both callers instead of minting two. Stripe drops
      // idempotency keys after ~24h, which lines up with the default
      // Checkout Session expiry, so a genuinely new session can still be
      // created once the old one has expired.
      idempotencyKey: `invoice-checkout-${params.invoice.id}`,
    },
  );

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  await db
    .update(invoicesTable)
    .set({ stripeCheckoutSessionId: session.id })
    .where(eq(invoicesTable.id, params.invoice.id));

  logger.info({ invoiceId: params.invoice.id, sessionId: session.id }, "Created Stripe checkout session for invoice");

  return { url: session.url, sessionId: session.id };
}
