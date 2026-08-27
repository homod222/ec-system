import {
  db,
  invoicesTable,
  paymentAttemptsTable,
  type Guardian,
  type Invoice,
  type PaymentAttempt,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const SANDBOX_BASE_URL = "https://apitest.myfatoorah.com";
const PRODUCTION_BASE_URL = "https://api.myfatoorah.com";

export class PaymentProviderConfigurationError extends Error {
  constructor() {
    super("خدمة الدفع عبر KNET غير مهيأة بعد. يرجى التواصل مع إدارة الحضانة.");
    this.name = "PaymentProviderConfigurationError";
  }
}

export class PaymentAttemptInProgressError extends Error {
  constructor() {
    super("تجري الآن معالجة محاولة دفع سابقة. يرجى الانتظار قليلًا ثم تحديث الصفحة.");
    this.name = "PaymentAttemptInProgressError";
  }
}

class MyFatoorahApiError extends Error {
  constructor(message: string, readonly mayHaveSucceeded: boolean) {
    super(message);
    this.name = "MyFatoorahApiError";
  }
}

export function isAmbiguousProviderFailure(
  operationCanCreateInvoice: boolean,
  responseStatus?: number,
  responseBodyMissing = false,
): boolean {
  if (!operationCanCreateInvoice) return false;
  if (responseStatus === undefined) return true;
  return responseStatus >= 500 || (responseStatus >= 200 && responseStatus < 300 && responseBodyMissing);
}

export function isIncompleteExecutePaymentResponse(
  result: { InvoiceId?: number; PaymentURL?: string },
): boolean {
  return !result.InvoiceId || !result.PaymentURL;
}

type MyFatoorahResponse<T> = {
  IsSuccess: boolean;
  Message?: string;
  Data?: T;
  ValidationErrors?: Array<{ Name?: string; Error?: string }>;
};

type PaymentMethod = {
  PaymentMethodId: number;
  PaymentMethodAr?: string;
  PaymentMethodEn?: string;
  PaymentMethodCode?: string;
};

export type MyFatoorahPaymentStatus = {
  InvoiceId: number;
  InvoiceStatus: string;
  CustomerReference?: string;
  ExpiryDate?: string;
  InvoiceValue?: number;
  InvoiceTransactions?: Array<{
    PaymentId?: string;
    TransactionStatus?: string;
    PaidCurrency?: string;
    PaidCurrencyValue?: string;
    Error?: string;
  }>;
};

function getApiKey(): string {
  const key = process.env.MYFATOORAH_API_KEY;
  const webhookSecret = process.env.MYFATOORAH_WEBHOOK_SECRET;
  const production = process.env.MYFATOORAH_ENVIRONMENT === "production";
  const productionWebhookConfirmed = process.env.MYFATOORAH_WEBHOOK_CONFIGURED === "true";
  if (!key || !webhookSecret || (production && !productionWebhookConfirmed)) {
    throw new PaymentProviderConfigurationError();
  }
  return key;
}

export function isMyFatoorahConfigured(): boolean {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

export function getMyFatoorahBaseUrl(): string {
  return process.env.MYFATOORAH_ENVIRONMENT === "production"
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL;
}

async function myFatoorahRequest<T>(
  path: string,
  body: unknown,
  ambiguousIfProviderFails = false,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getMyFatoorahBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new MyFatoorahApiError(
      error instanceof Error ? error.message : "MyFatoorah network request failed",
      isAmbiguousProviderFailure(ambiguousIfProviderFails),
    );
  }
  const payload = (await response.json().catch(() => null)) as MyFatoorahResponse<T> | null;
  if (!response.ok || !payload?.IsSuccess || payload.Data === undefined) {
    const validation = payload?.ValidationErrors?.map((item) => item.Error).filter(Boolean).join("; ");
    throw new MyFatoorahApiError(
      validation || payload?.Message || `MyFatoorah request failed with HTTP ${response.status}`,
      isAmbiguousProviderFailure(ambiguousIfProviderFails, response.status, payload === null),
    );
  }
  return payload.Data;
}

export function getMyFatoorahPaymentStatus(
  key: string,
  keyType: "InvoiceId" | "PaymentId" | "CustomerReference",
): Promise<MyFatoorahPaymentStatus> {
  return myFatoorahRequest<MyFatoorahPaymentStatus>("/v2/GetPaymentStatus", {
    Key: key,
    KeyType: keyType,
  });
}

async function resolveKnetPaymentMethodId(amountKwd: number): Promise<number> {
  const result = await myFatoorahRequest<PaymentMethod[] | { PaymentMethods: PaymentMethod[] }>("/v2/InitiatePayment", {
    InvoiceAmount: amountKwd,
    CurrencyIso: "KWD",
  });
  const methods = Array.isArray(result) ? result : result.PaymentMethods;
  if (!Array.isArray(methods)) {
    throw new MyFatoorahApiError("MyFatoorah returned an invalid payment-method response", false);
  }
  const knet = methods.find((method) => {
    const label = `${method.PaymentMethodCode ?? ""} ${method.PaymentMethodEn ?? ""} ${method.PaymentMethodAr ?? ""}`.toLowerCase();
    return label.includes("knet") || label.includes("كي نت") || label.includes("كي-نت");
  });
  if (!knet) throw new MyFatoorahApiError("KNET is not enabled on the MyFatoorah merchant account", false);
  return knet.PaymentMethodId;
}

function getAllowedReturnOrigins(): string[] {
  const domains = new Set<string>();
  process.env.REPLIT_DOMAINS?.split(",").forEach((domain) => {
    const trimmed = domain.trim();
    if (trimmed) domains.add(trimmed);
  });
  if (process.env.REPLIT_DEV_DOMAIN) domains.add(process.env.REPLIT_DEV_DOMAIN);
  return Array.from(domains, (domain) => `https://${domain}`);
}

export function isAllowedReturnUrl(url: string): boolean {
  try {
    return getAllowedReturnOrigins().includes(new URL(url).origin);
  } catch {
    return false;
  }
}

function normalizedKuwaitPhone(phone: string): { countryCode?: string; mobile?: string } {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("965") ? digits.slice(3) : digits;
  return local.length >= 8 ? { countryCode: "965", mobile: local.slice(-8) } : {};
}

type Reservation =
  | { kind: "existing"; attempt: PaymentAttempt }
  | { kind: "new"; attempt: PaymentAttempt; invoice: Invoice };

type ExecutePaymentResult = { InvoiceId: number; PaymentURL: string };

type CheckoutDependencies = {
  persistExecutedPaymentResult?: (
    attempt: PaymentAttempt,
    invoice: Invoice,
    result: ExecutePaymentResult,
  ) => Promise<void>;
};

async function reserveAttempt(
  invoiceId: number,
  ownerId: string,
  guardianId: number,
): Promise<Reservation> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${invoiceId})`);
    const [invoice] = await tx.select().from(invoicesTable)
      .where(and(
        eq(invoicesTable.id, invoiceId),
        eq(invoicesTable.ownerId, ownerId),
        eq(invoicesTable.guardianId, guardianId),
      )).limit(1);
    if (!invoice || invoice.status === "paid") throw new Error("Invoice is no longer payable");

    const [latest] = await tx.select().from(paymentAttemptsTable)
      .where(eq(paymentAttemptsTable.invoiceId, invoiceId))
      .orderBy(desc(paymentAttemptsTable.attemptNumber))
      .limit(1);
    if (latest && (latest.status === "creating" || latest.status === "pending")) {
      if (latest.paymentUrl) return { kind: "existing" as const, attempt: latest };
      throw new PaymentAttemptInProgressError();
    }

    const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
    const [attempt] = await tx.insert(paymentAttemptsTable).values({
      invoiceId,
      attemptNumber,
      customerReference: `invoice-${invoiceId}-attempt-${attemptNumber}`,
      status: "creating",
      amount: invoice.amount,
      currency: "KWD",
    }).returning();
    return { kind: "new" as const, attempt, invoice };
  });
}

async function persistExecutedPaymentResult(
  attempt: PaymentAttempt,
  invoice: Invoice,
  result: ExecutePaymentResult,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [updatedAttempt] = await tx.update(paymentAttemptsTable).set({
      providerInvoiceId: String(result.InvoiceId),
      paymentUrl: result.PaymentURL,
      status: "pending",
      updatedAt: new Date(),
    }).where(eq(paymentAttemptsTable.id, attempt.id)).returning();
    if (!updatedAttempt) throw new Error("Reserved payment attempt no longer exists");
    await tx.update(invoicesTable).set({
      myFatoorahInvoiceId: String(result.InvoiceId),
      myFatoorahPaymentUrl: result.PaymentURL,
      myFatoorahCheckoutAttempt: attempt.attemptNumber,
      lastPaymentStatus: "pending",
      lastPaymentError: null,
    }).where(eq(invoicesTable.id, invoice.id));
  });
}

export async function createInvoiceCheckoutSession(params: {
  invoice: Invoice;
  guardian: Guardian;
  successUrl: string;
  cancelUrl: string;
}, dependencies: CheckoutDependencies = {}): Promise<{ url: string; sessionId: string }> {
  getApiKey();
  if (params.guardian.ownerId !== params.invoice.ownerId) {
    throw new Error("Invoice is no longer payable");
  }
  const reservation = await reserveAttempt(
    params.invoice.id,
    params.invoice.ownerId,
    params.guardian.id,
  );
  if (reservation.kind === "existing") {
    return {
      url: reservation.attempt.paymentUrl!,
      sessionId: reservation.attempt.providerInvoiceId ?? String(reservation.attempt.id),
    };
  }

  const { attempt, invoice } = reservation;
  let providerMayHaveCreatedInvoice = false;
  try {
    const paymentMethodId = await resolveKnetPaymentMethodId(invoice.amount);
    const phone = normalizedKuwaitPhone(params.guardian.phone);
    const result = await myFatoorahRequest<ExecutePaymentResult>("/v2/ExecutePayment", {
      PaymentMethodId: paymentMethodId,
      InvoiceValue: invoice.amount,
      DisplayCurrencyIso: "KWD",
      CustomerName: params.guardian.name,
      CustomerEmail: params.guardian.email ?? undefined,
      MobileCountryCode: phone.countryCode,
      CustomerMobile: phone.mobile,
      Language: "AR",
      CustomerReference: attempt.customerReference,
      UserDefinedField: `invoice:${invoice.id};attempt:${attempt.id}`,
      CallBackUrl: params.successUrl,
      ErrorUrl: params.cancelUrl,
      InvoiceItems: [{
        ItemName: `رسوم الحضانة - ${invoice.invoiceNumber}`,
        Quantity: 1,
        UnitPrice: invoice.amount,
      }],
    }, true);
    providerMayHaveCreatedInvoice = true;
    if (isIncompleteExecutePaymentResponse(result)) {
      throw new MyFatoorahApiError("MyFatoorah returned an incomplete payment response", true);
    }

    await (dependencies.persistExecutedPaymentResult ?? persistExecutedPaymentResult)(
      attempt,
      invoice,
      result,
    );

    logger.info({
      invoiceId: invoice.id,
      paymentAttemptId: attempt.id,
      providerInvoiceId: String(result.InvoiceId),
      currency: "KWD",
      method: "KNET",
      environment: process.env.MYFATOORAH_ENVIRONMENT === "production" ? "production" : "sandbox",
    }, "Created MyFatoorah KNET payment");
    return { url: result.PaymentURL, sessionId: String(result.InvoiceId) };
  } catch (error) {
    const providerFailureMayHaveSucceeded =
      error instanceof MyFatoorahApiError && error.mayHaveSucceeded;
    if (!providerMayHaveCreatedInvoice && !providerFailureMayHaveSucceeded) {
      await db.update(paymentAttemptsTable).set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Payment creation failed",
        updatedAt: new Date(),
      }).where(eq(paymentAttemptsTable.id, attempt.id));
    }
    throw error;
  }
}