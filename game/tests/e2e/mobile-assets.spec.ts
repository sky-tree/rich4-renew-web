import { expect, test } from '@playwright/test';
import { retainEvidence } from './e2e-helper';
import { startMatch } from './gameplay-helper';

test.use({ trace: 'off', video: 'off' });
test.describe('transient DOM image failure', () => {
  test.use({ serviceWorkers: 'block' });
  test('retries a broken sidebar image through a fresh request', async ({ page }) => {
    test.skip(process.env.E2E_REMOTE_ASSETS !== '1', 'Requires private complete assets');
    const attempts: string[] = [];
    await page.route('**/assets/hd/Panel/0000-SMP/frame-000.webp*', route => {
      const url = new URL(route.request().url());
      attempts.push(url.searchParams.get('rich4-retry') ?? 'initial');
      return url.searchParams.has('rich4-retry') ? route.continue() : route.fulfill({ contentType: 'image/webp', body: 'broken-image-test' });
    });
    await startMatch(page);
    await expect.poll(() => attempts.some(value => value !== 'initial')).toBe(true);
    await expect.poll(() => page.locator('.pp-bg').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  });
});

test('sidebar images survive a service-worker-controlled reload', async ({ page }, testInfo) => {
  test.skip(process.env.E2E_REMOTE_ASSETS !== '1', 'Requires private complete assets');
  test.setTimeout(90000);
  const failures: { path: string; status?: number; error?: string }[] = [];
  page.on('requestfailed', request => failures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await startMatch(page);
  try {
    await expect.poll(() => page.locator('.pp img, .cal img').evaluateAll(images => images.filter(image => {
      const img = image as HTMLImageElement;
      return !img.complete || img.naturalWidth === 0;
    }).length), { timeout: 20000 }).toBe(0);
  } finally {
    const images = await page.locator('.pp img, .cal img').evaluateAll(images => images.map(image => {
      const img = image as HTMLImageElement;
      return { path: new URL(img.src).pathname, complete: img.complete, width: img.naturalWidth };
    }));
    await retainEvidence(testInfo, 'sidebar-images.json', JSON.stringify({ images, failures }, null, 2), 'application/json');
  }
});

test('mobile board and ATM art decode and controls fit in both orientations', async ({ page }, testInfo) => {
  test.skip(process.env.E2E_REMOTE_ASSETS !== '1', 'Requires the private complete-assets staging candidate');
  test.setTimeout(120000);
  const failures: { path: string; status: number }[] = [];
  page.on('response', response => {
    if (response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  try {
    await startMatch(page);
    const sprites = await page.evaluate(async () => {
      const view = (window as any).__rich4.view;
      const resources = view.boardSprites().filter((e: any) => e.a === 'map' && e.d < 300);
      return Promise.all(resources.map(async (e: any) => ({ archive: e.a, id: e.res,
        frames: (await view.bank.boardReady(e.a, e.res, e.mul))?.length ?? 0 })));
    });
    expect(sprites.length).toBeGreaterThan(0);
    expect(sprites.filter(e => e.frames === 0)).toEqual([]);
    await page.evaluate(() => {
      const hook = (window as any).__rich4;
      void hook.askScreens.bank(hook.ctx(), { t: 'bank', ask: true, p: 0, counter: false, canWithdraw: true, maxLoan: 0 });
    });
    await expect(page.locator('.bk-atm')).toBeVisible();
    const orientations = [];
    for (const viewport of [{ width: 430, height: 750 }, { width: 932, height: 305 }]) {
      await page.setViewportSize(viewport);
      const scene = page.locator('.bk-atm-scene');
      // ResizeObserver rebuilds the fixed design canvas after an orientation
      // change; image completion alone can still describe the previous layout.
      await expect.poll(() => scene.evaluate(el => {
        const root = el.parentElement!;
        return el.classList.contains('tall') === (root.clientHeight > root.clientWidth * 1.05);
      })).toBe(true);
      await expect.poll(() => scene.evaluate(el => [...el.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)),
        { timeout: 30000 }).toBe(true);
      const controls = await scene.locator('button[data-k]').evaluateAll(elements => elements.map(el => {
        const r = el.getBoundingClientRect();
        return { key: (el as HTMLElement).dataset.k, x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }));
      for (const control of controls) {
        expect(control.x).toBeGreaterThanOrEqual(0); expect(control.y).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(viewport.width + 1); expect(control.bottom).toBeLessThanOrEqual(viewport.height + 1);
      }
      orientations.push({ viewport, controls });
    }
    await retainEvidence(testInfo, 'mobile-assets.json', JSON.stringify({ mode: 'WebKit/Chromium emulation, not a physical iPhone', sprites, orientations, failures }, null, 2), 'application/json');
  } finally {
    await retainEvidence(testInfo, 'mobile-http-failures.json', JSON.stringify(failures, null, 2), 'application/json');
  }
});
