import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  billingInstallmentsTable,
  billingPlansTable,
  auditLogsTable,
  childrenTable,
  db,
  guardiansTable,
  invoiceLinesTable,
  invoicePaymentsTable,
  invoiceRefundsTable,
  invoicesTable,
  pool,
} from "@workspace/db";
import { branchCondition, type BranchScope } from "./branchScope";

export type ScheduleItem = {
  sequence: number;
  amount: number;
  issueDate: string;
  dueDate: string;
};

type CustomInstallment = { amount: number; dueDate: Date; issueDate?: Date | null };

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const fils = (amount: number) => Math.round(amount * 1_000);
const kuwaitDateOnly = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

function shiftDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

/** Adds calendar months while retaining the requested day, clamped to month end. */
export function addCalendarMonths(value: Date, months: number): Date {
  const day = value.getUTCDate();
  const result = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
  const monthEnd = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, monthEnd));
  return result;
}

/** Distributes integer fils exactly; any indivisible remainder is put in the final installment. */
export function distributeKwd(amount: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || !Number.isSafeInteger(fils(amount)) || amount <= 0) {
    throw new Error("Invalid installment amount or count");
  }
  const total = fils(amount);
  if (count > total) {
    throw new Error("Installment count cannot exceed the total amount in fils");
  }
  const regular = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) =>
    (index === count - 1 ? total - regular * (count - 1) : regular) / 1_000);
}

export function computeBillingSchedule(input: {
  cadence: "once" | "monthly" | "quarterly" | "custom";
  netAmount: number;
  installmentCount: number;
  startDate: Date;
  issueLeadDays: number;
  customInstallments?: CustomInstallment[];
}): ScheduleItem[] {
  if (!Number.isInteger(input.installmentCount) || input.installmentCount < 1
      || !Number.isInteger(input.issueLeadDays) || input.issueLeadDays < 0) {
    throw new Error("Installment count and issue lead days must be whole non-negative values");
  }
  const totalFils = fils(input.netAmount);
  if (!Number.isSafeInteger(totalFils) || totalFils < 1 || input.installmentCount > totalFils) {
    throw new Error("Installment count cannot exceed the total amount in fils");
  }
  if (input.cadence === "once" && input.installmentCount !== 1) {
    throw new Error("A once plan must contain exactly one installment");
  }
  if (input.cadence === "custom") {
    const custom = input.customInstallments;
    if (!custom?.length || custom.length !== input.installmentCount) {
      throw new Error("Custom installments must match installmentCount");
    }
    if (custom.some((item) => fils(item.amount) < 1)) {
      throw new Error("Every custom installment must be at least 0.001 KWD");
    }
    if (custom.reduce((sum, item) => sum + fils(item.amount), 0) !== fils(input.netAmount)) {
      throw new Error("Custom installment amounts must equal the plan net amount");
    }
    let previousDue = "";
    return custom.map((item, index) => {
      const dueDate = dateOnly(item.dueDate);
      const issueDate = item.issueDate
        ? dateOnly(item.issueDate)
        : shiftDays(dueDate, -input.issueLeadDays);
      if (dueDate < dateOnly(input.startDate)) {
        throw new Error("Custom due dates cannot precede the plan start date");
      }
      if (dueDate <= previousDue) throw new Error("Custom due dates must be strictly increasing");
      if (issueDate > dueDate) throw new Error("An installment issue date cannot follow its due date");
      previousDue = dueDate;
      return { sequence: index + 1, amount: fils(item.amount) / 1_000, issueDate, dueDate };
    });
  }
  if (input.customInstallments?.length) {
    throw new Error("customInstallments are only valid for custom cadence");
  }
  const amounts = distributeKwd(input.netAmount, input.installmentCount);
  const step = input.cadence === "quarterly" ? 3 : input.cadence === "monthly" ? 1 : 0;
  return amounts.map((amount, index) => {
    const dueDate = dateOnly(addCalendarMonths(input.startDate, index * step));
    return {
      sequence: index + 1,
      amount,
      dueDate,
      issueDate: shiftDays(dueDate, -input.issueLeadDays),
    };
  });
}

