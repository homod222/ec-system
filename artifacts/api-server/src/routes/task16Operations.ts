import { randomUUID } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getLocalAuth } from "../lib/localAuth";
import {
  CancelInvoiceBody, CancelInvoiceParams, CancelInvoiceResponse,
  CreateChildContactBody, CreateChildContactParams, CreateChildContactResponse,
  CreateInvoiceBody, CreateInvoiceResponse, CreateStaffBody, CreateStaffResponse,
  DeleteStaffParams, GetInvoiceParams, GetInvoiceResponse,
  GetNurserySettingsResponse, ListAttendanceHistoryQueryParams, ListAttendanceHistoryResponse,
  ListChildContactsParams, ListChildContactsResponse, ListParentDocumentsResponse,
  ListParentReceiptsResponse, RecordInvoicePaymentBody, RecordInvoicePaymentParams,
  RecordInvoicePaymentResponse, RefundInvoicePaymentBody, RefundInvoicePaymentParams,
  RefundInvoicePaymentResponse, SetNurserySettingsBody, SetNurserySettingsResponse,
  UpdateStaffBody, UpdateStaffParams, UpdateStaffResponse,
  RecordCashInvoicePaymentBody, RecordCashInvoicePaymentParams, RecordCashInvoicePaymentResponse,
  GetParentDocumentContentParams,
  CreateBillingPlanBody, CreateBillingPlanResponse,
  GenerateNextBillingInstallmentParams, GenerateNextBillingInstallmentResponse,
  ListBillingPlansResponse, ListParentBillingPlansResponse,
  UpdateBillingPlanStatusBody, UpdateBillingPlanStatusParams, UpdateBillingPlanStatusResponse,
} from "@workspace/api-zod";
import {
  applicationDocumentsTable, attendanceTable, childContactsTable, childrenTable, db,
  guardiansTable, invoiceLinesTable, invoicePaymentsTable, invoiceReceiptsTable,
  invoiceRefundsTable, invoicesTable, nurserySettingsTable, staffTable,
  billingInstallmentsTable, billingPlansTable,
} from "@workspace/db";
import {
  auditNurseryOperation, nurseryContext, requireNurseryPermission, resolveNurseryContext,
} from "./nurseryOperations";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { resolveBranchId } from "../lib/branchScope";
import {
  billingPlanDetails,
  computeBillingSchedule,
  generateBillingInstallment,
  refreshBillingProgressForInvoice,
} from "../lib/billingPlans";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const DEFAULT_REGISTRATION_WHATSAPP = "96590916677";

function normalizeRegistrationWhatsApp(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("965") ? digits : `965${digits}`;
}

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getLocalAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

router.use(requireAuth, resolveNurseryContext);

router.get("/billing-plans", requireNurseryPermission("read:invoice"), async (req, res) => {
  const rows = await billingPlanDetails(nurseryContext(req).ownerId);
  res.json(ListBillingPlansResponse.parse(rows));
});

router.post("/billing-plans", requireNurseryPermission("write:invoice"), async (req, res) => {
  const body = CreateBillingPlanBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });
  const { ownerId, actorId } = nurseryContext(req);
  const child = await ownedChild(ownerId, body.data.childId);
  if (!child) return void res.status(404).json({ error: "Child not found" });
  if (body.data.discountAmount >= body.data.totalAmount) {
    return void res.status(400).json({ error: "Discount must be less than total amount" });
  }
  const netAmount = Math.round((body.data.totalAmount - body.data.discountAmount) * 1_000) / 1_000;
  let schedule;
  try {
    schedule = computeBillingSchedule({
      cadence: body.data.cadence,
      netAmount,
      installmentCount: body.data.installmentCount,
      startDate: body.data.startDate,
      issueLeadDays: body.data.issueLeadDays,
      customInstallments: body.data.customInstallments,
    });
  } catch (error) {
    return void res.status(400).json({ error: error instanceof Error ? error.message : "Invalid schedule" });
  }
  const plan = await db.transaction(async (tx) => {
    // Serialize plan creation against child deletion. If creation wins, the
    // deletion route will see the plan and preserve the financial history.
    await tx.execute(sql`
      select id from children
      where id = ${child.id} and owner_id = ${ownerId}
      for update
    `);
    const [lockedChild] = await tx.select().from(childrenTable).where(and(
      eq(childrenTable.id, child.id),
      eq(childrenTable.ownerId, ownerId),
    ));
    if (!lockedChild) return null;
    const [created] = await tx.insert(billingPlansTable).values({
      ownerId,
      childId: lockedChild.id,
      guardianId: lockedChild.guardianId,
      title: body.data.title,
      cadence: body.data.cadence,
      totalAmount: body.data.totalAmount,
      discountAmount: body.data.discountAmount,
      netAmount,
      installmentCount: schedule.length,
      issueLeadDays: body.data.issueLeadDays,
      status: "active",
      createdBy: actorId,
    }).returning();
    await tx.insert(billingInstallmentsTable).values(schedule.map((item) => ({
      ownerId,
      planId: created.id,
      ...item,
      status: "scheduled",
    })));
    return created;
  });
  if (!plan) return void res.status(409).json({ error: "Child was removed before the billing plan could be created" });
  await auditNurseryOperation(req, "create", "billing-plan", String(plan.id), null, plan as unknown as Record<string, unknown>);
  const createdDetail = (await billingPlanDetails(ownerId)).find((item) => item.id === plan.id);
  if (!createdDetail) throw new Error("Created billing plan could not be loaded");
  res.status(201).json(CreateBillingPlanResponse.parse(createdDetail));
});

