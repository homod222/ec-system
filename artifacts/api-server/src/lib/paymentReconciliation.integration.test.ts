import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activitiesTable,
  db,
  invoicePaymentsTable,
  invoicesTable,
  paymentAttemptsTable,
  type Guardian,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { runApplicationMigrations } from "./applicationMigrations";
import {
  reconcileInvoicePayment,
  reconcilePaymentAttemptFromStatus,
} from "./paymentReconciliation";
import { scanOutstandingPaymentAttempts } from "./paymentReconciliationScheduler";
import {
  createInvoiceCheckoutSession,
  PaymentAttemptInProgressError,
} from "./financePayments";

const createdInvoiceIds: number[] = [];

beforeAll(async () => {
  await runApplicationMigrations();
  await db.delete(activitiesTable).where(like(activitiesTable.title, "%KNET-TEST-%"));
});

afterEach(async () => {
  for (const invoiceId of createdInvoiceIds.splice(0)) {
    const [invoice] = await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId)).limit(1);
    if (invoice) {
      await db.delete(activitiesTable)
        .where(like(activitiesTable.title, `%${invoice.invoiceNumber}%`));
    }
    await db.delete(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, invoiceId));
    await db.delete(paymentAttemptsTable).where(eq(paymentAttemptsTable.invoiceId, invoiceId));
    await db.delete(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  }
});

async function createInvoice(amount = 12.345) {
  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber: `KNET-TEST-${randomUUID()}`,
    guardianId: 2_000_000_001,
    childId: 2_000_000_001,
    amount,
    dueDate: "2026-08-31",
    status: "pending",
  }).returning();
  createdInvoiceIds.push(invoice.id);
  return invoice;
}

function paidStatus(invoiceId: number, customerReference: string, amount: number) {
  return {
    InvoiceId: invoiceId,
    InvoiceStatus: "Paid",
    CustomerReference: customerReference,
    InvoiceValue: amount,
    InvoiceTransactions: [{
      PaymentId: `payment-${invoiceId}`,
      TransactionStatus: "Succss",
      PaidCurrency: "KWD",
      PaidCurrencyValue: String(amount),
    }],
  };
}