export async function billingPlanDetails(
  ownerId: string,
  guardianId?: number,
  branchIds: BranchScope = null,
) {
  const plans = await db.select({
    plan: billingPlansTable,
    firstName: childrenTable.firstName,
    lastName: childrenTable.lastName,
    guardianName: guardiansTable.name,
  }).from(billingPlansTable)
    .innerJoin(childrenTable, and(
      eq(childrenTable.id, billingPlansTable.childId),
      eq(childrenTable.ownerId, ownerId),
      branchCondition(childrenTable.branchId, branchIds),
    ))
    .innerJoin(guardiansTable, and(
      eq(guardiansTable.id, billingPlansTable.guardianId),
      eq(guardiansTable.ownerId, ownerId),
      branchCondition(guardiansTable.branchId, branchIds),
    ))
    .where(and(
      eq(billingPlansTable.ownerId, ownerId),
      guardianId ? eq(billingPlansTable.guardianId, guardianId) : undefined,
    ))
    .orderBy(asc(billingPlansTable.createdAt));
  if (!plans.length) return [];
  const installments = await db.select({
    installment: billingInstallmentsTable,
    invoiceNumber: invoicesTable.invoiceNumber,
    invoiceStatus: invoicesTable.status,
  }).from(billingInstallmentsTable)
    .leftJoin(invoicesTable, and(
      eq(invoicesTable.id, billingInstallmentsTable.invoiceId),
      eq(invoicesTable.ownerId, ownerId),
    ))
    .where(and(
      eq(billingInstallmentsTable.ownerId, ownerId),
      inArray(billingInstallmentsTable.planId, plans.map(({ plan }) => plan.id)),
    ))
    .orderBy(asc(billingInstallmentsTable.sequence));
  const invoiceIds = installments
    .map(({ installment }) => installment.invoiceId)
    .filter((id): id is number => id !== null);
  const [payments, refunds] = invoiceIds.length ? await Promise.all([
    db.select().from(invoicePaymentsTable).where(and(
      eq(invoicePaymentsTable.ownerId, ownerId),
      inArray(invoicePaymentsTable.invoiceId, invoiceIds),
      inArray(invoicePaymentsTable.status, ["completed", "succeeded"]),
    )),
    db.select().from(invoiceRefundsTable).where(and(
      eq(invoiceRefundsTable.ownerId, ownerId),
      inArray(invoiceRefundsTable.invoiceId, invoiceIds),
    )),
  ]) : [[], []];
  const today = kuwaitDateOnly();
  return plans.map(({ plan, firstName, lastName, guardianName }) => {
    const rows = installments.filter(({ installment }) => installment.planId === plan.id);
    const normalized = rows.map(({ installment, invoiceNumber, invoiceStatus }) => ({
      id: installment.id,
      sequence: installment.sequence,
      amount: installment.amount,
      issueDate: installment.issueDate,
      dueDate: installment.dueDate,
      status: invoiceStatus === "paid" ? "paid"
        : invoiceStatus === "partial" ? "partial"
          : invoiceStatus === "cancelled" ? "cancelled"
            : installment.status === "issued" && installment.dueDate < today ? "overdue"
              : installment.status,
      invoiceId: installment.invoiceId,
      invoiceNumber,
    }));
    const planInvoiceIds = new Set(normalized.map((item) => item.invoiceId).filter((id): id is number => id !== null));
    const collectedFils = payments
      .filter((payment) => planInvoiceIds.has(payment.invoiceId))
      .reduce((sum, payment) => sum + fils(payment.amount), 0)
      - refunds
        .filter((refund) => planInvoiceIds.has(refund.invoiceId))
        .reduce((sum, refund) => sum + fils(refund.amount), 0);
    const collectedAmount = Math.max(0, collectedFils / 1_000);
    const { ownerId: _ownerId, guardianId: _guardianId, createdBy: _createdBy, ...data } = plan;
    return {
      ...data,
      childName: `${firstName} ${lastName}`,
      guardianName,
      collectedAmount,
      remainingAmount: Math.max(0, Math.round((plan.netAmount - collectedAmount) * 1_000) / 1_000),
      installments: normalized,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  });
}

export async function refreshBillingProgressForInvoice(invoiceId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [invoiceReference] = await tx.select({
      billingPlanId: invoicesTable.billingPlanId,
      ownerId: invoicesTable.ownerId,
    }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoiceReference?.billingPlanId) return;
    // All plan mutations lock this row first. Lock it before its invoice or
    // installment so a status change cannot commit between our checks.
    await tx.execute(sql`
      select id from billing_plans
      where id = ${invoiceReference.billingPlanId} and owner_id = ${invoiceReference.ownerId}
      for update
    `);
    const [invoice] = await tx.select().from(invoicesTable).where(and(
      eq(invoicesTable.id, invoiceId),
      eq(invoicesTable.ownerId, invoiceReference.ownerId),
    ));
    if (!invoice?.installmentId || !invoice.billingPlanId) return;
    const [plan] = await tx.select().from(billingPlansTable).where(and(
      eq(billingPlansTable.id, invoice.billingPlanId),
      eq(billingPlansTable.ownerId, invoice.ownerId),
    ));
    if (!plan) return;
    await tx.execute(sql`
      select id from billing_installments
      where id = ${invoice.installmentId} and owner_id = ${invoice.ownerId}
      for update
    `);
    const installmentStatus = invoice.status === "paid" ? "paid"
      : invoice.status === "partial" ? "partial"
        : invoice.status === "overdue" ? "overdue"
          : invoice.status === "cancelled" ? "cancelled" : "issued";
    await tx.update(billingInstallmentsTable).set({ status: installmentStatus })
      .where(and(
        eq(billingInstallmentsTable.id, invoice.installmentId!),
        eq(billingInstallmentsTable.ownerId, invoice.ownerId),
      ));
    const rows = await tx.select({ status: billingInstallmentsTable.status })
      .from(billingInstallmentsTable)
      .where(and(
        eq(billingInstallmentsTable.planId, invoice.billingPlanId!),
        eq(billingInstallmentsTable.ownerId, invoice.ownerId),
      ));
    const allPaid = rows.length > 0 && rows.every((row) => row.status === "paid");
    if (allPaid && plan.status === "active") {
      const [completed] = await tx.update(billingPlansTable).set({ status: "completed", updatedAt: new Date() })
        .where(and(
          eq(billingPlansTable.id, invoice.billingPlanId!),
          eq(billingPlansTable.ownerId, invoice.ownerId),
          eq(billingPlansTable.status, "active"),
        )).returning();
      if (completed) {
        await tx.insert(auditLogsTable).values({
          ownerId: invoice.ownerId,
          actorId: "billing-progress",
          actorRole: "system",
          operation: "complete",
          entityType: "billing-plan",
          entityId: String(completed.id),
          before: { status: "active" },
          after: { status: "completed" },
        });
      }
    } else if (!allPaid && plan.status === "completed") {
      const [reactivated] = await tx.update(billingPlansTable).set({ status: "active", updatedAt: new Date() })
        .where(and(
          eq(billingPlansTable.id, invoice.billingPlanId),
          eq(billingPlansTable.ownerId, invoice.ownerId),
          eq(billingPlansTable.status, "completed"),
        )).returning();
      if (reactivated) {
        await tx.insert(auditLogsTable).values({
          ownerId: invoice.ownerId,
          actorId: "billing-progress",
          actorRole: "system",
          operation: "reopen",
          entityType: "billing-plan",
          entityId: String(reactivated.id),
          before: { status: "completed" },
          after: { status: "active" },
        });
      }
    }
  });
}

