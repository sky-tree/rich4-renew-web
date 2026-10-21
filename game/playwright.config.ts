import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PORT = 5173;
const DEV = process.env.E2E_DEV_SERVER === '1';
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}/${DEV ? '' : 'rich4/'}`;
const PRIVATE_STAGING = process.env.E2E_STAGING_AUTH === '1';
function stagingCredentials() {
  const origin = 'https://rich4-staging.gopeaks.club';
  if (new URL(BASE_URL).origin !== origin) throw new Error('Staging credentials require the dedicated HTTPS origin');
  // Read via the authenticated maintenance channel into memory only. Never put
  // secrets in CLI arguments, environment values, traces or report metadata.
  const text = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ControlMaster=auto', '-o', 'ControlPersist=120', '-o', 'ControlPath=/tmp/rich4-staging-ssh-%r@%h:%p', 'gopeaks',
    'sudo -n -u devspace cat /srv/devspace/repos/rich4-runtime/state/beta-credentials.txt'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const field = (key: string) => text.match(new RegExp(`^${key}\\s*[:=]\\s*(.+)$`, 'mi'))?.[1].trim();
  const username = field('username'), password = field('password');
  if (!username || !password) throw new Error('Unsupported private staging credential format');
  return { username, password, origin };
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker avoids port/storage collision
  reporter: PRIVATE_STAGING ? [['list']] : [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
  ],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: BASE_URL,
    httpCredentials: PRIVATE_STAGING ? stagingCredentials() : undefined,
    trace: PRIVATE_STAGING ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: PRIVATE_STAGING ? 'off' : 'retain-on-failure',
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
