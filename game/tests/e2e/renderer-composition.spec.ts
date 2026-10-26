import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expectRestoredSnapshot, loadViaUi, saveViaUi, snapshot, startMatch } from './gameplay-helper';
import { retainEvidence } from './e2e-helper';

const HAS_ASSETS = existsSync(fileURLToPath(new URL('../../public/assets/maps/maps.json', import.meta.url)));

async function screenshotPixels(page: Page, png: Buffer) {
  return page.evaluate(async base64 => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const pixels: number[][] = [];
    for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) {
      pixels.push(Array.from(ctx.getImageData(Math.floor(bitmap.width * x / 20), Math.floor(bitmap.height * y / 20), 1, 1).data));
    }
    bitmap.close();
    return pixels;
  }, png.toString('base64'));
}

async function expectVisibleBoard(page: Page) {
  const pixels = await screenshotPixels(page, await page.locator('canvas.board').screenshot());
  const colored = pixels.filter(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 20 && Math.max(r, g, b) > 40);
  expect(colored.length / pixels.length, 'Final composed board must contain map pixels').toBeGreaterThan(0.25);
}

test.describe('Production renderer composition and fallback', () => {
  test.skip(!HAS_ASSETS && !process.env.E2E_REMOTE_ASSETS, 'Private full assets are required');

  test('transparent HUD reveals WebGL pixels and context loss returns to Canvas', async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await startMatch(page);
    const state = await snapshot(page);
    await saveViaUi(page);
    await expectVisibleBoard(page);
    await retainEvidence(testInfo, 'canvas-baseline.png', await page.locator('canvas.board').screenshot(), 'image/png');
    await page.goto('./?renderer=webgl');
    await loadViaUi(page);
    const restored = await snapshot(page);
    expectRestoredSnapshot(restored, state);
    await expect.poll(() => page.evaluate(() => (window as any).__rich4Perf().backend)).toBe('webgl');
    const alphas = await page.locator('canvas.board').evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')!;
      const alphas: number[] = [];
      for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) {
        alphas.push(ctx.getImageData(Math.floor(canvas.width * x / 20), Math.floor(canvas.height * y / 20), 1, 1).data[3]);
      }
      return { enabled: ctx.getContextAttributes().alpha, alphas };
    });
    // WebKit may omit alpha in getContextAttributes(); the sampled transparent pixels below are authoritative.
    if (alphas.enabled !== undefined) expect(alphas.enabled).toBe(true);
    expect(alphas.alphas.filter(a => a === 0).length).toBeGreaterThan(180);
    const composed = await page.locator('canvas.board').screenshot();
    await retainEvidence(testInfo, 'webgl-composed.png', composed, 'image/png');
    const visible = await screenshotPixels(page, composed);
    await page.locator('canvas.board').evaluate(el => { el.style.visibility = 'hidden'; });
    const underlay = await screenshotPixels(page, await page.locator('canvas.webgl-backend').screenshot());
    await page.locator('canvas.board').evaluate(el => { el.style.visibility = ''; });
    const transparent = alphas.alphas.map((a, i) => a === 0 ? i : -1).filter(i => i >= 0);
    const matches = transparent.filter(i => visible[i].slice(0, 3).every((v, c) => Math.abs(v - underlay[i][c]) < 20));
    expect(matches.length / transparent.length, 'Composed screenshot must retain the visible WebGL underlay').toBeGreaterThan(0.9);
    await expectVisibleBoard(page);
    await page.locator('canvas.webgl-backend').evaluate((canvas: HTMLCanvasElement) => {
      const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl'))!;
      gl.getExtension('WEBGL_lose_context')!.loseContext();
    });
    await expect.poll(() => page.evaluate(() => (window as any).__rich4Perf().backend)).toBe('canvas');
    await expect(page.locator('canvas.webgl-backend')).toHaveCount(0);
    await expectVisibleBoard(page);
    expect(await snapshot(page)).toEqual(restored);
  });

  test('WebGL creation failure keeps the original playable Canvas board', async ({ page }) => {
    test.setTimeout(60000);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === 'webgl' || kind === 'webgl2') return null;
        return original.call(this, kind as '2d', ...args as []) as any;
      } as typeof original;
    });
    await startMatch(page, 'webgl');
    await expect.poll(() => page.evaluate(() => (window as any).__rich4Perf().backend)).toBe('canvas');
    await expect(page.locator('canvas.board-renderer')).toHaveCount(0);
    await expectVisibleBoard(page);
    await page.locator('.go').click();
    await expect(page.locator('.go')).toBeHidden();
  });
});
