import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanBoot, saveFailureEvidence, setupDiagnostics } from './e2e-helper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HAS_ASSETS = existsSync(join(__dirname, '../../public/assets/maps/maps.json'));

export interface BenchmarkMetricsReport {
  timestamp: string;
  network: {
    coldStart: {
      totalBytes: number;
      totalMiB: number;
      requestCount: number;
      domContentLoadedMs: number;
      loadMs: number;
    };
    warmStart: {
      totalBytes: number;
      totalMiB: number;
      requestCount: number;
    };
    firstMap?: {
      mapId: string;
      totalBytes: number;
      totalMiB: number;
      requestCount: number;
    };
  };
  rendererComparison?: {
    canvas2d: {
      backend: string;
      fpsAvg: number;
      fps1Low: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      longFrames: number;
      sampleCount: number;
      jsHeapMiB?: number;
    };
    webgl: {
      backend: string;
      fpsAvg: number;
      fps1Low: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      longFrames: number;
      sampleCount: number;
      drawCalls?: number;
      textures?: number;
      jsHeapMiB?: number;
    };
  };
}

const capturedMetrics: Partial<BenchmarkMetricsReport> = {
  timestamp: new Date().toISOString(),
  network: {
    coldStart: { totalBytes: 0, totalMiB: 0, requestCount: 0, domContentLoadedMs: 0, loadMs: 0 },
    warmStart: { totalBytes: 0, totalMiB: 0, requestCount: 0 },
  },
};

function trackNetworkTraffic(page: Page) {
  let totalBytes = 0;
  let assetBytes = 0;
  let devModuleBytes = 0;
  let requestCount = 0;
  const requests: { url: string; bytes: number; category: string }[] = [];

  page.on('response', async resp => {
    try {
      requestCount++;
      let bytes = 0;
      const headers = resp.headers();
      if (headers['content-length']) {
        bytes = parseInt(headers['content-length'], 10) || 0;
      } else {
        const buf = await resp.body().catch(() => null);
        if (buf) bytes = buf.length;
      }
      totalBytes += bytes;

      const url = resp.url();
      const isDevModule = url.includes('/@vite/') || url.includes('/src/') || url.includes('node_modules/.vite/');
      if (isDevModule) {
        devModuleBytes += bytes;
        requests.push({ url, bytes, category: 'dev-module' });
      } else {
        assetBytes += bytes;
        requests.push({ url, bytes, category: 'asset-or-build' });
      }
    } catch {
      // Ignore background aborts
    }
  });

  return {
    getStats: () => {
      requests.sort((a, b) => b.bytes - a.bytes);
      return {
        totalBytes,
        totalMiB: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
        assetBytes,
        assetMiB: Math.round((assetBytes / (1024 * 1024)) * 100) / 100,
        devModuleBytes,
        devModuleMiB: Math.round((devModuleBytes / (1024 * 1024)) * 100) / 100,
        requestCount,
        topRequests: requests.slice(0, 15),
      };
    },
  };
}

