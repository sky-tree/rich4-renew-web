import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem } from 'node:os';
import { loadViaUi, saveViaUi, snapshot } from './gameplay-helper';
import { assertCleanBoot, setupDiagnostics, retainEvidence } from './e2e-helper';

const HAS_ASSETS = existsSync(fileURLToPath(new URL('../../public/assets/maps/maps.json', import.meta.url)));

// An isolated Nginx access log includes requests made by the service worker too.
// No headers, queries, addresses or credentials are recorded by the fixture.
function originTraffic() {
  const path = process.env.E2E_ORIGIN_LOG;
  const records = () => path ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  let offset = records().length;
  return {
    reset: () => { offset = records().length; },
    report: () => {
      if (!path) return null;
      const requests = records().slice(offset);
      return { bytesSent: requests.reduce((sum, r) => sum + r.bytesSent, 0), requestCount: requests.length, requests };
    },
  };
}

/** CDP encodedDataLength is actual HTTP transfer, including headers; cached bytes
 * remain zero. Content-Length and decoded response bodies are not transfer sizes. */
async function trackTraffic(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  const requests = new Map<string, { path: string; status: number; encodedBytes: number; cached: boolean; serviceWorker: boolean }>();
  session.on('Network.responseReceived', ({ requestId, response }) => {
    const url = new URL(response.url);
    if (url.origin !== new URL(page.url()).origin) return;
    requests.set(requestId, { path: url.pathname, status: response.status, encodedBytes: 0,
      cached: Boolean(response.fromDiskCache || response.fromPrefetchCache), serviceWorker: Boolean(response.fromServiceWorker) });
  });
  session.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const request = requests.get(requestId);
    if (request) request.encodedBytes = encodedDataLength;
  });
  return {
    reset: () => requests.clear(),
    report: () => ({ encodedBytes: [...requests.values()].reduce((sum, r) => sum + r.encodedBytes, 0),
      requestCount: requests.size, requests: [...requests.values()] }),
    close: () => session.detach(),
  };
}

async function navigationTiming(page: Page) {
  return page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { domContentLoadedMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd,
      serviceWorkerControlled: Boolean(navigator.serviceWorker.controller), userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: (navigator as any).deviceMemory ?? null };
  });
}

async function sampleRenderer(page: Page) {
  // Use a fresh steady-state window and retain every real rAF interval.
  await page.waitForTimeout(1500);
  return page.evaluate(() => new Promise(resolve => {
    const intervalsMs: number[] = [], heapSamplesBytes: number[] = [];
    let last = 0;
    const frame = (now: number) => {
      if (last) intervalsMs.push(now - last);
      last = now;
      const heap = (performance as any).memory?.usedJSHeapSize;
      if (heap && intervalsMs.length % 30 === 0) heapSamplesBytes.push(heap);
      if (intervalsMs.length < 300) { requestAnimationFrame(frame); return; }
      const ordered = [...intervalsMs].sort((a, b) => a - b);
      const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
      resolve({ intervalsMs, heapSamplesBytes, sampleCount: intervalsMs.length,
        fpsAvg: 1000 / mean(intervalsMs), fps1Low: 1000 / mean(ordered.slice(-Math.ceil(ordered.length * 0.01))),
        p50Ms: ordered[Math.floor(ordered.length * 0.5)], p95Ms: ordered[Math.floor(ordered.length * 0.95)],
        p99Ms: ordered[Math.floor(ordered.length * 0.99)], longFrames: intervalsMs.filter(ms => ms > 50).length,
        sampledHeapPeakBytes: heapSamplesBytes.length ? Math.max(...heapSamplesBytes) : null,
        telemetry: (window as any).__rich4Perf() });
    };
    requestAnimationFrame(frame);
  }));
}

test.describe('Production transfer and rendering benchmarks', () => {
  test.skip(!HAS_ASSETS && !process.env.E2E_REMOTE_ASSETS, 'Full assets required for meaningful loading measurements');
  test('cold/warm full menu transfer and paired Canvas/WebGL sample', async ({ page, browser }, testInfo) => {
    test.setTimeout(120000);
    expect(process.env.E2E_DEV_SERVER, 'Performance acceptance must use a production build').not.toBe('1');
    const diag = setupDiagnostics(page);
    const traffic = await trackTraffic(page);
    const origin = originTraffic();
    try {
      await page.goto('./');
      await expect(page.locator('button[data-act="start"]')).toBeVisible({ timeout: 20000 });
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await page.waitForLoadState('networkidle');
      const cold = { ...traffic.report(), origin: origin.report(), ...await navigationTiming(page) };
      expect(cold.requestCount).toBeGreaterThan(0);
      expect(cold.requests.some(r => r.path.includes('/src/') || r.path.includes('/@vite/'))).toBe(false);
      expect(cold.origin?.bytesSent ?? cold.encodedBytes, 'Cold menu including SW precache when origin log is supplied').toBeLessThanOrEqual(10 * 1024 * 1024);
      traffic.reset();
      origin.reset();
      await page.reload();
      await expect(page.locator('button[data-act="start"]')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const warm = { ...traffic.report(), origin: origin.report(), ...await navigationTiming(page) };
      expect(warm.serviceWorkerControlled).toBe(true);
      await page.locator('button[data-act="start"]').click();
      await page.locator('button[data-count="2"]').click();
      await page.locator('button[data-map="2"]').click();
      traffic.reset();
      origin.reset();
      await page.locator('button[data-go="1"]').click();
      await expect(page.locator('.go')).toBeVisible({ timeout: 30000 });
      await page.waitForLoadState('networkidle');
      const firstMap = { ...traffic.report(), origin: origin.report() };
      const state = await snapshot(page);
      await saveViaUi(page);
      const canvas = await sampleRenderer(page);
      await page.goto('./?renderer=webgl');
      await loadViaUi(page);
      expect(await snapshot(page)).toEqual(state);
      await expect.poll(() => page.evaluate(() => (window as any).__rich4Perf().backend)).toBe('webgl');
      const webgl = await sampleRenderer(page);
      const manifestResponse = await page.request.get('./release-manifest.json');
      expect(manifestResponse.ok()).toBe(true);
      const manifest = await manifestResponse.json();
      const report = { schemaVersion: 2, timestamp: new Date().toISOString(), build: manifest,
        environment: { browser: browser.version(), platform: process.platform, arch: process.arch,
          cpu: cpus()[0]?.model, hostMemoryBytes: totalmem(),
          endpoint: new URL(page.url()).pathname, network: 'unthrottled; record actual host and link in acceptance report' },
        cold, warm, firstMap, renderers: { canvas, webgl },
        limitations: ['CDP page traffic excludes some background SW transfers; origin log is authoritative when supplied',
          'Nginx bytes_sent includes HTTP headers and compressed bodies, excludes TLS/TCP overhead',
          'Heap samples are not process or GPU peak memory', 'One run per viewport; repeat on real target devices'] };
      await retainEvidence(testInfo, 'benchmark-raw.json', JSON.stringify(report, null, 2), 'application/json');
      await assertCleanBoot(page, diag);
    } finally { await traffic.close(); }
  });
});
