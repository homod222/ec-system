import { expect, test } from '@playwright/test';

test('switches the public site between Arabic and English and persists the choice', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('language-switcher')).toBeVisible();

  await page.getByTestId('button-language-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Growing knowledge and nurturing creativity.' })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Growing knowledge and nurturing creativity.' })).toBeVisible();

  await page.getByTestId('button-language-ar').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('shows the language switcher on authentication pages', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByTestId('language-switcher')).toBeVisible();

  await page.getByTestId('button-language-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('renders admin and parent harnesses in the stored English locale', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('ec-nursery.locale.v1', 'en'));

  await page.route('**/api/nursery/settings', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 1,
      nurseryName: 'EC Nursery',
      registrationWhatsApp: '96590916677',
      timezone: 'Asia/Kuwait',
      currency: 'KWD',
      workingHours: {},
      calendar: { weekend: ['friday', 'saturday'], holidays: [] },
      updatedBy: 'test-admin',
      updatedAt: '2026-08-28T00:00:00.000Z',
    }),
  }));
  await page.goto('/e2e/settings.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'General settings' })).toBeVisible();

  await page.route('**/api/parent/invoices', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 811,
      invoiceNumber: 'E2E-811',
      guardianName: 'Test guardian',
      childName: 'Test child',
      amount: 125,
      dueDate: '2026-08-31',
      status: 'pending',
      paidAt: null,
      lastPaymentStatus: null,
      lastPaymentError: null,
      chargedCurrency: null,
      chargedAmount: null,
    }]),
  }));
  await page.goto('/e2e/parent-invoices.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Invoices and fees' })).toBeVisible();
});