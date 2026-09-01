import { defineConfig } from '@playwright/test';
import { initializeGalleryRunIdentity } from './tests/e2e/test-user';

const apiPort = 5180;
const galleryRunIdentity = initializeGalleryRunIdentity();

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `test-results/${galleryRunIdentity.runId}`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './tests/e2e/global.setup.ts',
  globalTeardown: './tests/e2e/global.teardown.ts',
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      testMatch: /site-gallery\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    locale: 'ar-KW',
    timezoneId: 'Asia/Kuwait',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `PORT=${apiPort} pnpm --filter @workspace/api-server run dev`,
      url: `http://127.0.0.1:${apiPort}/api/public/site-gallery`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `PORT=4174 BASE_PATH=/ E2E_API_TARGET=http://127.0.0.1:${apiPort} pnpm run dev`,
      url: 'http://127.0.0.1:4174/e2e/parent-invoices.html',
      reuseExistingServer: !process.env.CI,
    },
  ],
});