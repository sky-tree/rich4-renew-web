import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { retainEvidence } from './e2e-helper';

const HAS_ASSETS = existsSync(fileURLToPath(new URL('../../public/assets/maps/maps.json', import.meta.url)));
test.skip(!HAS_ASSETS, 'Private assets are required');

async function start(page: Page, map = 2) {
  await page.goto('./');
  await page.locator('[data-act="start"]').click();
  await page.locator('[data-count="2"]').click();
  if (map === 107) await page.locator('[data-maps="custom"]').click();
  await page.locator(`[data-map="${map}"]`).click();
  // Three dice available, so a reset to the previous roll is observable.
  await page.locator('[data-step="traffic"][data-d="1"]').first().click({ clickCount: 2 });
  await page.locator('[data-go="1"]').click();
  if (map === 107) await page.locator('.jq-intro').click({ timeout: 30000 });
  await expect(page.locator('.go')).toBeVisible({ timeout: 30000 });
}

test('chosen dice survive stock, card and tool menus within the turn', async ({ page }) => {
  test.setTimeout(90000);
  await start(page);
  await expect(page.locator('.go [data-n]')).toHaveCount(3);
  await page.locator('.go [data-n="1"]').click();
  const images = () => page.locator('.go-slots img').evaluateAll(els => els.map(el => (el as HTMLImageElement).src));
  const selected = await images();
  for (const action of ['stock', 'card', 'tool']) {
    await page.locator(`nav.toolbar [data-key="${action}"]`).click();
    if (action === 'stock') await page.locator('.stocks .sheet-close button').click();
    else {
      // Empty inventories return to GO after a message; populated ones have a cancel button.
      const cancel = page.getByRole('button', { name: '取消', exact: true }).last();
      await expect.poll(async () => await cancel.count() > 0 || await page.locator('.go').isVisible()).toBe(true);
      if (await cancel.count()) await cancel.click();
    }
    await expect(page.locator('.go')).toBeVisible();
    expect(await images()).toEqual(selected);
  }
});

test('Simplified company fees settle with both text observers active', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => localStorage.setItem('rich4.lang', 'hans'));
  await start(page, 107);
  const text = await page.evaluate(async () => {
    const fee = document.createElement('span');
    fee.title = '工程費'; fee.textContent = '工程費';
    document.querySelector('.game')!.append(fee);
    await new Promise(resolve => setTimeout(resolve, 150));
    return { text: fee.textContent, title: fee.title };
  });
  expect(text).toEqual({ text: '基建工程费', title: '基建工程费' });
  // A frozen MutationObserver loop cannot serve this later browser task.
  await expect(page.locator('.go')).toBeVisible();
});

test('settings fit tablet and phone viewports and preserve language chip labels', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.locator('[data-act="option"]').click();
  for (const [width, height] of [[1024, 768], [768, 1024], [390, 844], [360, 780], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('.sys-grid')).toBeVisible();
    await expect.poll(() => page.locator('.sys-sheet').evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    })).toBe(true);
    expect(await page.locator('.sys-grid .cell').count()).toBeGreaterThan(8);
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await retainEvidence(testInfo, 'settings-tablet.png', await page.locator('.sys-sheet').screenshot(), 'image/png');
  await expect(page.locator('.sys-grid [data-nozh]')).toContainText('繁體');
  await expect(page.locator('.sys-grid [data-nozh]')).toContainText('简体');
});

test('Canvas backing dimensions recover without a resize event', async ({ page }) => {
  test.setTimeout(60000);
  await start(page);
  await page.locator('canvas.board').evaluate((el: HTMLCanvasElement) => { el.width = 4; el.height = 4; });
  await expect.poll(() => page.locator('canvas.board').evaluate((el: HTMLCanvasElement) => {
    const ratio = Math.min(2, devicePixelRatio || 1);
    return Math.abs(el.width - el.offsetWidth * ratio) < 2 && Math.abs(el.height - el.offsetHeight * ratio) < 2;
  })).toBe(true);
});
