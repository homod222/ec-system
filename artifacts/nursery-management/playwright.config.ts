import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    locale: 'ar-KW',
    timezoneId: 'Asia/Kuwait',
  },
  webServer: {
    command: 'PORT=4174 BASE_PATH=/ pnpm run dev',
    url: 'http://127.0.0.1:4174/e2e/parent-invoices.html',
    reuseExistingServer: !process.env.CI,
  },
});