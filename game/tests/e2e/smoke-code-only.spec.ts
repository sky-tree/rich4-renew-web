import { expect, test } from '@playwright/test';
import { assertCleanBoot, saveFailureEvidence, setupDiagnostics } from './e2e-helper';

test.describe('E2E: Code-Only Smoke and App Shell (Issue #6, T-01, T-10)', () => {
  test('renders app shell cleanly without fatal boot errors or uncaught exceptions', async ({ page }, testInfo) => {
    const diag = setupDiagnostics(page);

    try {
      await page.goto('./', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveTitle(/大富翁4/);

      // Verify #app root is mounted
      const appRoot = page.locator('#app');
      await expect(appRoot).toBeVisible({ timeout: 10000 });

      // Fatal boot crash panel (#boot-err) must never be visible
      await assertCleanBoot(page, diag);

      // Check that PWA link elements exist in head
      const manifestLink = page.locator('link[rel="manifest"]');
      await expect(manifestLink).toHaveCount(1);
      const manifestHref = await manifestLink.getAttribute('href');
      expect(manifestHref).toContain('manifest.webmanifest');

      const iconLink = page.locator('link[rel="apple-touch-icon"]');
      await expect(iconLink).toHaveCount(1);
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });

  test('manifest.webmanifest returns valid JSON with standalone icons', async ({ request }) => {
    const resp = await request.get('./manifest.webmanifest');
    expect(resp.status()).toBe(200);

    const body = await resp.json();
    expect(body.name).toContain('大富翁4');
    expect(body.display).toBe('standalone');
    expect(Array.isArray(body.icons)).toBe(true);
    expect(body.icons.length).toBeGreaterThanOrEqual(2);

    for (const icon of body.icons) {
      const iconResp = await request.get(icon.src);
      expect(iconResp.status(), `Icon ${icon.src} returned status ${iconResp.status()}`).toBe(200);
      const buf = await iconResp.body();
      expect(buf.length).toBeGreaterThan(1000);
      // PNG header check
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
    }
  });

  test('responsive viewport adaptation (desktop vs mobile landscape/portrait)', async ({ page }, testInfo) => {
    const diag = setupDiagnostics(page);

    try {
      // Test mobile landscape
      await page.setViewportSize({ width: 844, height: 390 });
      await page.goto('./', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app')).toBeVisible();
      await assertCleanBoot(page, diag);

      // Test mobile portrait
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      await expect(page.locator('#app')).toBeVisible();
      await assertCleanBoot(page, diag);
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });
});
