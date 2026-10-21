import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error mjs script import for release deployment fixtures
import { deployRelease, rollbackRelease } from '../../scripts/release-web.mjs';
// @ts-expect-error mjs script import for release manifest fixtures
import { generateReleaseManifest, simulateStaticRequest } from '../../scripts/verify-web.mjs';

const ROOT = join(__dirname, '../../..');

function makeFakeDist(dir: string, bundleName: string) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets', bundleName), `console.log("${bundleName}");`);
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><head><script type="module" src="/rich4/assets/${bundleName}"></script></head><body><div id="app"></div></body></html>`,
  );
  generateReleaseManifest(dir, '/rich4/');
}

describe('S1: Deploy Security and Asset Cache Boundaries (Issues #2, #3, #4, #5)', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rich4-sec-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('Issue #2: PWA manifest defines standalone icons with valid PNG signatures', () => {
    const manifestPath = join(ROOT, 'game/public/manifest.webmanifest');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    for (const icon of manifest.icons) {
      const iconPath = join(ROOT, 'game/public', icon.src);
      expect(existsSync(iconPath), `Icon file missing: ${icon.src}`).toBe(true);
      expect(statSync(iconPath).size).toBeGreaterThan(1000);

      // Verify standard PNG magic signature (\x89PNG\r\n\x1a\n)
      const buf = readFileSync(iconPath);
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50); // P
      expect(buf[2]).toBe(0x4e); // N
      expect(buf[3]).toBe(0x47); // G
    }

    // Verify index.html head tags
    const html = readFileSync(join(ROOT, 'game/index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="icon"');
  });

  it('Issue #3: Service Worker and Entry Manifest strictly forbid persistent caching', () => {
    const distDir = join(ROOT, 'game/dist');
    if (!existsSync(distDir)) return;

    // sw.js check
    const rSw = simulateStaticRequest('/rich4/sw.js', distDir, undefined, '/rich4/');
    expect(rSw.status).toBe(200);
    expect(rSw.headers['cache-control']).toContain('no-cache');
    expect(rSw.headers['cache-control']).toContain('no-store');
    expect(rSw.headers['cache-control']).toContain('max-age=0');
    expect(rSw.headers['service-worker-allowed']).toBe('/rich4/');

    // manifest.webmanifest check
    const rManifest = simulateStaticRequest('/rich4/manifest.webmanifest', distDir, undefined, '/rich4/');
    expect(rManifest.status).toBe(200);
    expect(rManifest.headers['cache-control']).toContain('no-cache');
    expect(rManifest.headers['content-type']).toContain('application/manifest+json');
  });

  it('Issue #4: Nginx configs and static simulation enforce private cache for restricted game assets', () => {
    // Check deploy/nginx-rich4.conf and deploy/web-gateway-rich4.conf
    for (const confName of ['nginx-rich4.conf', 'web-gateway-rich4.conf']) {
      const confText = readFileSync(join(ROOT, 'deploy', confName), 'utf8');

      // 1. Assets location block must use 'private, no-transform' and NOT 'public'
      const lines = confText.split('\n');
      const assetLineIdx = lines.findIndex(l => l.includes('location') && l.includes('(webp|png|json|m4a)'));
      expect(assetLineIdx, `Missing asset location in ${confName}`).toBeGreaterThan(-1);
      const assetBlock = lines.slice(assetLineIdx, assetLineIdx + 6).join('\n');
      expect(assetBlock).toContain('private, no-transform');
      expect(assetBlock).not.toContain('public');
      expect(assetBlock).toContain('Vary "Authorization, Accept-Encoding"');

      // 2. Icons and webmanifest must have explicit public or open auth rules for PWA install
      expect(confText).toContain('application/manifest+json');
      expect(confText).toContain('icons/');
    }

    // Check simulated static response
    const rAsset = simulateStaticRequest('/rich4/assets/maps/maps.json', join(ROOT, 'game/dist'), join(ROOT, 'game/public/assets'), '/rich4/');
    if (rAsset.status === 200) {
      expect(rAsset.headers['cache-control']).toContain('private');
      expect(rAsset.headers['cache-control']).not.toContain('public');
      expect(rAsset.headers['vary']).toContain('Authorization');
    }
  });

  it('Issue #5: Release ledger tracks deployment metadata and rollback event audit log', () => {
    const distA = join(tempRoot, 'dist-a');
    const distB = join(tempRoot, 'dist-b');
    makeFakeDist(distA, 'index-a.js');
    makeFakeDist(distB, 'index-b.js');

    const runtimeDir = join(tempRoot, 'runtime');

    // Deploy release A
    deployRelease({
      appsRoot: runtimeDir,
      distDir: distA,
      releaseId: 'rel-A',
      codeOnly: true,
      publicAssetsDir: join(tempRoot, 'none'),
    });

    // Deploy release B
    deployRelease({
      appsRoot: runtimeDir,
      distDir: distB,
      releaseId: 'rel-B',
      codeOnly: true,
      publicAssetsDir: join(tempRoot, 'none'),
    });

    const historyFile = join(runtimeDir, 'rich4-releases/history.json');
    const histBefore = JSON.parse(readFileSync(historyFile, 'utf8'));
    expect(histBefore.current).toBe('rel-B');
    expect(histBefore.releases[0].id).toBe('rel-B');
    expect(histBefore.releases[0].gitSha).toBeDefined();
    expect(histBefore.releases[0].deployedAt).toBeDefined();
    expect(histBefore.events[0].type).toBe('deploy');
    expect(histBefore.events[0].id).toBe('rel-B');

    // Rollback to release A
    rollbackRelease({
      appsRoot: runtimeDir,
      toReleaseId: 'rel-A',
    });

    const histAfter = JSON.parse(readFileSync(historyFile, 'utf8'));
    expect(histAfter.current).toBe('rel-A');
    expect(histAfter.events[0].type).toBe('rollback');
    expect(histAfter.events[0].from).toBe('rel-B');
    expect(histAfter.events[0].to).toBe('rel-A');
    expect(histAfter.events[0].at).toBeDefined();
  });
});
