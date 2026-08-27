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

test('يعرض الدفع عبر KNET بالدينار فقط ويحوّل المستخدم إلى بوابة MyFatoorah', async ({ page }) => {
  await mockUnpaidInvoice(page);
  await page.route(`**/api/parent/invoices/${invoice.id}/checkout-session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://demo.myfatoorah.com/pay/test-invoice' }),
    }),
  );
  await page.goto('/e2e/parent-invoices.html');

  await expect(page.getByTestId('parent-knet-summary')).toContainText('دون تحويل عملة');
  await expect(page.getByTestId(`text-parent-knet-amount-${invoice.id}`)).toContainText(
    new Intl.NumberFormat('ar-KW', {
      style: 'currency',
      currency: 'KWD',
      minimumFractionDigits: 0,
    }).format(invoice.amount),
  );
  const button = page.getByTestId(`button-pay-invoice-${invoice.id}`);
  await expect(button).toBeEnabled();
  await expect(button).toContainText('الدفع عبر KNET');

  const requestPromise = page.waitForRequest(`**/api/parent/invoices/${invoice.id}/checkout-session`);
  await button.click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({
    returnUrl: expect.stringContaining('/parent/invoices'),
  });
});