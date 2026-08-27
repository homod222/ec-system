import { and, asc, gt, inArray } from "drizzle-orm";
import { db, paymentAttemptsTable } from "@workspace/db";
import {
  getMyFatoorahPaymentStatus,
  isMyFatoorahConfigured,
} from "./financePayments";
import { reconcilePaymentAttemptFromStatus } from "./paymentReconciliation";
import { logger } from "./logger";

const INTERVAL_MS = 60_000;

export async function scanOutstandingPaymentAttempts(
  handler: (attempt: typeof paymentAttemptsTable.$inferSelect) => Promise<void>,
): Promise<void> {
  let lastId = 0;
  while (true) {
    const attempts = await db.select().from(paymentAttemptsTable)
      .where(and(
        inArray(paymentAttemptsTable.status, ["creating", "pending"]),
        gt(paymentAttemptsTable.id, lastId),
      ))
      .orderBy(asc(paymentAttemptsTable.id))
      .limit(100);
    for (const attempt of attempts) {
      lastId = attempt.id;
      await handler(attempt);
    }
    if (attempts.length < 100) return;
  }
}

async function reconcileOutstandingAttempts(): Promise<void> {
  await scanOutstandingPaymentAttempts(async (attempt) => {
      try {
        const status = attempt.providerInvoiceId
          ? await getMyFatoorahPaymentStatus(attempt.providerInvoiceId, "InvoiceId")
          : await getMyFatoorahPaymentStatus(attempt.customerReference, "CustomerReference");
        await reconcilePaymentAttemptFromStatus(attempt, status);
      } catch (error) {
        logger.warn({ error, paymentAttemptId: attempt.id }, "Could not reconcile MyFatoorah payment attempt");
      }
  });
}

export function startPaymentReconciliationScheduler(): void {
  if (!isMyFatoorahConfigured()) {
    logger.info("MyFatoorah reconciliation scheduler is disabled until provider secrets are configured");
    return;
  }
  reconcileOutstandingAttempts().catch((error) => {
    logger.error({ error }, "Initial MyFatoorah payment reconciliation failed");
  });
  const timer = setInterval(() => {
    reconcileOutstandingAttempts().catch((error) => {
      logger.error({ error }, "Scheduled MyFatoorah payment reconciliation failed");
    });
  }, INTERVAL_MS);
  timer.unref();
}