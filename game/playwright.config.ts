import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const DEV = process.env.E2E_DEV_SERVER === '1';
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}/${DEV ? '' : 'rich4/'}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker avoids port/storage collision
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
  ],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 20000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        browserName: 'chromium',
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.E2E_SKIP_SERVER
    ? undefined
    : {
        command: `npm run ${DEV ? 'dev' : 'preview'} -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 30000,
      },
});