router.patch("/billing-plans/:id/status", requireNurseryPermission("write:invoice"), async (req, res) => {
  const params = UpdateBillingPlanStatusParams.safeParse(req.params);
  const body = UpdateBillingPlanStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return void res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
  }
  const { ownerId } = nurseryContext(req);
  const transition = await db.transaction(async (tx) => {
    // Generation takes this same parent-row lock before it locks an
    // installment, so status changes and issuance are serialized.
    await tx.execute(sql`
      select id from billing_plans
      where id = ${params.data.id} and owner_id = ${ownerId}
      for update
    `);
    const [before] = await tx.select().from(billingPlansTable).where(and(
      eq(billingPlansTable.id, params.data.id),
      eq(billingPlansTable.ownerId, ownerId),
    ));
    if (!before) return { kind: "missing" as const };
    const allowed = (before.status === "active" && ["paused", "cancelled"].includes(body.data.status))
      || (before.status === "paused" && ["active", "cancelled"].includes(body.data.status));
    if (!allowed) return { kind: "invalid" as const };
    let nextStatus: "active" | "paused" | "completed" | "cancelled" = body.data.status;
    if (before.status === "paused" && body.data.status === "active") {
      const installments = await tx.select({ status: billingInstallmentsTable.status })
        .from(billingInstallmentsTable)
        .where(and(
          eq(billingInstallmentsTable.planId, before.id),
          eq(billingInstallmentsTable.ownerId, ownerId),
        ));
      if (installments.length > 0 && installments.every((item) => item.status === "paid")) {
        nextStatus = "completed";
      }
    }
    const [row] = await tx.update(billingPlansTable).set({
      status: nextStatus,
      updatedAt: new Date(),
    }).where(and(
      eq(billingPlansTable.id, before.id),
      eq(billingPlansTable.ownerId, ownerId),
      eq(billingPlansTable.status, before.status),
    )).returning();
    if (!row) return { kind: "changed" as const };
    if (nextStatus === "cancelled") {
      await tx.update(billingInstallmentsTable).set({ status: "cancelled" }).where(and(
        eq(billingInstallmentsTable.planId, row.id),
        eq(billingInstallmentsTable.ownerId, ownerId),
        eq(billingInstallmentsTable.status, "scheduled"),
      ));
    }
    return { kind: "updated" as const, before, row };
  });
  if (transition.kind === "missing") return void res.status(404).json({ error: "Billing plan not found" });
  if (transition.kind === "invalid") return void res.status(409).json({ error: "Invalid billing plan status transition" });
  if (transition.kind === "changed") return void res.status(409).json({ error: "Billing plan changed concurrently" });
  await auditNurseryOperation(req, body.data.status, "billing-plan", String(transition.row.id),
    transition.before as unknown as Record<string, unknown>, transition.row as unknown as Record<string, unknown>);
  const detail = (await billingPlanDetails(ownerId)).find((item) => item.id === transition.row.id);
  res.json(UpdateBillingPlanStatusResponse.parse(detail));
});

