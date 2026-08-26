import { expect, test, type Page } from '@playwright/test';

const invoice = {
  id: 811,
  invoiceNumber: 'E2E-811',
  guardianName: 'ولي أمر الاختبار',
  childName: 'طفل الاختبار',
  amount: 125,
  dueDate: '2026-08-31',
  status: 'pending',
  paidAt: null,
  lastPaymentStatus: null,
  lastPaymentError: null,
  chargedCurrency: null,
  chargedAmount: null,
};

async function mockUnpaidInvoice(page: Page) {
  await page.route('**/api/parent/invoices', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([invoice]) }),
  );
}

test('يعرض السعر الحديث ووقت التحديث وتقدير الدولار وتنبيه تثبيت المبلغ', async ({ page }) => {
  const rate = 3.2517;
  const updatedAt = '2026-08-26T07:15:00.000Z';
  await mockUnpaidInvoice(page);
  await page.route('**/api/exchange-rates/kwd-usd', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        baseCurrency: 'KWD',
        quoteCurrency: 'USD',
        rate,
        updatedAt,
      }),
    }),
  );

  await page.goto('/e2e/parent-invoices.html');

  const summary = page.getByTestId('parent-exchange-rate-summary');
  await expect(summary).toContainText(
    rate.toLocaleString('ar-KW', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
  );
  await expect(summary).toContainText(
    new Date(updatedAt).toLocaleString('ar-KW', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kuwait',
    }),
  );

  const estimate = page.getByTestId(`text-parent-usd-estimate-${invoice.id}`);
  await expect(estimate).toContainText(
    (invoice.amount * rate).toLocaleString('ar-KW', { style: 'currency', currency: 'USD' }),
  );
  await expect(estimate).toContainText('يُثبّت المبلغ النهائي عند إنشاء جلسة الدفع.');
  await expect(page.getByTestId(`button-pay-invoice-${invoice.id}`)).toBeEnabled();
});

test('يعطّل الدفع عندما لا يعود السعر صالحًا', async ({ page }) => {
  await mockUnpaidInvoice(page);
  await page.route('**/api/exchange-rates/kwd-usd', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'EXCHANGE_RATE_UNAVAILABLE',
        error: 'انتهت صلاحية سعر الصرف المخزن',
      }),
    }),
  );

  await page.goto('/e2e/parent-invoices.html');

  await expect(page.getByTestId('parent-exchange-rate-summary')).toContainText(
    'لا يتوفر حاليًا سعر تحويل حديث؛ لن يبدأ الدفع حتى يتوفر سعر صالح.',
  );
  await expect(page.getByTestId(`text-parent-usd-estimate-${invoice.id}`)).toContainText(
    'لا يمكن حساب المبلغ بالدولار دون سعر تحويل حديث.',
  );
  await expect(page.getByTestId(`button-pay-invoice-${invoice.id}`)).toBeDisabled();
});