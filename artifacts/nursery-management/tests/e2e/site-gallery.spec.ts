import { expect, test, type Page } from '@playwright/test';
import { getGalleryRunIdentity, signInGalleryTestUser } from './test-user';

const galleryIdentity = getGalleryRunIdentity();
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function signInAsGalleryAdmin(page: Page) {
  const { token, user } = await signInGalleryTestUser();
  await page.goto('/');
  await page.evaluate(({ t, u }) => {
    localStorage.setItem('ec_jwt', t);
    localStorage.setItem('ec_user', JSON.stringify(u));
  }, { t: token, u: user });
  await page.goto('/site-gallery');
  await expect(page.getByRole('heading', { name: 'ألبوم الصور' })).toBeVisible();
}

async function cleanGalleryItems(page: Page) {
  await page.evaluate(async (prefix) => {
    const response = await fetch('/api/site-gallery');
    if (!response.ok) return;
    const items = await response.json() as Array<{ id: number; title: string }>;
    await Promise.all(items
      .filter((item) => item.title.startsWith(prefix))
      .map((item) => fetch(`/api/site-gallery/${item.id}`, { method: 'DELETE' })));
  }, galleryIdentity.dataPrefix);
}

test('يرفع المدير صورة وينشرها ثم يخفيها ويحذفها دون ترك بيانات', async ({ browser, page }, testInfo) => {
  const itemId = `${testInfo.project.name}-${Date.now()}`;
  const title = `${galleryIdentity.dataPrefix}${itemId}`;
  const altText = `صورة ألبوم اختبار ${galleryIdentity.runId}-${itemId}`;

  await signInAsGalleryAdmin(page);
  await cleanGalleryItems(page);

  try {
    await page.locator('input[type="file"]').setInputFiles({
      name: `${itemId}.png`,
      mimeType: 'image/png',
      buffer: png,
    });
    await page.getByText('العنوان', { exact: true }).locator('input').fill(title);
    await page.getByText('النص البديل', { exact: true }).locator('input').fill(altText);
    const attached = page.waitForResponse((response) =>
      response.url().endsWith('/api/site-gallery')
      && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'رفع وإضافة' }).click();
    expect((await attached).status()).toBe(201);

    const card = page.locator('article').filter({
      has: page.locator(`input[aria-label="العنوان"][value="${title}"]`),
    });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator('select')).toHaveValue('draft');

    const published = page.waitForResponse((response) =>
      response.url().includes('/api/site-gallery/')
      && response.request().method() === 'PATCH'
      && response.request().postDataJSON()?.status === 'published',
    );
    await card.locator('select').selectOption('published');
    expect((await published).status()).toBe(200);
    await expect(card.locator('select')).toHaveValue('published');

    const publicContext = await browser.newContext({
      locale: 'ar-KW',
      timezoneId: 'Asia/Kuwait',
      viewport: testInfo.project.use.viewport,
    });
    const publicPage = await publicContext.newPage();
    try {
      const publicImageResponse = publicPage.waitForResponse((response) =>
        response.url().includes('/api/public/site-gallery/')
        && response.url().endsWith('/image'),
      );
      await publicPage.goto('/');
      const publishedImage = publicPage.getByRole('img', { name: altText });
      await expect(publishedImage).toBeVisible();
      expect((await publicImageResponse).status()).toBe(200);
      await expect(publishedImage).toHaveJSProperty('naturalWidth', 1);

      const hidden = page.waitForResponse((response) =>
        response.url().includes('/api/site-gallery/')
        && response.request().method() === 'PATCH'
        && response.request().postDataJSON()?.status === 'hidden',
      );
      await card.locator('select').selectOption('hidden');
      expect((await hidden).status()).toBe(200);
      await expect(card.locator('select')).toHaveValue('hidden');
      await publicPage.reload();
      await expect(publicPage.getByRole('img', { name: altText })).toHaveCount(0);
    } finally {
      await publicContext.close();
    }

    page.once('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: 'حذف' }).click();
    await expect(card).toHaveCount(0);
  } finally {
    await cleanGalleryItems(page);
  }
});