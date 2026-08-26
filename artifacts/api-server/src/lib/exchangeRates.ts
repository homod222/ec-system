import { db, exchangeRatesTable, invoicesTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getUncachableStripeClient } from "./stripeClient";

const PAIR = "KWD_USD";
const SOURCE = "open.er-api.com";
const SOURCE_URL = "https://open.er-api.com/v6/latest/KWD";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_RATE_AGE_MS = 36 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
export const EXCHANGE_RATE_LOCK_ID = 1_263_555_172;

type ExchangeRateApiResponse = {
  result?: string;
  rates?: Record<string, number>;
  time_last_update_unix?: number;
  "error-type"?: string;
};

export class ExchangeRateUnavailableError extends Error {
  constructor() {
    super("تعذّر تحديث سعر صرف الدينار الكويتي حاليًا. تم إيقاف إنشاء جلسة الدفع لتفادي تحصيل مبلغ غير دقيق. يرجى المحاولة لاحقًا.");
    this.name = "ExchangeRateUnavailableError";
  }
}

type CurrentRate = { rate: number; fetchedAt: Date; sourceUpdatedAt: Date };

let refreshInFlight: Promise<CurrentRate> | null = null;

function isFresh(rate: CurrentRate): boolean {
  return (
    Date.now() - rate.fetchedAt.getTime() <= MAX_RATE_AGE_MS &&
    Date.now() - rate.sourceUpdatedAt.getTime() <= MAX_RATE_AGE_MS
  );
}

async function readStoredRate(): Promise<CurrentRate | null> {
  const [stored] = await db
    .select()
    .from(exchangeRatesTable)
    .where(eq(exchangeRatesTable.pair, PAIR))
    .limit(1);
  if (!stored) return null;
  return {
    rate: stored.rate,
    fetchedAt: stored.fetchedAt,
    sourceUpdatedAt: stored.sourceUpdatedAt,
  };
}

async function fetchAndStoreKwdToUsdRate(): Promise<CurrentRate> {
  const response = await fetch(SOURCE_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Exchange-rate provider returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ExchangeRateApiResponse;
  const rate = payload.rates?.USD;
  if (payload.result !== "success" || !Number.isFinite(rate) || rate! <= 0) {
    throw new Error(`Exchange-rate provider returned invalid data: ${payload["error-type"] ?? payload.result ?? "unknown"}`);
  }

  const sourceUpdatedAt = payload.time_last_update_unix
    ? new Date(payload.time_last_update_unix * 1_000)
    : new Date();
  if (Date.now() - sourceUpdatedAt.getTime() > MAX_RATE_AGE_MS) {
    throw new Error(`Exchange-rate provider data is stale (${sourceUpdatedAt.toISOString()})`);
  }
  const fetchedAt = new Date();
  const rateVersion = String(sourceUpdatedAt.getTime());

  const published = await db.transaction(async (tx) => {
    // Exclusive publication lock: checkout creation takes the shared form of
    // this same lock, so no old-version session can be created between the
    // revocation scan and publishing the refreshed rate.
    await tx.execute(sql`select pg_advisory_xact_lock(${EXCHANGE_RATE_LOCK_ID})`);

    const [currentlyPublished] = await tx
      .select()
      .from(exchangeRatesTable)
      .where(eq(exchangeRatesTable.pair, PAIR))
      .limit(1);
    if (currentlyPublished && currentlyPublished.sourceUpdatedAt > sourceUpdatedAt) {
      return {
        rate: currentlyPublished.rate,
        fetchedAt: currentlyPublished.fetchedAt,
        sourceUpdatedAt: currentlyPublished.sourceUpdatedAt,
      };
    }

    const invoices = await tx
      .select({ sessionId: invoicesTable.stripeCheckoutSessionId })
      .from(invoicesTable)
      .where(and(ne(invoicesTable.status, "paid"), isNotNull(invoicesTable.stripeCheckoutSessionId)));
    const inactiveSessionIds: string[] = [];

    if (invoices.length > 0) {
      const stripe = await getUncachableStripeClient();
      for (const invoice of invoices) {
        if (!invoice.sessionId) continue;
        try {
          const session = await stripe.checkout.sessions.retrieve(invoice.sessionId);
          if (session.status === "open" && session.metadata?.exchangeRateVersion !== rateVersion) {
            await stripe.checkout.sessions.expire(session.id);
            inactiveSessionIds.push(session.id);
          } else if (session.status === "expired") {
            inactiveSessionIds.push(session.id);
          }
        } catch (err) {
          if (
            err &&
            typeof err === "object" &&
            "statusCode" in err &&
            (err as { statusCode?: number }).statusCode === 404
          ) {
            inactiveSessionIds.push(invoice.sessionId);
          } else {
            throw err;
          }
        }
      }
    }

    if (inactiveSessionIds.length > 0) {
      await tx
        .update(invoicesTable)
        .set({ stripeCheckoutSessionId: null })
        .where(inArray(invoicesTable.stripeCheckoutSessionId, inactiveSessionIds));
      logger.info(
        { count: inactiveSessionIds.length, rateVersion },
        "Expired checkout sessions using an older exchange rate",
      );
    }

    await tx
      .insert(exchangeRatesTable)
      .values({ pair: PAIR, rate: rate!, source: SOURCE, sourceUpdatedAt, fetchedAt })
      .onConflictDoUpdate({
        target: exchangeRatesTable.pair,
        set: { rate: rate!, source: SOURCE, sourceUpdatedAt, fetchedAt },
      });
    return { rate: rate!, fetchedAt, sourceUpdatedAt };
  });

  logger.info({ pair: PAIR, rate, sourceUpdatedAt }, "Exchange rate refreshed");
  return published;
}

export function refreshKwdToUsdRate(): Promise<CurrentRate> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = fetchAndStoreKwdToUsdRate().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function getCurrentKwdToUsdRate(): Promise<CurrentRate> {
  try {
    const stored = await readStoredRate();
    if (stored && isFresh(stored)) return stored;
    return await refreshKwdToUsdRate();
  } catch (err) {
    logger.error(
      { err, pair: PAIR },
      "No fresh exchange rate is available",
    );
    throw new ExchangeRateUnavailableError();
  }
}

export async function getStoredFreshKwdToUsdRate(): Promise<CurrentRate> {
  try {
    const stored = await readStoredRate();
    if (!stored || !isFresh(stored)) throw new Error("No fresh stored exchange rate");
    return stored;
  } catch (err) {
    logger.error({ err, pair: PAIR }, "Fresh stored exchange rate is unavailable");
    throw new ExchangeRateUnavailableError();
  }
}

export async function initializeExchangeRateScheduler(): Promise<void> {
  try {
    await refreshKwdToUsdRate();
  } catch (err) {
    logger.error({ err, pair: PAIR }, "Initial exchange-rate refresh failed; checkout will require a fresh rate");
  }

  const timer = setInterval(() => {
    refreshKwdToUsdRate().catch((err) => {
      logger.error({ err, pair: PAIR }, "Scheduled exchange-rate refresh failed");
    });
  }, REFRESH_INTERVAL_MS);
  timer.unref();
}