import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error mjs script import for release/rollback verification
import { deployRelease, rollbackRelease } from '../../scripts/release-web.mjs';
// @ts-expect-error mjs script import for release manifest verification
import { generateReleaseManifest } from '../../scripts/verify-web.mjs';

function makeFakeDist(dir: string, bundleName: string) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets', bundleName), `console.log("${bundleName}");`);
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><head><script type="module" src="/rich4/assets/${bundleName}"></script></head><body><div id="app"></div></body></html>`,
  );
  generateReleaseManifest(dir, '/rich4/');
}

describe('Immutable Web release deployment and atomic rollback (M3)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('deploys multiple immutable versions and atomically rolls back to the previous release', () => {
    const work = mkdtempSync(join(tmpdir(), 'rich4-m3-test-'));
    tempDirs.push(work);

    const appsRoot = join(work, 'apps');
    const distV1 = join(work, 'dist-v1');
    const distV2 = join(work, 'dist-v2');
    makeFakeDist(distV1, 'index-v1.js');
    makeFakeDist(distV2, 'index-v2.js');

    const r1 = deployRelease({ appsRoot, distDir: distV1, releaseId: 'rel-v1' });
    expect(r1.id).toBe('rel-v1');
    expect(readFileSync(join(appsRoot, 'rich4/index.html'), 'utf8')).toContain('index-v1.js');

    const r2 = deployRelease({ appsRoot, distDir: distV2, releaseId: 'rel-v2' });
    expect(r2.id).toBe('rel-v2');
    expect(r2.previous).toBe('rel-v1');
    expect(readFileSync(join(appsRoot, 'rich4/index.html'), 'utf8')).toContain('index-v2.js');

    const rb = rollbackRelease({ appsRoot });
    expect(rb.rolledFrom).toBe('rel-v2');
    expect(rb.current).toBe('rel-v1');
    expect(readFileSync(join(appsRoot, 'rich4/index.html'), 'utf8')).toContain('index-v1.js');
  });
});