export async function generateBillingInstallment(
  installmentId: number,
  ownerId?: string,
  actor: { id: string; role: string } = { id: "billing-scheduler", role: "system" },
) {
  return db.transaction(async (tx) => {
    // Find the parent without locking the child, then serialize all plan
    // changes through the parent row before locking/re-reading the child.
    const [reference] = await tx.select({
      planId: billingInstallmentsTable.planId,
      ownerId: billingInstallmentsTable.ownerId,
    }).from(billingInstallmentsTable).where(and(
      eq(billingInstallmentsTable.id, installmentId),
      ownerId ? eq(billingInstallmentsTable.ownerId, ownerId) : undefined,
    ));
    if (!reference) return { kind: "missing" as const };
    await tx.execute(sql`
      select id from billing_plans
      where id = ${reference.planId} and owner_id = ${reference.ownerId}
      for update
    `);
    await tx.execute(sql`
      select id from billing_installments
      where id = ${installmentId} and owner_id = ${reference.ownerId}
      for update
    `);
    const [item] = await tx.select().from(billingInstallmentsTable).where(and(
      eq(billingInstallmentsTable.id, installmentId),
      eq(billingInstallmentsTable.ownerId, reference.ownerId),
    ));
    if (!item) return { kind: "missing" as const };
    if (item.invoiceId) {
      return { kind: "generated" as const, planId: item.planId, installmentId: item.id, invoiceId: item.invoiceId, generated: false };
    }
    if (item.status !== "scheduled") return { kind: "missing" as const };
    const [plan] = await tx.select().from(billingPlansTable).where(and(
      eq(billingPlansTable.id, item.planId),
      eq(billingPlansTable.ownerId, item.ownerId),
    ));
    if (!plan) return { kind: "missing" as const };
    if (plan.status !== "active") return { kind: "inactive" as const };
    const [child] = await tx.select({ branchId: childrenTable.branchId })
      .from(childrenTable)
      .where(and(
        eq(childrenTable.id, plan.childId),
        eq(childrenTable.ownerId, plan.ownerId),
      ));
    const now = new Date();
    const [invoice] = await tx.insert(invoicesTable).values({
      ownerId: plan.ownerId,
      branchId: child?.branchId ?? null,
      invoiceNumber: `INV-${dateOnly(now).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      guardianId: plan.guardianId,
      childId: plan.childId,
      amount: item.amount,
      dueDate: item.dueDate,
      status: "issued",
      issuedAt: now,
      billingPlanId: plan.id,
      installmentId: item.id,
    }).returning();
    await tx.insert(invoiceLinesTable).values({
      ownerId: plan.ownerId,
      invoiceId: invoice.id,
      type: "fee",
      description: `${plan.title} (${item.sequence}/${plan.installmentCount})`,
      quantity: 1,
      unitAmount: item.amount,
      amount: item.amount,
    });
    await tx.update(billingInstallmentsTable).set({
      status: "issued",
      invoiceId: invoice.id,
      generatedAt: now,
    }).where(and(
      eq(billingInstallmentsTable.id, item.id),
      eq(billingInstallmentsTable.ownerId, item.ownerId),
    ));
    await tx.insert(auditLogsTable).values({
      ownerId: plan.ownerId,
      actorId: actor.id,
      actorRole: actor.role,
      operation: "generate-installment",
      entityType: "billing-plan",
      entityId: String(plan.id),
      before: null,
      after: { installmentId: item.id, invoiceId: invoice.id },
    });
    return { kind: "generated" as const, planId: plan.id, installmentId: item.id, invoiceId: invoice.id, generated: true };
  });
}

export async function generateDueBillingInstallments(today: string): Promise<number> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>("select pg_try_advisory_lock($1) as acquired", [16002026]);
    if (!lock.rows[0]?.acquired) return 0;
    const due = await db.select({ id: billingInstallmentsTable.id })
      .from(billingInstallmentsTable)
      .innerJoin(billingPlansTable, and(
        eq(billingPlansTable.id, billingInstallmentsTable.planId),
        eq(billingPlansTable.ownerId, billingInstallmentsTable.ownerId),
        eq(billingPlansTable.status, "active"),
      ))
      .where(and(
        eq(billingInstallmentsTable.status, "scheduled"),
        lte(billingInstallmentsTable.issueDate, today),
      ))
      .orderBy(asc(billingInstallmentsTable.issueDate), asc(billingInstallmentsTable.sequence));
    let generated = 0;
    for (const item of due) {
      const result = await generateBillingInstallment(item.id);
      if (result.kind === "generated" && result.generated) generated += 1;
    }
    return generated;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [16002026]).catch(() => undefined);
    client.release();
  }
}