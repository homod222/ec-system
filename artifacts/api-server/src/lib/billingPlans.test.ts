import { describe, expect, it } from "vitest";
import { addCalendarMonths, computeBillingSchedule, distributeKwd } from "./billingPlans";

describe("billing schedule math", () => {
  it("distributes KWD to three decimals with the remainder in the final installment", () => {
    expect(distributeKwd(10, 3)).toEqual([3.333, 3.333, 3.334]);
    expect(distributeKwd(0.002, 2)).toEqual([0.001, 0.001]);
  });

  it("rejects a count that would create zero-fils installments", () => {
    expect(() => computeBillingSchedule({
      cadence: "monthly",
      netAmount: 0.002,
      installmentCount: 3,
      startDate: new Date("2025-01-01T00:00:00Z"),
      issueLeadDays: 0,
    })).toThrow(/exceed the total amount in fils/);
  });

  it("rejects a zero-value custom installment", () => {
    expect(() => computeBillingSchedule({
      cadence: "custom",
      netAmount: 1,
      installmentCount: 2,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      issueLeadDays: 0,
      customInstallments: [
        { amount: 0, dueDate: new Date("2026-01-01T00:00:00.000Z") },
        { amount: 1, dueDate: new Date("2026-02-01T00:00:00.000Z") },
      ],
    })).toThrow(/at least 0.001 KWD/);
  });

  it("clamps recurring dates to calendar month ends", () => {
    expect(addCalendarMonths(new Date("2025-01-31T00:00:00Z"), 1).toISOString().slice(0, 10))
      .toBe("2025-02-28");
    const schedule = computeBillingSchedule({
      cadence: "quarterly",
      netAmount: 2,
      installmentCount: 2,
      startDate: new Date("2025-11-30T00:00:00Z"),
      issueLeadDays: 7,
    });
    expect(schedule.map((item) => item.dueDate)).toEqual(["2025-11-30", "2026-02-28"]);
    expect(schedule[0]?.issueDate).toBe("2025-11-23");
  });

  it("rejects invalid custom totals, ordering, and issue dates", () => {
    expect(() => computeBillingSchedule({
      cadence: "custom",
      netAmount: 3,
      installmentCount: 2,
      startDate: new Date("2025-01-01"),
      issueLeadDays: 0,
      customInstallments: [
        { amount: 1, dueDate: new Date("2025-02-01") },
        { amount: 1, dueDate: new Date("2025-03-01") },
      ],
    })).toThrow(/net amount/);
    expect(() => computeBillingSchedule({
      cadence: "custom",
      netAmount: 2,
      installmentCount: 2,
      startDate: new Date("2025-01-01"),
      issueLeadDays: 0,
      customInstallments: [
        { amount: 1, dueDate: new Date("2025-03-01") },
        { amount: 1, dueDate: new Date("2025-02-01") },
      ],
    })).toThrow(/strictly increasing/);
  });
});