import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  outputDir: '../../generated-artifacts/duoxing-browser',
  use: {
    // Use the shared artifact proxy, not a frontend-only Vite port.
    baseURL: process.env.DUOXING_TEST_BASE_URL || 'http://localhost:80',
    browserName: 'chromium',
    viewport: { width: 402, height: 874 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }
      : {}),
  },
});
