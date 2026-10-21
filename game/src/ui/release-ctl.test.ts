/**
 * Issue #1 (M7-01, T-11): `deploy/rich4-ctl.sh rollback` must drive the real rollback implementation
 * (`scripts/release-web.mjs rollback`) inside an isolated runtime directory, never the live VPS test site.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error mjs script import for release deployment fixtures
import { deployRelease } from '../../scripts/release-web.mjs';
// @ts-expect-error mjs script import for release manifest fixtures
import { generateReleaseManifest } from '../../scripts/verify-web.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ctl = join(repoRoot, 'deploy/rich4-ctl.sh');
const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0;

function makeFakeDist(dir: string, bundleName: string) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets', bundleName), `console.log("${bundleName}");`);
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><head><script type="module" src="/rich4/assets/${bundleName}"></script></head><body><div id="app"></div></body></html>`,
  );
  generateReleaseManifest(dir, '/rich4/');
}

function runCtl(runtimeDir: string, ...args: string[]) {
  const r = spawnSync('bash', [ctl, ...args], {
    env: { ...process.env, RICH4_RUNTIME_DIR: runtimeDir, RICH4_REPO_DIR: repoRoot },
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const active = (runtimeDir: string) => realpathSync(join(runtimeDir, 'rich4'));
const historyCurrent = (runtimeDir: string) =>
  JSON.parse(readFileSync(join(runtimeDir, 'rich4-releases/history.json'), 'utf8')).current;

describe.skipIf(!hasBash)('rich4-ctl.sh rollback entry (Issue #1)', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function setup() {
    const work = mkdtempSync(join(tmpdir(), 'rich4-ctl-rollback-'));
    tempDirs.push(work);
    const runtime = join(work, 'runtime');
    for (const [id, bundle] of [['rel-a', 'index-a.js'], ['rel-b', 'index-b.js']] as const) {
      const dist = join(work, `dist-${id}`);
      makeFakeDist(dist, bundle);
      deployRelease({ appsRoot: runtime, distDir: dist, releaseId: id, publicAssetsDir: join(work, 'none'), codeOnly: true });
    }
    return runtime;
  }

  it('rolls back to the previous release without an id, then forward to an explicit id (A→B→A→B)', () => {
    const runtime = setup();
    const releases = realpathSync(join(runtime, 'rich4-releases'));
    expect(active(runtime)).toBe(join(releases, 'rel-b'));

    const back = runCtl(runtime, 'rollback');
    expect(back.code, back.out).toBe(0);
    expect(back.out).toContain("Rolled back from 'rel-b' to 'rel-a'");
    expect(active(runtime)).toBe(join(releases, 'rel-a'));
    expect(historyCurrent(runtime)).toBe('rel-a');
    expect(readFileSync(join(runtime, 'rich4/index.html'), 'utf8')).toContain('index-a.js');

    const fwd = runCtl(runtime, 'rollback', 'rel-b');
    expect(fwd.code, fwd.out).toBe(0);
    expect(active(runtime)).toBe(join(releases, 'rel-b'));
    expect(historyCurrent(runtime)).toBe('rel-b');
    expect(JSON.parse(readFileSync(join(runtime, 'rich4/release-manifest.json'), 'utf8')).entryReferences).toContain(
      'assets/index-b.js',
    );
  });

  it('rejects path-traversal and unknown ids with a non-zero exit code and leaves the active release untouched', () => {
    const runtime = setup();
    const before = active(runtime);

    const traversal = runCtl(runtime, 'rollback', '../../etc');
    expect(traversal.code).toBe(2);
    expect(traversal.out).toContain('Invalid release id');
    expect(active(runtime)).toBe(before);

    const unknown = runCtl(runtime, 'rollback', 'rel-missing');
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('missing or incomplete');
    expect(active(runtime)).toBe(before);
    expect(historyCurrent(runtime)).toBe('rel-b');
  });

  it('fails cleanly when the runtime directory has no releases yet', () => {
    const work = mkdtempSync(join(tmpdir(), 'rich4-ctl-empty-'));
    tempDirs.push(work);
    const r = runCtl(join(work, 'runtime'), 'rollback');
    expect(r.code).toBe(1);
    expect(r.out).toContain('No releases directory');
    expect(existsSync(join(work, 'runtime/rich4'))).toBe(false);
  });
});
