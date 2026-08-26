import type { Invoice } from "@workspace/db";

type ReminderStage = "due_soon" | "overdue";

const DAY_MS = 24 * 60 * 60 * 1000;
const KUWAIT_TIME_ZONE = "Asia/Kuwait";

function dateInKuwait(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KUWAIT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dateValue(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function daysUntilDue(invoice: Pick<Invoice, "dueDate">, now: Date): number {
  return (dateValue(invoice.dueDate) - dateValue(dateInKuwait(now))) / DAY_MS;
}

export function getReminderStage(
  invoice: Pick<Invoice, "dueDate" | "status">,
  now = new Date(),
): ReminderStage | null {
  if (invoice.status === "paid") return null;

  const days = daysUntilDue(invoice, now);
  if (days === 3) return "due_soon";
  if (days < 0) return "overdue";
  return null;
}

export function isDueSoonRetryWindow(
  invoice: Pick<Invoice, "dueDate" | "status">,
  now = new Date(),
): boolean {
  if (invoice.status === "paid") return false;
  const days = daysUntilDue(invoice, now);
  return days >= 0 && days < 3;
}