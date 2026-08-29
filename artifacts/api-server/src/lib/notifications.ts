import { db, paymentNotificationsTable, type Guardian, type Invoice } from "@workspace/db";
import { logger } from "./logger";

/**
 * Kuwait-market heuristic: guardian phone numbers are stored in local format
 * (e.g. "055 314 9876"). WhatsApp Cloud API requires E.164-style digits with
 * country code and no punctuation. We strip formatting and, when the number
 * doesn't already carry a country code, assume Kuwait (+965) since this
 * nursery operates in Kuwait (KWD billing currency). If the nursery later
 * serves guardians in other countries, guardian phone numbers should be
 * captured with an explicit country code at intake instead of relying on
 * this heuristic.
 *
 * Kuwaiti mobile/landline numbers are exactly 8 local digits (no trunk "0"
 * prefix, unlike neighboring markets such as the UAE/KSA). After stripping
 * a country code, the remaining local number MUST be 8 digits -- anything
 * else means the stored value is malformed (typo, extra digit, wrong
 * country format) and would silently reach WhatsApp's API as an invalid
 * recipient. We reject those explicitly instead of sending a best-effort
 * guess.
 */
export function normalizePhoneForWhatsApp(phone: string): { ok: true; value: string } | { ok: false; error: string } {
  const digits = phone.replace(/\D/g, "");
  let local: string;
  if (digits.startsWith("00965")) {
    local = digits.slice(5);
  } else if (digits.startsWith("965") && digits.length > 8) {
    local = digits.slice(3);
  } else {
    local = digits.replace(/^0+/, "");
  }

  if (!/^\d{8}$/.test(local)) {
    return {
      ok: false,
      error:
        `رقم هاتف غير صالح لإرسال واتساب: "${phone}". يجب أن يتكون رقم الجوال الكويتي من 8 أرقام ` +
        `بعد حذف مفتاح الدولة (965) وأي أصفار بادئة، بينما الرقم المُدخل ينتج عنه ${local.length || 0} رقم.`,
    };
  }

  return { ok: true, value: `965${local}` };
}

type WhatsAppSendResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a WhatsApp message via Meta's WhatsApp Business Cloud API.
 * Requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to be configured
 * as secrets. Until they're set, this fails explicitly rather than pretending
 * to have sent the message -- the caller records that outcome on the invoice
 * and in the notifications log so nothing is silently dropped.
 */
export async function sendWhatsAppText(to: string, body: string): Promise<WhatsAppSendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      error: "لم يتم إعداد بيانات اعتماد واتساب بعد (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID).",
    };
  }

  const normalized = normalizePhoneForWhatsApp(to);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized.value,
        type: "text",
        text: { body },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      const errorBody = await resp.text().catch(() => "");
      return { ok: false, error: `WhatsApp API ${resp.status}: ${errorBody.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "WhatsApp request failed" };
  }
}

const sendWhatsAppMessage = sendWhatsAppText;

async function dispatchAndRecord(params: {
  invoice: Invoice;
  guardian: Pick<Guardian, "phone">;
  type: "due_reminder" | "payment_confirmation";
  message: string;
  source?: "manual" | "automatic";
  reminderStage?: "due_soon" | "overdue";
}): Promise<{ status: "sent" | "failed"; errorMessage?: string }> {
  const result = await sendWhatsAppMessage(params.guardian.phone, params.message);
  const status = result.ok ? "sent" : "failed";
  const errorMessage = result.ok ? undefined : result.error;

  await db.insert(paymentNotificationsTable).values({
    invoiceId: params.invoice.id,
    channel: "whatsapp",
    type: params.type,
    source: params.source ?? "manual",
    reminderStage: params.reminderStage ?? null,
    recipientPhone: params.guardian.phone,
    message: params.message,
    status,
    errorMessage: errorMessage ?? null,
  });

  if (!result.ok) {
    logger.warn({ invoiceId: params.invoice.id, type: params.type, error: result.error }, "Notification not sent");
  }

  return { status, errorMessage };
}

const arDate = new Intl.DateTimeFormat("ar-KW", { day: "numeric", month: "long", year: "numeric" });
const money = (amount: number) =>
  new Intl.NumberFormat("ar-KW", { style: "currency", currency: "KWD", maximumFractionDigits: 3 }).format(amount);

export async function sendDueReminder(
  invoice: Invoice,
  guardian: Pick<Guardian, "phone">,
  options: {
    source?: "manual" | "automatic";
    reminderStage?: "due_soon" | "overdue";
  } = {},
) {
  const message =
    `تذكير بالاستحقاق: فاتورة ${invoice.invoiceNumber} بمبلغ ${money(invoice.amount)} ` +
    `مستحقة بتاريخ ${arDate.format(new Date(invoice.dueDate))}. يرجى السداد في أقرب وقت ممكن.`;
  return dispatchAndRecord({ invoice, guardian, type: "due_reminder", message, ...options });
}

export async function sendPaymentConfirmation(invoice: Invoice, guardian: Pick<Guardian, "phone">) {
  const message =
    `تم استلام سداد فاتورة ${invoice.invoiceNumber} بمبلغ ${money(invoice.amount)}. شكرًا لكم.`;
  return dispatchAndRecord({ invoice, guardian, type: "payment_confirmation", message });
}
