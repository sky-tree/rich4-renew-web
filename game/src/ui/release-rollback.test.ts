import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error mjs script import for asset content integrity verification
import { verifyAssetIntegrity } from '../../scripts/audit-assets.mjs';
// @ts-expect-error mjs script import for release/rollback verification
import { deployRelease, rollbackRelease, validateReleaseId } from '../../scripts/release-web.mjs';
// @ts-expect-error mjs script import for release manifest verification
import { generateReleaseManifest, runHttpSmokeTest } from '../../scripts/verify-web.mjs';

function makeFakeDist(dir: string, bundleName: string) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets', bundleName), `console.log("${bundleName}");`);
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><head><script type="module" src="/rich4/assets/${bundleName}"></script></head><body><div id="app"></div></body></html>`,
  );
  generateReleaseManifest(dir, '/rich4/');
}

describe('Immutable Web release deployment, rollback and strict verification (M3 & P1-1/P1-2/P1-6/P1-05 fixes)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('deploys multiple immutable versions with pre/post smoke checks and atomically rolls back', () => {
    const work = mkdtempSync(join(tmpdir(), 'rich4-m3-test-'));
    tempDirs.push(work);

    const appsRoot = join(work, 'apps');
    const distV1 = join(work, 'dist-v1');
    const distV2 = join(work, 'dist-v2');
    makeFakeDist(distV1, 'index-v1.js');
    makeFakeDist(distV2, 'index-v2.js');

    const r1 = deployRelease({
      appsRoot,
      distDir: distV1,
      releaseId: 'rel-v1',
      publicAssetsDir: join(work, 'no-assets'),
      codeOnly: true,
    });
    expect(r1.id).toBe('rel-v1');
    expect(r1.postChecks.length).toBeGreaterThanOrEqual(4);
    expect(readFileSync(join(appsRoot, 'rich4/index.html'), 'utf8')).toContain('index-v1.js');

    const r2 = deployRelease({
      appsRoot,
      distDir: distV2,
      releaseId: 'rel-v2',
      publicAssetsDir: join(work, 'no-assets'),
      codeOnly: true,
    });
    expect(r2.id).toBe('rel-v2');
    expect(r2.previous).toBe('rel-v1');
    expect(readFileSync(join(appsRoot, 'rich4/index.html'), 'utf8')).toContain('index-v2.js');

    const rb = rollbackRelease({ appsRoot });
    expect(rb.rolledFrom).toBe('rel-v2');
    expect(rb.current).toBe('rel-v1');
    expect(readFileSync(join(appsRoot, 'rich4/index.html'), 'utf8')).toContain('index-v1.js');
  });

  it('enforces mandatory strict asset verification in deployRelease by default and blocks unverified deploy (P1-05)', () => {
    const work = mkdtempSync(join(tmpdir(), 'rich4-m3-strict-deploy-'));
    tempDirs.push(work);
    const appsRoot = join(work, 'apps');
    const distV1 = join(work, 'dist-v1');
    makeFakeDist(distV1, 'index-v1.js');

    // Default `deployRelease` (without `codeOnly: true`) MUST run strict asset verification and refuse to deploy when assets are missing
    expect(() =>
      deployRelease({
        appsRoot,
        distDir: distV1,
        releaseId: 'rel-unverified',
        publicAssetsDir: join(work, 'missing-assets'),
      }),
    ).toThrow(/required game assets are missing/);
    expect(existsSync(join(appsRoot, 'rich4-releases/rel-unverified'))).toBe(false);
    expect(existsSync(join(appsRoot, 'rich4'))).toBe(false);
  });

  it('rejects path-traversal releaseIds and refuses to overwrite an existing release (P1-2)', () => {
    const work = mkdtempSync(join(tmpdir(), 'rich4-m3-immutable-'));
    tempDirs.push(work);
    const appsRoot = join(work, 'apps');
    const distV1 = join(work, 'dist-v1');
    const distV2 = join(work, 'dist-v2');
    makeFakeDist(distV1, 'index-v1.js');
    makeFakeDist(distV2, 'index-v2.js');

    expect(() => validateReleaseId('../escape', appsRoot)).toThrow(/Invalid releaseId/);
    expect(() => validateReleaseId('sub/dir', appsRoot)).toThrow(/Invalid releaseId/);
    expect(() => validateReleaseId('history.json', appsRoot)).toThrow(/Invalid releaseId/);

    deployRelease({
      appsRoot,
      distDir: distV1,
      releaseId: 'rel-v1',
      publicAssetsDir: join(work, 'no-assets'),
      codeOnly: true,
    });
    // Attempting to deploy over existing `rel-v1` must throw and keep original bundle intact
    expect(() =>
      deployRelease({
        appsRoot,
        distDir: distV2,
        releaseId: 'rel-v1',
        publicAssetsDir: join(work, 'no-assets'),
        codeOnly: true,
      }),
    ).toThrow(/Refusing to overwrite existing immutable release/);
    expect(readFileSync(join(appsRoot, 'rich4-releases/rel-v1/index.html'), 'utf8')).toContain('index-v1.js');
  });

  it('fails strict release verification when game assets are missing (P1-1)', async () => {
    const work = mkdtempSync(join(tmpdir(), 'rich4-m3-noassets-'));
    tempDirs.push(work);
    const distDir = join(work, 'dist');
    makeFakeDist(distDir, 'index-v1.js');

    // Strict mode (requireAssets: true) must reject when assets are missing
    await expect(
      runHttpSmokeTest(distDir, join(work, 'missing-assets'), '/rich4/', { requireAssets: true }),
    ).rejects.toThrow(/required game assets are missing/);

    // Explicit code-only mode succeeds for bundle/MIME/routing checks
    const checks = await runHttpSmokeTest(distDir, join(work, 'missing-assets'), '/rich4/', { requireAssets: false });
    expect(checks.length).toBeGreaterThanOrEqual(4);
  });

  it('detects same-size byte corruption via real SHA-256 content hashes (P1-6 & P1-05)', () => {
    const work = mkdtempSync(join(tmpdir(), 'rich4-m3-sha256-'));
    tempDirs.push(work);
    mkdirSync(join(work, 'maps'), { recursive: true });
    const fileRel = 'maps/maps.json';
    const originalBuf = Buffer.from('{"maps":[{"id":0,"name":"Good"}]}', 'utf8');
    writeFileSync(join(work, fileRel), originalBuf);
    const expectedSha = createHash('sha256').update(originalBuf).digest('hex');

    const packManifest = {
      criticalFiles: {
        [fileRel]: { size: originalBuf.length, sha256: expectedSha, packId: 'shell' },
      },
    };

    expect(verifyAssetIntegrity(work, packManifest)).toEqual({
      ok: true,
      verifiedCount: 1,
      corrupted: [],
    });

    // Corrupt a single character while keeping the exact same byte length
    const corruptedBuf = Buffer.from('{"maps":[{"id":0,"name":"Evil"}]}', 'utf8');
    expect(corruptedBuf.length).toBe(originalBuf.length);
    writeFileSync(join(work, fileRel), corruptedBuf);

    const bad = verifyAssetIntegrity(work, packManifest);
    expect(bad.ok).toBe(false);
    expect(bad.corrupted[0]).toContain('sha256 mismatch');
  });
});
