// Automated Web build verification, release-manifest generation, and HTTP /rich4/ smoke test (M3-01, M3-03).
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.m4a': 'audio/mp4',
};

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function collectDistFiles(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip full unpacked game art directories when computing core bundle checksums
      if (base === 'assets' && ['maps', 'orig', 'hd', 'audio', 'ground'].includes(entry.name)) continue;
      out.push(...collectDistFiles(full, rel));
    } else if (entry.isFile() && entry.name !== 'release-manifest.json') {
      const size = statSync(full).size;
      out.push({ path: rel, size, sha256: sha256File(full) });
    }
  }
  return out;
}

export function generateReleaseManifest(distDir, basePrefix = '/rich4/') {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let gitSha = 'unknown';
  try {
    gitSha = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { /* fallback */ }

  const indexHtmlPath = join(distDir, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    throw new Error(`Missing ${indexHtmlPath}. Run 'npm run build:web' first.`);
  }
  const html = readFileSync(indexHtmlPath, 'utf8');
  const referenced = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (!ref.startsWith(basePrefix)) {
      throw new Error(`Expected asset reference in index.html to start with '${basePrefix}', got '${ref}'`);
    }
    const rel = ref.slice(basePrefix.length);
    const full = join(distDir, rel);
    if (!existsSync(full) || statSync(full).size === 0) {
      throw new Error(`Referenced bundle file missing or empty: ${full}`);
    }
    referenced.push(rel);
  }

  const files = collectDistFiles(distDir);
  const manifest = {
    schemaVersion: 1,
    version: pkg.version,
    gitSha,
    buildId: `${pkg.version}-${gitSha}`,
    baseUrl: basePrefix,
    generatedAt: new Date().toISOString(),
    entryReferences: referenced,
    files,
  };
  writeFileSync(join(distDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function simulateStaticRequest(rawUrl, distDir, publicAssetsDir, basePrefix = '/rich4/') {
  const cleanPrefix = basePrefix.replace(/\/$/, '');
  const url = (rawUrl || '/').split('?')[0];
  if (url === cleanPrefix) {
    return { status: 301, headers: { location: `${cleanPrefix}/` }, body: Buffer.alloc(0) };
  }
  if (!url.startsWith(`${cleanPrefix}/`)) {
    return { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: Buffer.from('Not Found') };
  }
  const rel = url.slice(`${cleanPrefix}/`.length) || 'index.html';
  let filePath = join(distDir, rel);
  if (!existsSync(filePath) && rel.startsWith('assets/') && publicAssetsDir) {
    filePath = join(publicAssetsDir, rel.slice('assets/'.length));
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' },
      body: Buffer.from('404 Not Found'),
    };
  }
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const isImmutable = /^assets\/(index-|zh-hans-|huninn-)/.test(rel);
  const cacheControl = rel === 'index.html' || rel === 'release-manifest.json'
    ? 'no-cache, must-revalidate'
    : isImmutable
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=86400, must-revalidate';
  return {
    status: 200,
    headers: {
      'content-type': mime,
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    },
    body: readFileSync(filePath),
  };
}

export async function runHttpSmokeTest(distDir, publicAssetsDir, basePrefix = '/rich4/') {
  const cleanPrefix = basePrefix.replace(/\/$/, '');
  const checks = [];

  // Run deterministic routing, MIME, Cache-Control and 404 checks
  const rRedirect = simulateStaticRequest(cleanPrefix, distDir, publicAssetsDir, basePrefix);
  if (rRedirect.status !== 301 || rRedirect.headers.location !== `${cleanPrefix}/`) {
    throw new Error(`Expected 301 redirect from ${cleanPrefix} to ${cleanPrefix}/, got ${rRedirect.status}`);
  }
  checks.push('GET /rich4 -> 301 /rich4/');

  const rHtml = simulateStaticRequest(`${cleanPrefix}/`, distDir, publicAssetsDir, basePrefix);
  const htmlText = rHtml.body.toString('utf8');
  if (rHtml.status !== 200 || !htmlText.includes('<div id="app"></div>')) {
    throw new Error(`Invalid /rich4/ HTML response (status ${rHtml.status})`);
  }
  if (!rHtml.headers['cache-control']?.includes('no-cache')) {
    throw new Error(`Expected no-cache on /rich4/ index.html`);
  }
  checks.push('GET /rich4/ -> 200 HTML (no-cache, #app present)');

  const manifest = JSON.parse(readFileSync(join(distDir, 'release-manifest.json'), 'utf8'));
  for (const ref of manifest.entryReferences) {
    const rBundle = simulateStaticRequest(`${cleanPrefix}/${ref}`, distDir, publicAssetsDir, basePrefix);
    if (rBundle.status !== 200) throw new Error(`Bundle ${ref} returned ${rBundle.status}`);
    if (!rBundle.headers['cache-control']?.includes('immutable')) {
      throw new Error(`Expected immutable Cache-Control on ${ref}`);
    }
    checks.push(`GET ${cleanPrefix}/${ref} -> 200 (${rBundle.headers['content-type']}, immutable)`);
  }

  const r404 = simulateStaticRequest(`${cleanPrefix}/assets/does-not-exist-9999.png`, distDir, publicAssetsDir, basePrefix);
  if (r404.status !== 404) {
    throw new Error(`Expected 404 for missing asset, got ${r404.status}`);
  }
  checks.push('GET /rich4/assets/does-not-exist-9999.png -> 404 (strict try_files =404)');

  if (publicAssetsDir && existsSync(join(publicAssetsDir, 'maps/maps.json'))) {
    const rMaps = simulateStaticRequest(`${cleanPrefix}/assets/maps/maps.json`, distDir, publicAssetsDir, basePrefix);
    const mapsData = JSON.parse(rMaps.body.toString('utf8'));
    if (rMaps.status !== 200 || !Array.isArray(mapsData.maps) || mapsData.maps.length === 0) {
      throw new Error('Failed to load /rich4/assets/maps/maps.json');
    }
    checks.push(`GET /rich4/assets/maps/maps.json -> 200 (${mapsData.maps.length} maps verified)`);
  }

  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const distDir = resolve(process.argv[2] ?? join(root, 'dist'));
  const publicAssetsDir = join(root, 'public/assets');
  const manifest = generateReleaseManifest(distDir, '/rich4/');
  console.log(`[verify-web] Generated release-manifest.json for build ${manifest.buildId} (${manifest.files.length} files).`);
  const checks = await runHttpSmokeTest(distDir, publicAssetsDir, '/rich4/');
  for (const c of checks) console.log(`  ✓ ${c}`);
  console.log(`[verify-web] All ${checks.length} smoke checks passed.`);
}
