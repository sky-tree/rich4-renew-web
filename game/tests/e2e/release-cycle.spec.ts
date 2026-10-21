import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { saveViaUi, loadViaUi, startMatch, snapshot, rollAndObserve } from './gameplay-helper';
import { retainEvidence, setupDiagnostics } from './e2e-helper';

test.use({ trace: 'off', video: 'off' });

test('real Nginx A -> B -> A updates the SW shell and preserves a UI save', async ({ browser }, testInfo) => {
  test.skip(process.env.E2E_NGINX !== '1', 'Requires NGINX_BIN, NGINX_MIME_TYPES and a full production build');
  test.setTimeout(180000);
  const temp = mkdtempSync(join(tmpdir(), 'rich4-release-cycle-'));
  const dist = resolve('dist');
  const runtime = join(temp, 'runtime');
  mkdirSync(runtime);
  mkdirSync(join(temp, 'logs'));
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entry = /src="\/rich4\/assets\/(index-[^"]+\.js)"/.exec(html)![1];
  for (const version of ['A', 'B-version-two']) {
    const dir = join(temp, version);
    mkdirSync(join(dir, 'assets'), { recursive: true });
    for (const item of readdirSync(dist)) {
      if (['assets', 'index.html', 'sw.js', 'release-manifest.json'].includes(item)) continue;
      symlinkSync(join(dist, item), join(dir, item));
    }
    for (const item of readdirSync(join(dist, 'assets'))) {
      if (item !== entry) symlinkSync(join(dist, 'assets', item), join(dir, 'assets', item));
    }
    const versionEntry = `index-rc-${version}.js`;
    writeFileSync(join(dir, 'assets', versionEntry), `/* ${version} */\n${readFileSync(join(dist, 'assets', entry), 'utf8')}`);
    writeFileSync(join(dir, 'index.html'), html.replaceAll(entry, versionEntry).replace('</head>', `<meta name="candidate" content="${version}"></head>`));
    const sw = readFileSync(join(dist, 'sw.js'), 'utf8').replaceAll(entry, versionEntry)
      .replace(/const SHELL_CACHE_VERSION = [^;]+;/, `const SHELL_CACHE_VERSION = 'release-cycle-${version}';`);
    writeFileSync(join(dir, 'sw.js'), sw);
    writeFileSync(join(dir, 'release-manifest.json'), JSON.stringify({ buildId: version }));
  }
  const active = join(runtime, 'rich4');
  symlinkSync(join(temp, 'A'), active);
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const snippet = readFileSync(resolve('../deploy/nginx-rich4.conf'), 'utf8').replaceAll('/srv/www/apps', runtime);
  const config = join(temp, 'nginx.conf');
  writeFileSync(config, `pid ${temp}/nginx.pid; error_log stderr warn; events {} http { include ${process.env.NGINX_MIME_TYPES || '/etc/nginx/mime.types'}; access_log off; server { listen 127.0.0.1:${port}; ${snippet} } }`);
  const child = spawn(process.env.NGINX_BIN || 'nginx', ['-p', `${temp}/`, '-c', config, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  child.on('error', error => { errors += error.message; });
  const exited = once(child, 'close').catch(() => {});
  const baseURL = `http://127.0.0.1:${port}/rich4/`;
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const diagnostics = setupDiagnostics(page);
  const evidence: unknown[] = [];
  try {
    await expect.poll(async () => fetch(baseURL).then(r => r.status).catch(() => 0), { message: errors }).toBe(200);
    await startMatch(page);
    const saved = await snapshot(page);
    await saveViaUi(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      await (await caches.open('unrelated-app-cache')).put('/unrelated', new Response('keep'));
    });
    for (const version of ['B-version-two', 'A']) {
      const nextLink = join(runtime, 'next');
      symlinkSync(join(temp, version), nextLink);
      renameSync(nextLink, active);
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration!.update();
        const worker = registration!.installing || registration!.waiting;
        if (worker && worker.state !== 'activated') {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Worker stuck at ${worker.state}`)), 15000);
            worker.addEventListener('statechange', () => {
              if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
              if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('Worker installation failed')); }
            });
          });
        }
      });
      // A cache is created at install start; wait for activation/old-cache cleanup
      // before navigating so this exercises the installed worker, not a race.
      await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining([`rich4-app-shell-release-cycle-${version}`]));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('meta[name="candidate"]')).toHaveAttribute('content', version);
      await loadViaUi(page);
      expect(await snapshot(page)).toEqual(saved);
      expect(await page.evaluate(() => caches.has('unrelated-app-cache'))).toBe(true);
      const release = await (await page.request.get('./release-manifest.json')).json();
      expect(release.buildId).toBe(version);
      evidence.push({ version, saveRestoredExactly: true, caches: await page.evaluate(() => caches.keys()) });
    }
    await rollAndObserve(page);
    await retainEvidence(testInfo, 'release-cycle.json', JSON.stringify({ mode: 'local real Nginx; generated A/B app shells with distinct entry hashes', evidence }, null, 2), 'application/json');
  } catch (error) {
    const workers = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { installing: r?.installing?.state, waiting: r?.waiting?.state, active: r?.active?.state, caches: await caches.keys() };
    }).catch(() => null);
    await retainEvidence(testInfo, 'release-failure.json', JSON.stringify({ error: String(error), evidence, workers, diagnostics, nginx: errors }, null, 2), 'application/json');
    const screenshot = await page.screenshot({ timeout: 3000 }).catch(() => null);
    if (screenshot) await retainEvidence(testInfo, 'release-failure.png', screenshot, 'image/png');
    throw error;
  } finally {
    await context.close();
    child.kill('SIGTERM');
    await exited;
    rmSync(temp, { recursive: true, force: true });
  }
});