router.post("/billing-plans/:id/generate-next", requireNurseryPermission("write:invoice"), async (req, res) => {
  const params = GenerateNextBillingInstallmentParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: params.error.message });
  const { ownerId, actorId, role } = nurseryContext(req);
  const [plan] = await db.select().from(billingPlansTable).where(and(
    eq(billingPlansTable.id, params.data.id),
    eq(billingPlansTable.ownerId, ownerId),
  ));
  if (!plan) return void res.status(404).json({ error: "Billing plan not found" });
  if (plan.status !== "active") return void res.status(409).json({ error: "Billing plan is not active" });
  const [next] = await db.select().from(billingInstallmentsTable).where(and(
    eq(billingInstallmentsTable.planId, plan.id),
    eq(billingInstallmentsTable.ownerId, ownerId),
    eq(billingInstallmentsTable.status, "scheduled"),
  )).orderBy(billingInstallmentsTable.sequence).limit(1);
  if (!next) return void res.status(404).json({ error: "No scheduled installment found" });
  const result = await generateBillingInstallment(next.id, ownerId, { id: actorId, role });
  if (result.kind === "inactive") return void res.status(409).json({ error: "Billing plan is not active" });
  if (result.kind === "missing") return void res.status(404).json({ error: "Installment not found" });
  res.json(GenerateNextBillingInstallmentResponse.parse(result));
});

const serializeContact = (row: typeof childContactsTable.$inferSelect) => {
  const { ownerId: _, createdAt, updatedAt, ...data } = row;
  return { ...data, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
};

async function ownedChild(ownerId: string, id: number) {
  const [child] = await db.select().from(childrenTable).where(and(
    eq(childrenTable.ownerId, ownerId), eq(childrenTable.id, id),
  ));
  return child;
}

router.get("/children/:id/contacts", requireNurseryPermission("read:child-record"), async (req, res) => {
  const params = ListChildContactsParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: params.error.message });
  const { ownerId } = nurseryContext(req);
  if (!await ownedChild(ownerId, params.data.id)) return void res.status(404).json({ error: "Child not found" });
  const rows = await db.select().from(childContactsTable).where(and(
    eq(childContactsTable.ownerId, ownerId), eq(childContactsTable.childId, params.data.id),
  )).orderBy(desc(childContactsTable.createdAt));
  res.json(ListChildContactsResponse.parse(rows.map(serializeContact)));
});

router.post("/children/:id/contacts", requireNurseryPermission("write:children"), async (req, res) => {
  const params = CreateChildContactParams.safeParse(req.params);
  const body = CreateChildContactBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return void res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
  }
  const { ownerId, actorId } = nurseryContext(req);
  if (!await ownedChild(ownerId, params.data.id)) return void res.status(404).json({ error: "Child not found" });
  const [row] = await db.insert(childContactsTable).values({
    ownerId, childId: params.data.id, createdBy: actorId, ...body.data,
    relationship: body.data.relationship ?? null, phone: body.data.phone ?? null,
    email: body.data.email ?? null, identityNumber: body.data.identityNumber ?? null,
    data: body.data.data ?? {},
  }).returning();
  await auditNurseryOperation(req, "create", `child-${row.type}`, String(row.id), null, row as unknown as Record<string, unknown>);
  res.status(201).json(CreateChildContactResponse.parse(serializeContact(row)));
});

router.get("/attendance/history", requireNurseryPermission("read:attendance"), async (req, res) => {
  const query = ListAttendanceHistoryQueryParams.safeParse(req.query);
  if (!query.success) return void res.status(400).json({ error: query.error.message });
  const { ownerId } = nurseryContext(req);
  const rows = await db.select({ attendance: attendanceTable, child: childrenTable })
    .from(attendanceTable).innerJoin(childrenTable, and(
      eq(attendanceTable.childId, childrenTable.id), eq(childrenTable.ownerId, ownerId),
    )).where(and(
      query.data.childId ? eq(attendanceTable.childId, query.data.childId) : undefined,
      query.data.dateFrom ? gte(attendanceTable.date, query.data.dateFrom) : undefined,
      query.data.dateTo ? lte(attendanceTable.date, query.data.dateTo) : undefined,
    )).orderBy(desc(attendanceTable.date));
  res.json(ListAttendanceHistoryResponse.parse(rows.map(({ attendance, child }) => ({
    ...attendance, childName: `${child.firstName} ${child.lastName}`,
    correctedAt: attendance.correctedAt?.toISOString() ?? null,
  }))));
});

const staffResponse = (row: typeof staffTable.$inferSelect) => ({
  ...row, attendanceRate: row.status === "present" ? 100 : 0,
});

router.post("/staff", requireNurseryPermission("write:staff-profile"), async (req, res) => {
  const body = CreateStaffBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });
  const ownerId = nurseryContext(req).ownerId;
  const branch = await resolveBranchId(db, ownerId, body.data.branchId);
  if (branch.kind === "missing") return void res.status(400).json({ error: "Branch not found" });
  const [row] = await db.insert(staffTable).values({
    ownerId, ...body.data, branchId: branch.branchId,
    email: body.data.email ?? null, jobTitle: body.data.jobTitle ?? null, hireDate: body.data.hireDate ?? null,
  }).returning();
  await auditNurseryOperation(req, "create", "staff", String(row.id), null, row as unknown as Record<string, unknown>);
  res.status(201).json(CreateStaffResponse.parse(staffResponse(row)));
});

