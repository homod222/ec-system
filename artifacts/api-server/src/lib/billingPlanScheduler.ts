import { generateDueBillingInstallments } from "./billingPlans";
import { logger } from "./logger";

export function kuwaitToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function run(): Promise<void> {
  const generated = await generateDueBillingInstallments(kuwaitToday());
  logger.info({ generated }, "Scheduled billing installment generation completed");
}

function millisecondsUntilNextKuwaitRun(now = new Date()): number {
  const [year, month, day] = kuwaitToday(now).split("-").map(Number);
  // Kuwait is UTC+3 year-round. Run shortly after the next local midnight.
  const next = Date.UTC(year!, month! - 1, day! + 1, -3, 5);
  return Math.max(1_000, next - now.getTime());
}

export function startBillingPlanScheduler(): void {
  run().catch((error) => logger.error({ error }, "Initial billing installment generation failed"));
  const schedule = () => {
    const timer = setTimeout(() => {
      run()
        .catch((error) => logger.error({ error }, "Scheduled billing installment generation failed"))
        .finally(schedule);
    }, millisecondsUntilNextKuwaitRun());
    timer.unref();
  };
  schedule();
}