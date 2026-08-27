import {
  childrenTable,
  db,
  guardiansTable,
  invoicesTable,
  notificationDispatchClaimsTable,
  paymentNotificationsTable,
  pool,
  type Invoice,
} from "@workspace/db";
import { and, eq, lt, ne, or } from "drizzle-orm";
import { getReminderStage, isDueSoonRetryWindow } from "./dueReminderEligibility";
import { logger } from "./logger";
import { sendDueReminder } from "./notifications";

type ReminderStage = "due_soon" | "overdue";

const DAILY_REMINDER_LOCK_ID = 924_003;
const SCHEDULE_HOUR_UTC = 6;
const UNCERTAIN_CLAIM_LEASE_MS = 60 * 60 * 1000;

async function automaticReminderStatus(
  invoiceId: number,
  reminderStage: ReminderStage,
  status: "sent" | "failed",
): Promise<boolean> {
  const [existing] = await db
    .select({ id: paymentNotificationsTable.id })
    .from(paymentNotificationsTable)
    .where(and(
      eq(paymentNotificationsTable.invoiceId, invoiceId),
      eq(paymentNotificationsTable.type, "due_reminder"),
      eq(paymentNotificationsTable.source, "automatic"),
      eq(paymentNotificationsTable.reminderStage, reminderStage),
      eq(paymentNotificationsTable.status, status),
    ))
    .limit(1);
  return Boolean(existing);
}

async function claimAutomaticReminder(
  invoiceId: number,
  reminderStage: ReminderStage,
  confirmedFailure: boolean,
  now: Date,
): Promise<boolean> {
  const deduplicationKey = `automatic_due_reminder:${invoiceId}:${reminderStage}`;
  const [created] = await db
    .insert(notificationDispatchClaimsTable)
    .values({
      deduplicationKey,
      invoiceId,
      reminderStage,
      status: "sending",
    })
    .onConflictDoNothing()
    .returning({ id: notificationDispatchClaimsTable.id });
  if (created) return true;

  const staleBefore = new Date(now.getTime() - UNCERTAIN_CLAIM_LEASE_MS);
  const retryableClaim = confirmedFailure
    ? or(
        eq(notificationDispatchClaimsTable.status, "failed"),
        eq(notificationDispatchClaimsTable.status, "sending"),
      )
    : or(
        eq(notificationDispatchClaimsTable.status, "failed"),
        and(
          eq(notificationDispatchClaimsTable.status, "sending"),
          lt(notificationDispatchClaimsTable.updatedAt, staleBefore),
        ),
      );
  const [retried] = await db
    .update(notificationDispatchClaimsTable)
    .set({ status: "sending", updatedAt: new Date() })
    .where(and(
      eq(notificationDispatchClaimsTable.deduplicationKey, deduplicationKey),
      retryableClaim,
    ))
    .returning({ id: notificationDispatchClaimsTable.id });
  return Boolean(retried);
}

async function completeAutomaticReminderClaim(
  invoiceId: number,
  reminderStage: ReminderStage,
  status: "sent" | "failed",
): Promise<void> {
  await db
    .update(notificationDispatchClaimsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(
      notificationDispatchClaimsTable.deduplicationKey,
      `automatic_due_reminder:${invoiceId}:${reminderStage}`,
    ));
}

export async function runScheduledDueReminders(now = new Date()): Promise<void> {
  const client = await pool.connect();
  let acquiredLock = false;

  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [DAILY_REMINDER_LOCK_ID],
    );
    acquiredLock = lockResult.rows[0]?.acquired ?? false;
    if (!acquiredLock) {
      logger.info("Skipping automatic due reminders because another server is running them");
      return;
    }

    const rows = await db
      .select({ invoice: invoicesTable, guardianPhone: guardiansTable.phone })
      .from(invoicesTable)
      .innerJoin(guardiansTable, and(
        eq(invoicesTable.guardianId, guardiansTable.id),
        eq(invoicesTable.ownerId, guardiansTable.ownerId),
      ))
      .innerJoin(childrenTable, and(
        eq(invoicesTable.childId, childrenTable.id),
        eq(invoicesTable.ownerId, childrenTable.ownerId),
        eq(childrenTable.guardianId, guardiansTable.id),
      ))
      .where(and(
        ne(invoicesTable.status, "paid"),
        ne(invoicesTable.ownerId, "__legacy__"),
      ));

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const { invoice, guardianPhone } of rows) {
      let reminderStage = getReminderStage(invoice, now);
      let confirmedFailure = false;
      if (
        !reminderStage
        && isDueSoonRetryWindow(invoice, now)
      ) {
        confirmedFailure = await automaticReminderStatus(invoice.id, "due_soon", "failed");
        if (confirmedFailure) reminderStage = "due_soon";
      }
      if (!reminderStage) {
        skipped += 1;
        continue;
      }

      if (await automaticReminderStatus(invoice.id, reminderStage, "sent")) {
        await completeAutomaticReminderClaim(invoice.id, reminderStage, "sent");
        skipped += 1;
        continue;
      }
      confirmedFailure ||= await automaticReminderStatus(invoice.id, reminderStage, "failed");
      if (!(await claimAutomaticReminder(invoice.id, reminderStage, confirmedFailure, now))) {
        skipped += 1;
        continue;
      }

      try {
        const result = await sendDueReminder(invoice, { phone: guardianPhone }, {
          source: "automatic",
          reminderStage,
        });
        await completeAutomaticReminderClaim(invoice.id, reminderStage, result.status);
        if (result.status === "sent") sent += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        // WhatsApp Cloud API has no idempotency key for this call. Keep the
        // claim leased for an hour so restarts do not immediately duplicate an
        // accepted message, then allow retry so a pre-send crash cannot lose
        // the reminder forever.
        logger.error(
          { err, invoiceId: invoice.id, reminderStage },
          "Automatic due reminder outcome is uncertain; leaving its claim locked to prevent duplicates",
        );
      }
    }

    logger.info({ checked: rows.length, sent, failed, skipped }, "Automatic due reminder run completed");
  } finally {
    if (acquiredLock) {
      await client.query("SELECT pg_advisory_unlock($1)", [DAILY_REMINDER_LOCK_ID]);
    }
    client.release();
  }
}

function millisecondsUntilNextRun(now = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(SCHEDULE_HOUR_UTC, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startScheduledDueReminders(): void {
  const scheduleNext = () => {
    const timer = setTimeout(() => {
      runScheduledDueReminders()
        .catch((err) => logger.error({ err }, "Automatic due reminder run failed"))
        .finally(scheduleNext);
    }, millisecondsUntilNextRun());
    timer.unref();
  };

  runScheduledDueReminders()
    .catch((err) => logger.error({ err }, "Initial automatic due reminder run failed"));
  scheduleNext();
}