router.patch("/staff/:id", requireNurseryPermission("write:staff-profile"), async (req, res) => {
  const params = UpdateStaffParams.safeParse(req.params);
  const body = UpdateStaffBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
  const [before] = await db.select().from(staffTable).where(and(eq(staffTable.id, params.data.id), eq(staffTable.ownerId, nurseryContext(req).ownerId)));
  if (!before) return void res.status(404).json({ error: "Staff member not found" });
  const branch = await resolveBranchId(db, before.ownerId, body.data.branchId);
  if (branch.kind === "missing") return void res.status(400).json({ error: "Branch not found" });
  const [row] = await db.update(staffTable).set({
    ...body.data,
    branchId: branch.branchId,
  }).where(eq(staffTable.id, before.id)).returning();
  await auditNurseryOperation(req, "update", "staff", String(row.id), before as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>);
  res.json(UpdateStaffResponse.parse(staffResponse(row)));
});

router.delete("/staff/:id", requireNurseryPermission("delete:staff-profile"), async (req, res) => {
  const params = DeleteStaffParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: params.error.message });
  const [row] = await db.delete(staffTable).where(and(eq(staffTable.id, params.data.id), eq(staffTable.ownerId, nurseryContext(req).ownerId))).returning();
  if (!row) return void res.status(404).json({ error: "Staff member not found" });
  await auditNurseryOperation(req, "delete", "staff", String(row.id), row as unknown as Record<string, unknown>, null);
  res.sendStatus(204);
});

async function invoiceDetail(ownerId: string, id: number) {
  const [joined] = await db.select({
    invoice: invoicesTable, guardianName: guardiansTable.name,
    firstName: childrenTable.firstName, lastName: childrenTable.lastName,
  }).from(invoicesTable)
    .innerJoin(childrenTable, and(eq(invoicesTable.childId, childrenTable.id), eq(childrenTable.ownerId, ownerId)))
    .innerJoin(guardiansTable, and(eq(invoicesTable.guardianId, guardiansTable.id), eq(guardiansTable.ownerId, ownerId)))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.ownerId, ownerId)));
  if (!joined) return null;
  const [lines, payments, refunds] = await Promise.all([
    db.select().from(invoiceLinesTable).where(and(eq(invoiceLinesTable.ownerId, ownerId), eq(invoiceLinesTable.invoiceId, id))),
    db.select().from(invoicePaymentsTable).where(and(eq(invoicePaymentsTable.ownerId, ownerId), eq(invoicePaymentsTable.invoiceId, id), inArray(invoicePaymentsTable.status, ["completed", "succeeded"]))),
    db.select().from(invoiceRefundsTable).where(and(eq(invoiceRefundsTable.ownerId, ownerId), eq(invoiceRefundsTable.invoiceId, id))),
  ]);
  const paidAmount = payments.reduce((sum, row) => sum + row.amount, 0);
  const refundedAmount = refunds.reduce((sum, row) => sum + row.amount, 0);
  return {
    id: joined.invoice.id, invoiceNumber: joined.invoice.invoiceNumber,
    guardianName: joined.guardianName, childName: `${joined.firstName} ${joined.lastName}`,
    amount: joined.invoice.amount, dueDate: joined.invoice.dueDate, status: joined.invoice.status,
    paidAt: joined.invoice.paidAt?.toISOString() ?? null,
    lastPaymentStatus: joined.invoice.lastPaymentStatus,
    lastPaymentError: joined.invoice.lastPaymentError,
    chargedCurrency: joined.invoice.chargedCurrency, chargedAmount: joined.invoice.chargedAmount,
    paymentMethod: joined.invoice.paymentMethod, paymentReference: joined.invoice.paymentReference,
    lines: lines.map(({ ownerId: _, invoiceId: _invoiceId, ...line }) => line),
    paidAmount, refundedAmount, balance: Math.max(0, joined.invoice.amount - paidAmount + refundedAmount),
  };
}