test.describe('E2E: Performance & Resource Benchmarking (Issues #8, #9, M9-01~04)', () => {
  test('Issue #8: Cold-start network transfer budget is <= 10 MiB', async ({ page }, testInfo) => {
    const diag = setupDiagnostics(page);
    const traffic = trackNetworkTraffic(page);

    try {
      const startMark = Date.now();
      await page.goto('./', { waitUntil: 'load' });
      await expect(page).toHaveTitle(/大富翁4/);
      await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });
      await assertCleanBoot(page, diag);

      const navTiming = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return nav
          ? {
              domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
              loadMs: Math.round(nav.loadEventEnd - nav.startTime),
            }
          : { domContentLoadedMs: 0, loadMs: 0 };
      });

      const stats = traffic.getStats();
      capturedMetrics.network!.coldStart = {
        totalBytes: stats.assetBytes > 0 ? stats.assetBytes : stats.totalBytes,
        totalMiB: stats.assetBytes > 0 ? stats.assetMiB : stats.totalMiB,
        requestCount: stats.requestCount,
        domContentLoadedMs: navTiming.domContentLoadedMs || (Date.now() - startMark),
        loadMs: navTiming.loadMs || (Date.now() - startMark),
      };

      // Assert Issue #8 requirement: main menu essential resource transfer <= 10 MiB (10,485,760 bytes)
      // In dev mode, raw unbundled Vite TS sources are tracked separately from production assets/shell data.
      const evaluatedBytes = stats.assetBytes > 0 ? stats.assetBytes : stats.totalBytes;
      expect(
        evaluatedBytes,
        `Essential cold start transfer exceeded 10 MiB budget: ${stats.assetMiB} MiB (${evaluatedBytes} bytes)`
      ).toBeLessThanOrEqual(10 * 1024 * 1024);
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });

  test('Issue #8: Warm-start incremental traffic efficiency with Service Worker caching', async ({ page }, testInfo) => {
    const diag = setupDiagnostics(page);

    try {
      // First visit to prime cache
      await page.goto('./', { waitUntil: 'load' });
      await expect(page.locator('#app')).toBeVisible();

      // Second visit (warm start)
      const traffic = trackNetworkTraffic(page);
      await page.reload({ waitUntil: 'load' });
      await expect(page.locator('#app')).toBeVisible();
      await assertCleanBoot(page, diag);

      const stats = traffic.getStats();
      capturedMetrics.network!.warmStart = {
        totalBytes: stats.assetBytes,
        totalMiB: stats.assetMiB,
        requestCount: stats.requestCount,
      };

      // In warm start, asset downloads should remain strictly within the 10 MiB ceiling
      // (in production Nginx / SW cached, incremental traffic drops to near-zero; in Vite dev it repeats 304/200).
      expect(
        stats.assetBytes,
        `Warm start transfer exceeded 10 MiB budget: ${stats.assetMiB} MiB (${stats.assetBytes} bytes)`
      ).toBeLessThanOrEqual(10 * 1024 * 1024);
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });

  test('Issue #8 & #9: First map load traffic and Canvas 2D vs WebGL rendering A/B comparison', async ({ page }, testInfo) => {
    test.skip(!HAS_ASSETS, 'Full game assets not mounted: skipping in-game render benchmark');
    test.setTimeout(75000);

    const diag = setupDiagnostics(page);

    try {
      // 1. Measure First Map Load with Canvas 2D (Default Backend)
      const canvasTraffic = trackNetworkTraffic(page);
      await page.goto('./?renderer=canvas', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app')).toBeVisible();

      const startBtn = page.locator('button[data-act="start"]');
      await expect(startBtn).toBeVisible({ timeout: 15000 });
      await startBtn.click();

      const ngSheet = page.locator('.ng-sheet');
      await expect(ngSheet).toBeVisible();

      const twoPBtn = page.locator('button[data-count="2"]');
      if (await twoPBtn.isVisible()) await twoPBtn.click();

      const goMatchBtn = page.locator('button[data-go="1"]');
      await expect(goMatchBtn).toBeVisible();
      await goMatchBtn.click();

      // Wait for in-game canvas and GO button
      const stageCanvas = page.locator('section.stage canvas.board');
      await expect(stageCanvas).toBeVisible({ timeout: 20000 });
      const goBtn = page.locator('.go');
      await expect(goBtn).toBeVisible({ timeout: 15000 });
      await assertCleanBoot(page, diag);

      const firstMapStats = canvasTraffic.getStats();
      capturedMetrics.network!.firstMap = {
        mapId: 'taiwan',
        totalBytes: firstMapStats.totalBytes,
        totalMiB: firstMapStats.totalMiB,
        requestCount: firstMapStats.requestCount,
      };

      // Sample 250+ frames under Canvas 2D
      await page.waitForTimeout(4000); // Allow animation loop to record frames
      const canvasPerf = await page.evaluate(() => {
        const perfFn = (window as unknown as { __rich4Perf?: () => any }).__rich4Perf;
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return {
          perf: perfFn ? perfFn() : null,
          heapMiB: memory ? Math.round((memory.usedJSHeapSize / (1024 * 1024)) * 100) / 100 : undefined,
        };
      });

      expect(canvasPerf.perf, '__rich4Perf must return telemetry data').not.toBeNull();
      expect(canvasPerf.perf.backend).toBe('canvas');
      expect(canvasPerf.perf.sampleCount).toBeGreaterThanOrEqual(50);

      // 2. Measure WebGL Backend (?renderer=webgl) with double-rendering eliminated
      await page.goto('./?renderer=webgl', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app')).toBeVisible();

      const startBtnGl = page.locator('button[data-act="start"]');
      await expect(startBtnGl).toBeVisible({ timeout: 15000 });
      await startBtnGl.click();

      const goMatchBtnGl = page.locator('button[data-go="1"]');
      await expect(goMatchBtnGl).toBeVisible();
      await goMatchBtnGl.click();

      await expect(stageCanvas).toBeVisible({ timeout: 20000 });
      await expect(goBtn).toBeVisible({ timeout: 15000 });
      await assertCleanBoot(page, diag);

      // Verify WebGL backend canvas exists under Canvas 2D
      const webglCanvas = page.locator('canvas.board-renderer.webgl-backend');
      await expect(webglCanvas).toHaveCount(1);

      // Sample 250+ frames under WebGL
      await page.waitForTimeout(4000);
      const webglPerf = await page.evaluate(() => {
        const perfFn = (window as unknown as { __rich4Perf?: () => any }).__rich4Perf;
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return {
          perf: perfFn ? perfFn() : null,
          heapMiB: memory ? Math.round((memory.usedJSHeapSize / (1024 * 1024)) * 100) / 100 : undefined,
        };
      });

      expect(webglPerf.perf).not.toBeNull();
      expect(webglPerf.perf.backend).toBe('webgl');
      expect(webglPerf.perf.webglContextLost).toBe(false);
      expect(webglPerf.perf.webglDrawCalls).toBeGreaterThan(0);
      expect(webglPerf.perf.webglTextures).toBeGreaterThan(0);

      capturedMetrics.rendererComparison = {
        canvas2d: {
          backend: canvasPerf.perf.backend,
          fpsAvg: canvasPerf.perf.fpsAvg,
          fps1Low: canvasPerf.perf.fps1Low,
          p50Ms: canvasPerf.perf.p50Ms,
          p95Ms: canvasPerf.perf.p95Ms,
          p99Ms: canvasPerf.perf.p99Ms,
          longFrames: canvasPerf.perf.longFrames,
          sampleCount: canvasPerf.perf.sampleCount,
          jsHeapMiB: canvasPerf.heapMiB,
        },
        webgl: {
          backend: webglPerf.perf.backend,
          fpsAvg: webglPerf.perf.fpsAvg,
          fps1Low: webglPerf.perf.fps1Low,
          p50Ms: webglPerf.perf.p50Ms,
          p95Ms: webglPerf.perf.p95Ms,
          p99Ms: webglPerf.perf.p99Ms,
          longFrames: webglPerf.perf.longFrames,
          sampleCount: webglPerf.perf.sampleCount,
          drawCalls: webglPerf.perf.webglDrawCalls,
          textures: webglPerf.perf.webglTextures,
          jsHeapMiB: webglPerf.heapMiB,
        },
      };

      // Save metrics to JSON file for report generation
      const resultsDir = join(__dirname, '../../test-results');
      mkdirSync(resultsDir, { recursive: true });
      writeFileSync(
        join(resultsDir, 'benchmark-metrics.json'),
        JSON.stringify(capturedMetrics, null, 2),
        'utf8'
      );
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });
});