describe("MyFatoorah durable payment reconciliation", () => {
  it("recovers a provider invoice created before its local ID was saved", async () => {
    const invoice = await createInvoice();
    const [attempt] = await db.insert(paymentAttemptsTable).values({
      invoiceId: invoice.id,
      attemptNumber: 1,
      customerReference: `invoice-${invoice.id}-attempt-1`,
      status: "creating",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();

    await reconcilePaymentAttemptFromStatus(
      attempt,
      paidStatus(9_100_001, attempt.customerReference, invoice.amount),
    );

    const [savedAttempt] = await db.select().from(paymentAttemptsTable)
      .where(eq(paymentAttemptsTable.id, attempt.id));
    const [savedInvoice] = await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, invoice.id));
    expect(savedAttempt.providerInvoiceId).toBe("9100001");
    expect(savedAttempt.status).toBe("succeeded");
    expect(savedInvoice.status).toBe("paid");
  });

  it("retains an attempt when provider creation succeeds but local persistence fails", async () => {
    const invoice = await createInvoice();
    const guardian = {
      id: invoice.guardianId,
      ownerId: invoice.ownerId,
      branchId: null,
      name: "KNET Test Guardian",
      phone: "96550000000",
      email: "knet@example.test",
      clerkUserId: null,
      identityKey: null,
      balance: 0,
    } satisfies Guardian;
    const previousKey = process.env.MYFATOORAH_API_KEY;
    const previousWebhookSecret = process.env.MYFATOORAH_WEBHOOK_SECRET;
    const previousEnvironment = process.env.MYFATOORAH_ENVIRONMENT;
    process.env.MYFATOORAH_API_KEY = "test-key";
    process.env.MYFATOORAH_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.MYFATOORAH_ENVIRONMENT = "sandbox";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        IsSuccess: true,
        Data: {
          PaymentMethods: [{
            PaymentMethodId: 1,
            PaymentMethodCode: "kn",
            PaymentMethodEn: "KNET",
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        IsSuccess: true,
        Data: {
          InvoiceId: 9_100_007,
          PaymentURL: "https://demo.myfatoorah.com/pay/persistence-failure",
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));

    try {
      await expect(createInvoiceCheckoutSession({
        invoice,
        guardian,
        successUrl: "https://integration.test/success",
        cancelUrl: "https://integration.test/cancel",
      }, {
        persistExecutedPaymentResult: async () => {
          throw new Error("simulated local persistence failure");
        },
      })).rejects.toThrow("simulated local persistence failure");

      const [reserved] = await db.select().from(paymentAttemptsTable)
        .where(eq(paymentAttemptsTable.invoiceId, invoice.id));
      expect(reserved.status).toBe("creating");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await expect(createInvoiceCheckoutSession({
        invoice,
        guardian,
        successUrl: "https://integration.test/success",
        cancelUrl: "https://integration.test/cancel",
      })).rejects.toBeInstanceOf(PaymentAttemptInProgressError);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await reconcilePaymentAttemptFromStatus(
        reserved,
        paidStatus(9_100_007, reserved.customerReference, invoice.amount),
      );
      const [repaired] = await db.select().from(paymentAttemptsTable)
        .where(eq(paymentAttemptsTable.id, reserved.id));
      expect(repaired.providerInvoiceId).toBe("9100007");
      expect(repaired.status).toBe("succeeded");
    } finally {
      fetchMock.mockRestore();
      if (previousKey === undefined) delete process.env.MYFATOORAH_API_KEY;
      else process.env.MYFATOORAH_API_KEY = previousKey;
      if (previousWebhookSecret === undefined) delete process.env.MYFATOORAH_WEBHOOK_SECRET;
      else process.env.MYFATOORAH_WEBHOOK_SECRET = previousWebhookSecret;
      if (previousEnvironment === undefined) delete process.env.MYFATOORAH_ENVIRONMENT;
      else process.env.MYFATOORAH_ENVIRONMENT = previousEnvironment;
    }
  });

  it("accepts a valid success from an older retained link after a retry exists", async () => {
    const invoice = await createInvoice();
    const [oldAttempt] = await db.insert(paymentAttemptsTable).values({
      invoiceId: invoice.id,
      attemptNumber: 1,
      customerReference: `invoice-${invoice.id}-attempt-1`,
      providerInvoiceId: `old-${invoice.id}`,
      status: "failed",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();
    const [newAttempt] = await db.insert(paymentAttemptsTable).values({
      invoiceId: invoice.id,
      attemptNumber: 2,
      customerReference: `invoice-${invoice.id}-attempt-2`,
      providerInvoiceId: `new-${invoice.id}`,
      paymentUrl: "https://demo.myfatoorah.com/pay/new",
      status: "pending",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();

    await reconcilePaymentAttemptFromStatus(
      oldAttempt,
      paidStatus(9_100_002, oldAttempt.customerReference, invoice.amount),
    );

    const [savedOld] = await db.select().from(paymentAttemptsTable)
      .where(eq(paymentAttemptsTable.id, oldAttempt.id));
    const [savedNew] = await db.select().from(paymentAttemptsTable)
      .where(eq(paymentAttemptsTable.id, newAttempt.id));
    const [savedInvoice] = await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, invoice.id));
    expect(savedOld.status).toBe("succeeded");
    expect(savedNew.status).toBe("superseded");
    expect(savedInvoice.status).toBe("paid");
  });

  it("repairs a paid invoice from provider status when the webhook was missed", async () => {
    const invoice = await createInvoice(44.125);
    const [attempt] = await db.insert(paymentAttemptsTable).values({
      invoiceId: invoice.id,
      attemptNumber: 1,
      customerReference: `invoice-${invoice.id}-attempt-1`,
      providerInvoiceId: `missed-webhook-${invoice.id}`,
      paymentUrl: "https://demo.myfatoorah.com/pay/missed",
      status: "pending",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();

    await reconcilePaymentAttemptFromStatus(
      attempt,
      paidStatus(9_100_003, attempt.customerReference, invoice.amount),
    );

    const [savedInvoice] = await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, invoice.id));
    expect(savedInvoice.status).toBe("paid");
    expect(savedInvoice.chargedCurrency).toBe("KWD");
    expect(savedInvoice.chargedAmount).toBe(invoice.amount);
  });

  it("records a late second success as an overpayment requiring review", async () => {
    const invoice = await createInvoice(9.875);
    const [firstAttempt] = await db.insert(paymentAttemptsTable).values({
      invoiceId: invoice.id,
      attemptNumber: 1,
      customerReference: `invoice-${invoice.id}-attempt-1`,
      providerInvoiceId: `first-${invoice.id}`,
      status: "pending",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();
    const [secondAttempt] = await db.insert(paymentAttemptsTable).values({
      invoiceId: invoice.id,
      attemptNumber: 2,
      customerReference: `invoice-${invoice.id}-attempt-2`,
      providerInvoiceId: `second-${invoice.id}`,
      status: "pending",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();

    await reconcilePaymentAttemptFromStatus(
      firstAttempt,
      paidStatus(9_100_004, firstAttempt.customerReference, invoice.amount),
    );
    await reconcilePaymentAttemptFromStatus(
      secondAttempt,
      paidStatus(9_100_005, secondAttempt.customerReference, invoice.amount),
    );

    const [alert] = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.type, "payment_overpayment"))
      .limit(1);
    expect(alert?.title).toContain(invoice.invoiceNumber);
  });

  it("pages through more than one hundred outstanding attempts", async () => {
    const invoice = await createInvoice();
    const prefix = `batch-${invoice.id}-`;
    await db.insert(paymentAttemptsTable).values(
      Array.from({ length: 205 }, (_, index) => ({
        invoiceId: invoice.id,
        attemptNumber: index + 1,
        customerReference: `${prefix}${index + 1}`,
        status: "creating",
        amount: invoice.amount,
        currency: "KWD",
      })),
    );

    const visited = new Set<number>();
    await scanOutstandingPaymentAttempts(async (attempt) => {
      if (attempt.customerReference.startsWith(prefix)) visited.add(attempt.id);
    });
    expect(visited.size).toBe(205);
  });

  it("releases checkout retry only after the provider invoice has expired", async () => {
    const invoice = await createInvoice();
    const [attempt] = await db.insert(paymentAttemptsTable).values({
      invoiceId: invoice.id,
      attemptNumber: 1,
      customerReference: `invoice-${invoice.id}-attempt-1`,
      providerInvoiceId: `expired-${invoice.id}`,
      paymentUrl: "https://demo.myfatoorah.com/pay/expired",
      status: "pending",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();

    await reconcilePaymentAttemptFromStatus(attempt, {
      InvoiceId: 9_100_006,
      InvoiceStatus: "Pending",
      CustomerReference: attempt.customerReference,
      ExpiryDate: "2020-01-01T00:00:00.000Z",
      InvoiceValue: invoice.amount,
      InvoiceTransactions: [],
    });

    const [savedAttempt] = await db.select().from(paymentAttemptsTable)
      .where(eq(paymentAttemptsTable.id, attempt.id));
    expect(savedAttempt.status).toBe("cancelled");
  });

  it("accepts an expiry notification as a terminal non-payable attempt", async () => {
    const invoice = await createInvoice();
    const providerInvoiceId = `expired-webhook-${invoice.id}`;
    const [attempt] = await db.insert(paymentAttemptsTable).values({
      invoiceId: invoice.id,
      attemptNumber: 1,
      customerReference: `invoice-${invoice.id}-attempt-1`,
      providerInvoiceId,
      paymentUrl: "https://demo.myfatoorah.com/pay/expired-webhook",
      status: "pending",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();

    await reconcileInvoicePayment({
      Event: { Code: 1, Name: "PAYMENT_STATUS_CHANGED" },
      Data: {
        Invoice: {
          Id: providerInvoiceId,
          Status: "EXPIRED",
          ExpirationDate: "2020-01-01T00:00:00.000Z",
        },
        Transaction: { Status: "FAILED" },
      },
    });

    const [savedAttempt] = await db.select().from(paymentAttemptsTable)
      .where(eq(paymentAttemptsTable.id, attempt.id));
    expect(savedAttempt.status).toBe("cancelled");
  });
});