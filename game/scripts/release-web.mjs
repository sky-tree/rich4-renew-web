// Atomic release deployment and instant rollback manager for `/srv/www/apps/rich4` (M3-02, M3-04).
// Supports both production VPS directories and local staging/test directories.
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReleaseManifest } from './verify-web.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readHistory(releasesDir) {
  const histFile = join(releasesDir, 'history.json');
  if (!existsSync(histFile)) return { current: null, releases: [] };
  try {
    return JSON.parse(readFileSync(histFile, 'utf8'));
  } catch {
    return { current: null, releases: [] };
  }
}

function writeHistory(releasesDir, history) {
  writeFileSync(join(releasesDir, 'history.json'), JSON.stringify(history, null, 2) + '\n');
}

function atomicSwitchSymlink(targetRelOrAbs, linkPath) {
  const tmpLink = `${linkPath}.tmp-${process.pid}-${Date.now()}`;
  rmSync(tmpLink, { force: true, recursive: false });
  symlinkSync(targetRelOrAbs, tmpLink, 'junction');
  renameSync(tmpLink, linkPath);
}

/**
 * Deploys a built `distDir` into `<appsRoot>/rich4-releases/<releaseId>` and atomically switches
 * `<appsRoot>/rich4` to point to the new release.
 */
export function deployRelease({ appsRoot, distDir, releaseId }) {
  const baseRoot = resolve(appsRoot);
  const srcDist = resolve(distDir);
  const releasesDir = join(baseRoot, 'rich4-releases');
  mkdirSync(releasesDir, { recursive: true });

  const manifestPath = join(srcDist, 'release-manifest.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : generateReleaseManifest(srcDist, '/rich4/');

  const id = releaseId || `${manifest.buildId}-${Date.now()}`;
  const targetDir = join(releasesDir, id);
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(srcDist, targetDir, { recursive: true });

  const activeLink = join(baseRoot, 'rich4');
  atomicSwitchSymlink(targetDir, activeLink);

  const history = readHistory(releasesDir);
  const previous = history.current;
  history.current = id;
  history.releases = [
    { id, buildId: manifest.buildId, deployedAt: new Date().toISOString(), previous },
    ...history.releases.filter(r => r.id !== id),
  ].slice(0, 20);
  writeHistory(releasesDir, history);

  return { id, previous, activeLink, targetDir, manifest };
}

/**
 * Atomically rolls `<appsRoot>/rich4` back to `toReleaseId` (or the immediately preceding release in history).
 */
export function rollbackRelease({ appsRoot, toReleaseId }) {
  const baseRoot = resolve(appsRoot);
  const releasesDir = join(baseRoot, 'rich4-releases');
  const history = readHistory(releasesDir);

  let targetId = toReleaseId;
  if (!targetId) {
    const curEntry = history.releases.find(r => r.id === history.current);
    targetId = curEntry?.previous ?? history.releases.find(r => r.id !== history.current)?.id;
  }
  if (!targetId) {
    throw new Error('No previous release available to roll back to.');
  }
  const targetDir = join(releasesDir, targetId);
  const manifestPath = join(targetDir, 'release-manifest.json');
  if (!existsSync(targetDir) || !existsSync(manifestPath)) {
    throw new Error(`Rollback target release '${targetId}' is missing or incomplete at ${targetDir}`);
  }

  const activeLink = join(baseRoot, 'rich4');
  const rolledFrom = history.current;
  atomicSwitchSymlink(targetDir, activeLink);

  history.current = targetId;
  writeHistory(releasesDir, history);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return { rolledFrom, current: targetId, activeLink, targetDir, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const action = args[0] || 'deploy';
  let appsRoot = process.env.RICH4_APPS_ROOT || join(root, 'release/www-apps');
  let distDir = join(root, 'dist');
  let id = '';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) appsRoot = args[++i];
    else if (args[i] === '--dist' && args[i + 1]) distDir = args[++i];
    else if ((args[i] === '--id' || args[i] === '--to') && args[i + 1]) id = args[++i];
  }

  if (action === 'deploy') {
    const r = deployRelease({ appsRoot, distDir, releaseId: id || undefined });
    console.log(`[release-web] Deployed '${r.id}' (previous: ${r.previous ?? 'none'}) -> ${readlinkSync(r.activeLink)}`);
  } else if (action === 'rollback') {
    const r = rollbackRelease({ appsRoot, toReleaseId: id || undefined });
    console.log(`[release-web] Rolled back from '${r.rolledFrom}' to '${r.current}' -> ${readlinkSync(r.activeLink)}`);
  } else {
    console.error(`Unknown action '${action}'. Use 'deploy' or 'rollback'.`);
    process.exit(1);
  }
}
