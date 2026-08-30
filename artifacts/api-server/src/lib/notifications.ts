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

function ultraMsgConfiguration() {
  const instanceId = process.env.ULTRAMSG_INSTANCE_ID?.trim();
  const token = process.env.ULTRAMSG_TOKEN;
  if (!instanceId || !token) {
    return {
      ok: false,
      error: "لم يتم إعداد اتصال UltraMsg (ULTRAMSG_INSTANCE_ID / ULTRAMSG_TOKEN).",
    } as const;
  }

  if (!/^instance\d+$/i.test(instanceId)) {
    return {
      ok: false,
      error: "معرّف UltraMsg غير صالح.",
    } as const;
  }

  return { ok: true, instanceId, token } as const;
}

export async function sendWhatsAppText(to: string, body: string): Promise<WhatsAppSendResult> {
  const configuration = ultraMsgConfiguration();
  if (!configuration.ok) return configuration;

  const normalized = normalizePhoneForWhatsApp(to);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }

  try {
    const form = new URLSearchParams({
      token: configuration.token,
      to: `+${normalized.value}`,
      body,
    });
    const resp = await fetch(`https://api.ultramsg.com/${configuration.instanceId}/messages/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return { ok: false, error: `UltraMsg rejected the message (HTTP ${resp.status})` };
    }

    const response = await resp.json().catch(() => null) as { sent?: string | boolean; error?: string } | null;
    if (response?.sent === false || response?.sent === "false" || response?.error) {
      return { ok: false, error: "UltraMsg did not accept the message" };
    }

    return { ok: true };
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    return { ok: false, error: `UltraMsg request failed (${name})` };
  }
}

export async function sendWhatsAppOtp(to: string, otp: string): Promise<WhatsAppSendResult> {
  return sendWhatsAppText(
    to,
    `رمز تسجيل الدخول إلى حضانة EC هو: ${otp}\nصالح لمدة 5 دقائق. لا تشارك الرمز مع أي شخص.`,
  );
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