router.post("/invoices", requireNurseryPermission("write:invoice"), async (req, res) => {
  const body = CreateInvoiceBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });
  const { ownerId } = nurseryContext(req);
  const child = await ownedChild(ownerId, body.data.childId);
  if (!child) return void res.status(404).json({ error: "Child not found" });
  const total = body.data.lines.reduce((sum, line) => {
    const amount = line.quantity * line.unitAmount;
    return sum + (line.type === "discount" ? -amount : amount);
  }, 0);
  if (total < 0) return void res.status(400).json({ error: "Invoice total cannot be negative" });
  const row = await db.transaction(async (tx) => {
    const now = new Date();
    const [invoice] = await tx.insert(invoicesTable).values({
      ownerId, branchId: child.branchId,
      invoiceNumber: `INV-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      guardianId: child.guardianId, childId: child.id, amount: total, dueDate: body.data.dueDate,
      status: body.data.status === "issued" ? "issued" : "draft",
      issuedAt: body.data.status === "issued" ? now : null,
    }).returning();
    await tx.insert(invoiceLinesTable).values(body.data.lines.map((line) => {
      const raw = line.quantity * line.unitAmount;
      return { ownerId, invoiceId: invoice.id, ...line, amount: line.type === "discount" ? -raw : raw };
    }));
    return invoice;
  });
  const detail = await invoiceDetail(ownerId, row.id);
  await auditNurseryOperation(req, "create", "invoice", String(row.id), null, row as unknown as Record<string, unknown>);
  res.status(201).json(CreateInvoiceResponse.parse(detail));
});

router.get("/invoices/:id", requireNurseryPermission("read:invoice"), async (req, res) => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: params.error.message });
  const detail = await invoiceDetail(nurseryContext(req).ownerId, params.data.id);
  if (!detail) return void res.status(404).json({ error: "Invoice not found" });
  res.json(GetInvoiceResponse.parse(detail));
});

router.post("/invoices/:id/payments", requireNurseryPermission("write:payment"), async (req, res) => {
  const params = RecordInvoicePaymentParams.safeParse(req.params);
  const body = RecordInvoicePaymentBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
  const { ownerId, actorId } = nurseryContext(req);
  const detail = await invoiceDetail(ownerId, params.data.id);
  if (!detail) return void res.status(404).json({ error: "Invoice not found" });
  if (detail.status === "cancelled" || detail.status === "draft" || body.data.amount > detail.balance) {
    return void res.status(409).json({ error: "Payment exceeds balance or invoice is not payable" });
  }
  const receipt = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${params.data.id} and owner_id = ${ownerId} for update`);
    const [lockedInvoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.ownerId, ownerId)));
    const [payments, refunds] = await Promise.all([
      tx.select().from(invoicePaymentsTable).where(and(eq(invoicePaymentsTable.ownerId, ownerId), eq(invoicePaymentsTable.invoiceId, params.data.id), inArray(invoicePaymentsTable.status, ["completed", "succeeded"]))),
      tx.select().from(invoiceRefundsTable).where(and(eq(invoiceRefundsTable.ownerId, ownerId), eq(invoiceRefundsTable.invoiceId, params.data.id))),
    ]);
    const balance = (lockedInvoice?.amount ?? 0) - payments.reduce((sum, row) => sum + row.amount, 0) + refunds.reduce((sum, row) => sum + row.amount, 0);
    if (!lockedInvoice || lockedInvoice.status === "cancelled" || lockedInvoice.status === "draft" || body.data.amount > balance) {
      throw new Error("PAYMENT_BALANCE_CONFLICT");
    }
    const [payment] = await tx.insert(invoicePaymentsTable).values({
      ownerId, invoiceId: params.data.id, method: body.data.method, amount: body.data.amount,
      currency: "KWD", status: "completed", reference: body.data.reference ?? null,
      note: body.data.note ?? null, recordedBy: actorId,
    }).returning();
    const paid = payments.reduce((sum, row) => sum + row.amount, 0) + body.data.amount;
    const refunded = refunds.reduce((sum, row) => sum + row.amount, 0);
    await tx.update(invoicesTable).set({
      status: paid - refunded >= lockedInvoice.amount ? "paid" : "partial",
      paidAt: paid - refunded >= lockedInvoice.amount ? new Date() : null,
      lastPaymentStatus: "paid", paymentMethod: body.data.method,
      paymentReference: body.data.reference ?? null,
    }).where(and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.ownerId, ownerId)));
    const [created] = await tx.insert(invoiceReceiptsTable).values({
      ownerId, invoiceId: params.data.id, paymentId: payment.id,
      receiptNumber: `REC-${payment.id}-${randomUUID().slice(0, 6).toUpperCase()}`,
      amount: payment.amount, issuedBy: actorId,
    }).returning();
    return created;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "PAYMENT_BALANCE_CONFLICT") return null;
    throw error;
  });
  if (!receipt) return void res.status(409).json({ error: "Invoice balance changed; payment was not recorded" });
  await refreshBillingProgressForInvoice(params.data.id);
  await auditNurseryOperation(req, "payment", "invoice", String(params.data.id), null, { amount: body.data.amount, method: body.data.method });
  const { ownerId: _, issuedAt, ...data } = receipt;
  res.status(201).json(RecordInvoicePaymentResponse.parse({ ...data, issuedAt: issuedAt.toISOString() }));
});

