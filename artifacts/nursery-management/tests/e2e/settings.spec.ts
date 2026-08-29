import { expect, test, type Page } from '@playwright/test';

const initialSettings = {
  id: 1,
  nurseryName: 'حضانة الاختبار',
  registrationWhatsApp: '96590916677',
  timezone: 'Asia/Kuwait',
  currency: 'KWD',
  workingHours: {
    sunday: { open: '07:00', close: '14:00' },
    monday: { open: '07:00', close: '14:00' },
    tuesday: { open: '07:00', close: '14:00' },
    wednesday: { open: '07:00', close: '14:00' },
    thursday: { open: '07:00', close: '14:00' },
  },
  calendar: { weekend: ['friday', 'saturday'], holidays: [] as string[] },
  updatedBy: 'test-admin',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

async function mockSettings(page: Page) {
  let saved = structuredClone(initialSettings);
  const requests: unknown[] = [];
  await page.route('**/api/nursery/settings', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      requests.push(body);
      saved = { ...saved, ...body, updatedAt: '2026-08-27T01:00:00.000Z' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) });
  });
  return requests;
}

test('يتحقق من الساعات ويحفظ اليوم المعطل والعطلة بعد إعادة التحميل', async ({ page }) => {
  const requests = await mockSettings(page);
  await page.goto('/e2e/settings.html');

  await expect(page.getByRole('heading', { name: 'ساعات العمل الأسبوعية' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(7);

  await page.getByLabel('وقت الفتح الأحد').fill('15:00');
  await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
  await expect(page.getByRole('alert')).toContainText('يجب أن يسبق وقت الفتح وقت الإغلاق ليوم الأحد');
  expect(requests).toHaveLength(0);

  await page.getByLabel('وقت الفتح الأحد').fill('08:00');
  await page.getByRole('checkbox').nth(4).uncheck();
  await page.getByLabel('تاريخ العطلة').fill('2026-12-17');
  await page.getByRole('button', { name: 'إضافة عطلة' }).click();
  await page.getByLabel('تاريخ العطلة').fill('2026-12-17');
  await page.getByRole('button', { name: 'إضافة عطلة' }).click();
  await expect(page.getByRole('alert')).toContainText('هذا التاريخ مضاف بالفعل');

  await page.getByRole('button', { name: 'حفظ الإعدادات' }).click();
  await expect(page.getByText('تم حفظ الإعدادات بنجاح.')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    workingHours: { sunday: { open: '08:00', close: '14:00' } },
    calendar: { weekend: ['thursday', 'friday', 'saturday'], holidays: ['2026-12-17'] },
  });
  expect((requests[0] as { workingHours: Record<string, unknown> }).workingHours).not.toHaveProperty('thursday');

  await page.reload();
  await expect(page.getByRole('checkbox').nth(4)).not.toBeChecked();
  const formattedHoliday = new Intl.DateTimeFormat('ar-KW', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date('2026-12-17'));
  await expect(page.getByText(formattedHoliday, { exact: true })).toBeVisible();
});