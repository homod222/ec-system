import { describe, expect, it } from "vitest";
import { getReminderStage, isDueSoonRetryWindow } from "./dueReminderEligibility";

describe("due reminder eligibility", () => {
  it("allows a new due-soon reminder exactly three Kuwait calendar days before", () => {
    const now = new Date("2026-08-26T21:30:00.000Z"); // 2026-08-27 in Kuwait

    expect(getReminderStage({ dueDate: "2026-08-30", status: "pending" }, now)).toBe("due_soon");
    expect(getReminderStage({ dueDate: "2026-08-29", status: "pending" }, now)).toBeNull();
    expect(getReminderStage({ dueDate: "2026-08-31", status: "pending" }, now)).toBeNull();
  });

  it("allows failed due-soon reminders to retry through the due date only", () => {
    const now = new Date("2026-08-27T08:00:00.000Z");

    expect(isDueSoonRetryWindow({ dueDate: "2026-08-29", status: "pending" }, now)).toBe(true);
    expect(isDueSoonRetryWindow({ dueDate: "2026-08-27", status: "pending" }, now)).toBe(true);
    expect(isDueSoonRetryWindow({ dueDate: "2026-08-30", status: "pending" }, now)).toBe(false);
    expect(isDueSoonRetryWindow({ dueDate: "2026-08-26", status: "pending" }, now)).toBe(false);
  });

  it("never allows due or retry reminders for paid invoices", () => {
    const now = new Date("2026-08-27T08:00:00.000Z");

    expect(getReminderStage({ dueDate: "2026-08-30", status: "paid" }, now)).toBeNull();
    expect(isDueSoonRetryWindow({ dueDate: "2026-08-29", status: "paid" }, now)).toBe(false);
  });
});