router.post("/invoices/:id/cash-payment", requireNurseryPermission("write:payment"), async (req, res) => {
  const params = RecordCashInvoicePaymentParams.safeParse(req.params);
  const body = RecordCashInvoicePaymentBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
  const { ownerId, actorId } = nurseryContext(req);
  const detail = await invoiceDetail(ownerId, params.data.id);
  if (!detail) return void res.status(404).json({ error: "Invoice not found" });
  if (detail.status === "cancelled" || detail.status === "draft" || Math.abs(body.data.amount - detail.balance) > 0.0005) {
    return void res.status(400).json({ error: "Cash amount must equal the outstanding invoice balance" });
  }
  const payment = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${params.data.id} and owner_id = ${ownerId} for update`);
    const [lockedInvoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.ownerId, ownerId)));
    const [payments, refunds] = await Promise.all([
      tx.select().from(invoicePaymentsTable).where(and(eq(invoicePaymentsTable.ownerId, ownerId), eq(invoicePaymentsTable.invoiceId, params.data.id), inArray(invoicePaymentsTable.status, ["completed", "succeeded"]))),
      tx.select().from(invoiceRefundsTable).where(and(eq(invoiceRefundsTable.ownerId, ownerId), eq(invoiceRefundsTable.invoiceId, params.data.id))),
    ]);
    const balance = (lockedInvoice?.amount ?? 0) - payments.reduce((sum, row) => sum + row.amount, 0) + refunds.reduce((sum, row) => sum + row.amount, 0);
    if (!lockedInvoice || lockedInvoice.status === "cancelled" || lockedInvoice.status === "draft" || Math.abs(body.data.amount - balance) > 0.0005) {
      throw new Error("PAYMENT_BALANCE_CONFLICT");
    }
    const [created] = await tx.insert(invoicePaymentsTable).values({
      ownerId, invoiceId: params.data.id, method: "cash", amount: body.data.amount,
      currency: "KWD", status: "completed", note: body.data.note ?? null, recordedBy: actorId,
    }).returning();
    const paidAt = new Date();
    const paid = payments.reduce((sum, row) => sum + row.amount, 0) + body.data.amount;
    const refunded = refunds.reduce((sum, row) => sum + row.amount, 0);
    await tx.update(invoicesTable).set({
      status: paid - refunded >= lockedInvoice.amount ? "paid" : "partial",
      paidAt: paid - refunded >= lockedInvoice.amount ? paidAt : null, lastPaymentStatus: "paid", paymentMethod: "cash",
    }).where(and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.ownerId, ownerId)));
    await tx.insert(invoiceReceiptsTable).values({
      ownerId, invoiceId: params.data.id, paymentId: created.id,
      receiptNumber: `REC-${created.id}-${randomUUID().slice(0, 6).toUpperCase()}`,
      amount: created.amount, issuedBy: actorId, issuedAt: paidAt,
    });
    return { created, paidAt };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "PAYMENT_BALANCE_CONFLICT") return null;
    throw error;
  });
  if (!payment) return void res.status(409).json({ error: "Invoice balance changed; payment was not recorded" });
  await refreshBillingProgressForInvoice(params.data.id);
  await auditNurseryOperation(req, "payment", "invoice", String(params.data.id), null, { amount: body.data.amount, method: "cash" });
  res.json(RecordCashInvoicePaymentResponse.parse({
    invoiceId: params.data.id, status: "paid", method: "cash", amount: payment.created.amount,
    currency: "KWD", reference: payment.created.reference, paidAt: payment.paidAt.toISOString(),
  }));
});

router.post("/invoices/:id/refunds", requireNurseryPermission("write:payment"), async (req, res) => {
  const params = RefundInvoicePaymentParams.safeParse(req.params);
  const body = RefundInvoicePaymentBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
  const { ownerId, actorId } = nurseryContext(req);
  const detail = await invoiceDetail(ownerId, params.data.id);
  if (!detail) return void res.status(404).json({ error: "Invoice not found" });
  if (body.data.amount > detail.paidAmount - detail.refundedAmount) return void res.status(409).json({ error: "Refund exceeds refundable amount" });
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${params.data.id} and owner_id = ${ownerId} for update`);
    const [payments, refunds] = await Promise.all([
      tx.select().from(invoicePaymentsTable).where(and(eq(invoicePaymentsTable.ownerId, ownerId), eq(invoicePaymentsTable.invoiceId, params.data.id), inArray(invoicePaymentsTable.status, ["completed", "succeeded"]))),
      tx.select().from(invoiceRefundsTable).where(and(eq(invoiceRefundsTable.ownerId, ownerId), eq(invoiceRefundsTable.invoiceId, params.data.id))),
    ]);
    const refundable = payments.reduce((sum, payment) => sum + payment.amount, 0) - refunds.reduce((sum, refund) => sum + refund.amount, 0);
    if (body.data.amount > refundable) throw new Error("REFUND_BALANCE_CONFLICT");
    const [created] = await tx.insert(invoiceRefundsTable).values({
      ownerId, invoiceId: params.data.id, paymentId: body.data.paymentId ?? null,
      amount: body.data.amount, reason: body.data.reason, recordedBy: actorId,
    }).returning();
    await tx.update(invoicesTable).set({ status: "partial", paidAt: null }).where(and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.ownerId, ownerId)));
    return created;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "REFUND_BALANCE_CONFLICT") return null;
    throw error;
  });
  if (!row) return void res.status(409).json({ error: "Refundable balance changed; refund was not recorded" });
  await refreshBillingProgressForInvoice(params.data.id);
  await auditNurseryOperation(req, "refund", "invoice", String(params.data.id), null, row as unknown as Record<string, unknown>);
  const { ownerId: _, createdAt, ...data } = row;
  res.status(201).json(RefundInvoicePaymentResponse.parse({ ...data, createdAt: createdAt.toISOString() }));
});

