import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

test.describe('Actual running build and optional title update', () => {
  test.skip(process.env.E2E_BUILD_VERSION !== '1', 'Requires complete private title assets');
  const sha = process.env.E2E_EXPECT_BUILD || execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

  test('shows the compiled revision and fits phone portrait and landscape', async ({ page }) => {
    if (process.env.E2E_STAGING_AUTH === '1') {
      const response = await page.request.get('./release-manifest.json');
      expect(response.ok()).toBe(true);
      expect((await response.json()).gitSha).toBe(sha);
    } else {
      await page.route('**/release-manifest.json', route => route.fulfill({ json: { gitSha: sha } }));
    }
    await page.goto('./');
    const label = page.locator('.title-ver');
    await expect(label).toHaveText(new RegExp(`^v[0-9.]+ · ${sha}$`));
    await expect(label).toHaveAttribute('data-build', sha);
    await expect(page.locator('.title-update')).toBeHidden();
    for (const viewport of [{ width: 430, height: 750 }, { width: 932, height: 305 }]) {
      await page.setViewportSize(viewport);
      const bounds = await label.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    }
  });

  test.describe('simulated manifest responses', () => {
    // WebKit service workers can bypass Playwright routing. Keep real SW coverage
    // in the test above; these cases specifically exercise controlled HTTP responses.
    test.use({ serviceWorkers: 'block' });

    test('a different server revision offers explicit refresh without relabeling the running code', async ({ page }) => {
      const newer = sha === 'abcdef0' ? '1234567' : 'abcdef0';
      let manifestRequests = 0;
      await page.route('**/release-manifest.json', route => {
        manifestRequests++;
        return route.fulfill({ json: { gitSha: newer } });
      });
      await page.goto('./');
      await expect.poll(() => manifestRequests).toBeGreaterThan(0);
      await expect(page.locator('.title-update')).toBeVisible();
      await expect(page.locator('.title-ver')).toHaveAttribute('data-build', sha);
      await page.evaluate(() => localStorage.setItem('rich4.version-check-marker', 'keep'));
      let navigations = 0;
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      await page.locator('.title-update').click();
      await expect.poll(() => navigations).toBe(1);
      await expect(page.locator('.title-ver')).toHaveAttribute('data-build', sha);
      expect(await page.evaluate(() => localStorage.getItem('rich4.version-check-marker'))).toBe('keep');
    });

    test('an unavailable manifest leaves the running revision visible without an update prompt', async ({ page }) => {
      await page.route('**/release-manifest.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
      const response = page.waitForResponse(response => response.url().endsWith('/release-manifest.json'));
      await page.goto('./');
      expect((await response).status()).toBe(503);
      await expect(page.locator('.title-ver')).toHaveAttribute('data-build', sha);
      await expect(page.locator('.title-update')).toBeHidden();
    });
  });
});