router.post("/invoices/:id/cancel", requireNurseryPermission("write:invoice"), async (req, res) => {
  const params = CancelInvoiceParams.safeParse(req.params);
  const body = CancelInvoiceBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
  const { ownerId } = nurseryContext(req);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${params.data.id} and owner_id = ${ownerId} for update`);
    const [invoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, params.data.id), eq(invoicesTable.ownerId, ownerId)));
    if (!invoice) return "missing" as const;
    if (invoice.status === "cancelled") return "changed" as const;
    const [payments, refunds] = await Promise.all([
      tx.select().from(invoicePaymentsTable).where(and(eq(invoicePaymentsTable.ownerId, ownerId), eq(invoicePaymentsTable.invoiceId, invoice.id), inArray(invoicePaymentsTable.status, ["completed", "succeeded"]))),
      tx.select().from(invoiceRefundsTable).where(and(eq(invoiceRefundsTable.ownerId, ownerId), eq(invoiceRefundsTable.invoiceId, invoice.id))),
    ]);
    const netPaid = payments.reduce((sum, row) => sum + row.amount, 0) - refunds.reduce((sum, row) => sum + row.amount, 0);
    if (netPaid > 0) return "paid" as const;
    await tx.update(invoicesTable).set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: body.data.reason })
      .where(and(eq(invoicesTable.id, invoice.id), eq(invoicesTable.ownerId, ownerId), eq(invoicesTable.status, invoice.status)));
    return invoice;
  });
  if (result === "missing") return void res.status(404).json({ error: "Invoice not found" });
  if (result === "paid" || result === "changed") return void res.status(409).json({ error: "Invoice changed or has a net payment" });
  await refreshBillingProgressForInvoice(params.data.id);
  const detail = await invoiceDetail(ownerId, params.data.id);
  await auditNurseryOperation(req, "cancel", "invoice", String(params.data.id), result as unknown as Record<string, unknown>, detail as unknown as Record<string, unknown>);
  res.json(CancelInvoiceResponse.parse(detail));
});

router.get("/nursery/settings", requireNurseryPermission("read:setting"), async (req, res) => {
  const [row] = await db.select().from(nurserySettingsTable).where(eq(nurserySettingsTable.ownerId, nurseryContext(req).ownerId));
  if (!row) {
    res.json(GetNurserySettingsResponse.parse({
      id: 0,
      nurseryName: "حضانة EC",
      registrationWhatsApp: DEFAULT_REGISTRATION_WHATSAPP,
      timezone: "Asia/Kuwait",
      currency: "KWD",
      workingHours: {
        sunday: { open: "07:00", close: "14:00" },
        monday: { open: "07:00", close: "14:00" },
        tuesday: { open: "07:00", close: "14:00" },
        wednesday: { open: "07:00", close: "14:00" },
        thursday: { open: "07:00", close: "14:00" },
      },
      calendar: { weekend: ["friday", "saturday"], holidays: [] },
      updatedBy: nurseryContext(req).actorId,
      updatedAt: new Date(0).toISOString(),
    }));
    return;
  }
  const { ownerId: _, updatedAt, ...data } = row;
  res.json(GetNurserySettingsResponse.parse({ ...data, updatedAt: updatedAt.toISOString() }));
});

router.put("/nursery/settings", requireNurseryPermission("write:setting"), async (req, res) => {
  const body = SetNurserySettingsBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });
  const { ownerId, actorId } = nurseryContext(req);
  const settings = {
    ...body.data,
    registrationWhatsApp: normalizeRegistrationWhatsApp(body.data.registrationWhatsApp),
  };
  const [before] = await db.select().from(nurserySettingsTable).where(eq(nurserySettingsTable.ownerId, ownerId));
  const [row] = before
    ? await db.update(nurserySettingsTable).set({ ...settings, updatedBy: actorId, updatedAt: new Date() }).where(eq(nurserySettingsTable.id, before.id)).returning()
    : await db.insert(nurserySettingsTable).values({ ownerId, ...settings, updatedBy: actorId }).returning();
  await auditNurseryOperation(req, before ? "update" : "create", "nursery-settings", String(row.id), before as unknown as Record<string, unknown> | null, row as unknown as Record<string, unknown>);
  const { ownerId: _, updatedAt, ...data } = row;
  res.json(SetNurserySettingsResponse.parse({ ...data, updatedAt: updatedAt.toISOString() }));
});

async function linkedGuardian(req: import("express").Request) {
  const auth = getLocalAuth(req);
  if (!auth) return null;
  const accountRef = `local_${auth.sub}`;
  const [guardian] = await db.select().from(guardiansTable).where(eq(guardiansTable.clerkUserId, accountRef));
  return guardian ?? null;
}

router.get("/parent/billing-plans", async (req, res) => {
  const guardian = await linkedGuardian(req);
  if (!guardian) return void res.status(403).json({ error: "Parent access required" });
  const rows = await billingPlanDetails(guardian.ownerId, guardian.id);
  res.json(ListParentBillingPlansResponse.parse(rows));
});

router.get("/parent/documents", async (req, res) => {
  const guardian = await linkedGuardian(req);
  if (!guardian) return void res.status(403).json({ error: "Parent access required" });
  const rows = await db.select({ document: applicationDocumentsTable })
    .from(applicationDocumentsTable).innerJoin(childrenTable, and(
      eq(applicationDocumentsTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, guardian.ownerId), eq(childrenTable.guardianId, guardian.id),
    )).where(eq(applicationDocumentsTable.parentVisible, true));
  res.json(ListParentDocumentsResponse.parse(rows.map(({ document }) => ({
    id: document.id, applicationId: document.applicationId, childId: document.childId!,
    name: document.name, contentType: document.contentType, size: document.size,
    createdAt: document.createdAt.toISOString(),
  }))));
});

router.get("/parent/documents/:id/content", async (req, res) => {
  const params = GetParentDocumentContentParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: params.error.message });
  const guardian = await linkedGuardian(req);
  if (!guardian) return void res.status(403).json({ error: "Parent access required" });
  const [row] = await db.select({ document: applicationDocumentsTable }).from(applicationDocumentsTable)
    .innerJoin(childrenTable, and(eq(applicationDocumentsTable.childId, childrenTable.id),
      eq(childrenTable.ownerId, guardian.ownerId), eq(childrenTable.guardianId, guardian.id)))
    .where(and(eq(applicationDocumentsTable.id, params.data.id), eq(applicationDocumentsTable.parentVisible, true)));
  if (!row) return void res.status(404).json({ error: "Document not found" });
  try {
    const response = await storage.downloadObject(await storage.getObjectEntityFile(row.document.objectPath));
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.document.name)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!response.body) return void res.end();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return void res.status(404).json({ error: "Document not found" });
    throw error;
  }
});

router.get("/parent/receipts", async (req, res) => {
  const guardian = await linkedGuardian(req);
  if (!guardian) return void res.status(403).json({ error: "Parent access required" });
  const rows = await db.select({ receipt: invoiceReceiptsTable }).from(invoiceReceiptsTable)
    .innerJoin(invoicesTable, and(
      eq(invoiceReceiptsTable.invoiceId, invoicesTable.id),
      eq(invoicesTable.ownerId, guardian.ownerId), eq(invoicesTable.guardianId, guardian.id),
    )).where(eq(invoiceReceiptsTable.ownerId, guardian.ownerId)).orderBy(desc(invoiceReceiptsTable.issuedAt));
  res.json(ListParentReceiptsResponse.parse(rows.map(({ receipt }) => {
    const { ownerId: _, issuedAt, ...data } = receipt;
    return { ...data, issuedAt: issuedAt.toISOString() };
  })));
});

export default router;