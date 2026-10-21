// Audits all game asset manifests, verifies every referenced file exists on disk,
// classifies assets into Web packs (`shell`, `core`, `map-<id>`, `ground-<id>-<style>`, `optional`),
// and writes `web-packs.json` (M2-01, M2-02, M2-04, M2-05).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UNUSED_DATA = new Set([523]);

export function auditAssets(assetsDir, opts = {}) {
  const src = resolve(assetsDir);
  if (!existsSync(join(src, 'maps/maps.json')) || !existsSync(join(src, 'orig/manifest.json'))) {
    return { skipped: true, reason: `Assets directory not populated at ${src}` };
  }

  const missing = [];
  const seen = new Map(); // relPath -> { packId, category, size, sha256 }
  const packs = new Map(); // packId -> { id, category, fileCount, bytes, hash: Hash, files: string[] }
  const criticalFiles = {}; // relPath -> { size, sha256, packId }

  function ensurePack(id, category) {
    let p = packs.get(id);
    if (!p) {
      p = { id, category, fileCount: 0, bytes: 0, hash: createHash('sha256'), files: [] };
      packs.set(id, p);
    }
    return p;
  }

  function record(rel, packId, category) {
    if (seen.has(rel)) return;
    const full = join(src, rel);
    if (!existsSync(full)) {
      missing.push({ rel, packId });
      return;
    }
    const buf = readFileSync(full);
    const size = buf.length;
    const fileSha256 = createHash('sha256').update(buf).digest('hex');
    seen.set(rel, { packId, category, size, sha256: fileSha256 });
    const p = ensurePack(packId, category);
    p.fileCount++;
    p.bytes += size;
    p.files.push(rel);
    p.hash.update(`${rel}:${size}:${fileSha256}\n`);
    if (packId === 'shell' || rel.endsWith('.json')) {
      criticalFiles[rel] = { size, sha256: fileSha256, packId };
    }
  }

  const readJson = rel => JSON.parse(readFileSync(join(src, rel), 'utf8'));

  // 1. Shell & Maps
  record('maps/maps.json', 'shell', 'shell');
  const mapsJson = readJson('maps/maps.json');
  for (const m of mapsJson.maps ?? []) {
    record(`maps/${m.thumbnail}`, 'shell', 'shell');
    const mapPack = `map-${m.id}`;
    record(`maps/map-${m.id}.json`, mapPack, 'map');
    record(`maps/map-${m.id}.png`, mapPack, 'map');
  }

  if (existsSync(join(src, 'maps/remake/index.json'))) {
    record('maps/remake/index.json', 'shell', 'shell');
    const remakeIdx = readJson('maps/remake/index.json');
    for (const m of remakeIdx.maps ?? []) {
      const mapPack = `map-${m.id}`;
      if (!m.hidden) record(`maps/${m.thumbnail}`, 'shell', 'shell');
      else record(`maps/${m.thumbnail}`, mapPack, 'map');
      record(`maps/${m.data}`, mapPack, 'map');
      record(`maps/${m.image}`, mapPack, 'map');
      if (existsSync(join(src, `maps/${m.data}`))) {
        const rawMap = readJson(`maps/${m.data}`);
        for (const s of Object.values(rawMap.sprites ?? {})) {
          for (const f of s.frames ?? []) record(`maps/${s.dir}/${f.file}`, mapPack, 'map');
        }
      }
    }

    // Remake title buttons -> shell
    for (const f of ['title/party.webp', 'title/party-hover.webp']) {
      if (existsSync(join(src, `maps/remake/${f}`))) record(`maps/remake/${f}`, 'shell', 'shell');
    }

    // City specific lot buildings -> map-100..104
    const cityMapByBase = { 2700: 100, 2800: 101, 2900: 102, 3000: 103, 3100: 104 };
    for (const [baseStr, mapId] of Object.entries(cityMapByBase)) {
      const base = Number(baseStr);
      const mapPack = `map-${mapId}`;
      for (let n = 1; n <= 24; n++) {
        const fj = `maps/remake/sprites/${base + n}/frames.json`;
        if (!existsSync(join(src, fj))) continue;
        record(fj, mapPack, 'map');
        for (const f of readJson(fj)) record(`maps/remake/sprites/${base + n}/${f.file}`, mapPack, 'map');
      }
    }

    // Kabukicho (map-8) specific assets
    for (let res = 1901; res <= 1911; res++) {
      const fj = `maps/remake/sprites/${res}/frames.json`;
      if (!existsSync(join(src, fj))) continue;
      record(fj, 'map-8', 'map');
      for (const f of readJson(fj)) record(`maps/remake/sprites/${res}/${f.file}`, 'map-8', 'map');
    }
    for (const dir of ['maps/remake/kabukicho', 'maps/remake/kabukicho/machines']) {
      if (existsSync(join(src, dir))) {
        for (const f of readdirSync(join(src, dir))) if (f.endsWith('.webp')) record(`${dir}/${f}`, 'map-8', 'map');
      }
    }

    // Finale (map-999) specific assets
    for (let t = 0; t < 5; t++) for (let k = 1; k <= 5; k++) {
      const res = 1600 + t * 10 + k;
      const fj = `maps/remake/sprites/${res}/frames.json`;
      if (!existsSync(join(src, fj))) continue;
      record(fj, 'map-999', 'map');
      for (const f of readJson(fj)) record(`maps/remake/sprites/${res}/${f.file}`, 'map-999', 'map');
    }
    for (const dir of ['maps/remake/casino', 'maps/remake/casino/props']) {
      if (existsSync(join(src, dir))) {
        for (const f of readdirSync(join(src, dir))) if (f.endsWith('.webp')) record(`${dir}/${f}`, 'map-999', 'map');
      }
    }

    // Shared remake core sprites (hotels, AH11, travel pads, cards, tools, stats, party, events)
    for (const res of ['9017', '9018', '1501', '1502', '1503', '2604', '2605', '2611', '2612', '2613', '2614', '2615']) {
      const fj = `maps/remake/sprites/${res}/frames.json`;
      if (!existsSync(join(src, fj))) continue;
      record(fj, 'core', 'core');
      for (const f of readJson(fj)) record(`maps/remake/sprites/${res}/${f.file}`, 'core', 'core');
    }
    for (const dir of ['maps/remake/party', 'maps/remake/stats', 'maps/remake/events']) {
      if (existsSync(join(src, dir))) {
        for (const f of readdirSync(join(src, dir))) if (f.endsWith('.webp')) record(`${dir}/${f}`, 'core', 'core');
      }
    }
    const extraRemake = [
      ...[601, 602, 603, 604, 605, 606, 607, 608, 609].map(n => `cards/0${n}.webp`),
      ...[614, 615, 616, 617, 618].map(n => `tools/0${n}.webp`),
      ...[1, 2, 3, 4].map(n => `icbm/shot-${n}.webp`),
      'onway/layers.json', 'onway/plane.webp', 'onway/train.webp', 'onway/sky.webp', 'onway/land.webp',
    ];
    for (const f of extraRemake) {
      if (existsSync(join(src, `maps/remake/${f}`))) record(`maps/remake/${f}`, 'core', 'core');
    }
  }

  // 2. Original & HD Sprite Archives
  record('orig/manifest.json', 'shell', 'shell');
  if (existsSync(join(src, 'orig/outline-colors.json'))) record('orig/outline-colors.json', 'shell', 'shell');
  const orig = readJson('orig/manifest.json').archives ?? {};
  for (const archive of ['Data.mkf', 'map.mkf', 'Panel.mkf']) {
    const dir = archive.replace('.mkf', '');
    for (const e of orig[archive] ?? []) {
      if (archive === 'Data.mkf' && UNUSED_DATA.has(e.id)) continue;
      const isTitle = dir === 'Data' && (e.id === 1 || e.id === 9001);
      const isFlc = e.type === 'FLC';
      const packId = isTitle ? 'shell' : isFlc ? 'optional' : 'core';
      const cat = isTitle ? 'shell' : isFlc ? 'optional' : 'core';
      for (const f of e.frames ?? []) if (f.file) record(`orig/${dir}/${f.file}`, packId, cat);
      if (e.file) record(`orig/${dir}/${e.file}`, packId, cat);
      if (e.frames_dir) {
        for (let i = 0; i < e.frame_count; i++) {
          record(`orig/${dir}/${e.frames_dir}/frame-${String(i).padStart(3, '0')}.png`, packId, cat);
        }
      }
    }
  }

  let webpDetected = false;
  if (existsSync(join(src, 'hd/manifest-hd.json'))) {
    record('hd/manifest-hd.json', 'shell', 'shell');
    const hdManifest = readJson('hd/manifest-hd.json');
    for (const [key, e] of Object.entries(hdManifest.resources ?? {})) {
      const [arch, idStr] = key.split('/');
      const id = Number(idStr);
      if (arch === 'Data' && UNUSED_DATA.has(id)) continue;
      const isTitle = arch === 'Data' && (id === 1 || id === 9001);
      const packId = isTitle ? 'shell' : 'core';
      const cat = isTitle ? 'shell' : 'core';
      for (const f of e.frames ?? []) {
        if (f.file.endsWith('.webp')) webpDetected = true;
        record(`hd/${key}-${e.type}/${f.file}`, packId, cat);
      }
      if (e.file) {
        if (e.file.endsWith('.webp')) webpDetected = true;
        record(`hd/${arch}/${e.file}`, packId, cat);
      }
    }
  }

  // 3. Audio
  if (existsSync(join(src, 'audio/manifest.json'))) {
    record('audio/manifest.json', 'shell', 'shell');
    const a = readJson('audio/manifest.json');
    for (const id of Object.keys(a.effect ?? {})) {
      const num = Number(id);
      const isUi = num >= 0 && num <= 4;
      record(`audio/effect/${id.padStart(4, '0')}.m4a`, isUi ? 'shell' : 'core', isUi ? 'shell' : 'core');
    }
    for (const id of Object.keys(a.voice ?? {})) {
      record(`audio/voice/${id.padStart(4, '0')}.m4a`, 'optional', 'optional');
    }
    for (const name of Object.keys(a.music ?? {})) {
      const isTitle = name === 'midi01';
      record(`audio/music/${name}.m4a`, isTitle ? 'shell' : 'optional', isTitle ? 'shell' : 'optional');
    }
  }

  // 4. Redrawn Ground Tiles
  if (existsSync(join(src, 'ground/index.json'))) {
    record('ground/index.json', 'shell', 'shell');
    const g = readJson('ground/index.json');
    for (const [mapId, styles] of Object.entries(g.maps ?? {})) {
      for (const style of styles) {
        const dir = `ground/${mapId}/${style}`;
        if (!existsSync(join(src, dir, 'manifest.json'))) continue;
        const packId = `ground-${mapId}-${style}`;
        record(`${dir}/manifest.json`, packId, 'ground');
        const m = readJson(`${dir}/manifest.json`);
        record(`${dir}/${m.preview}`, packId, 'ground');
        for (const row of m.tiles ?? []) {
          for (const f of row) record(`${dir}/${f}`, packId, 'ground');
        }
      }
    }
  }

  const categories = {
    shell: { fileCount: 0, bytes: 0 },
    core: { fileCount: 0, bytes: 0 },
    map: { fileCount: 0, bytes: 0 },
    ground: { fileCount: 0, bytes: 0 },
    optional: { fileCount: 0, bytes: 0 },
  };
  const packsObj = {};
  let totalFiles = 0;
  let totalBytes = 0;

  for (const [id, p] of [...packs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sha256 = p.hash.digest('hex');
    packsObj[id] = {
      id: p.id,
      category: p.category,
      fileCount: p.fileCount,
      bytes: p.bytes,
      sha256,
    };
    categories[p.category].fileCount += p.fileCount;
    categories[p.category].bytes += p.bytes;
    totalFiles += p.fileCount;
    totalBytes += p.bytes;
  }

  const manifest = {
    schemaVersion: 2,
    hashAlgorithm: 'sha256-content-bytes',
    buildId: process.env.RICH4_BUILD_ID || 'local-dev',
    generatedAt: new Date().toISOString(),
    webp: webpDetected,
    totalFiles,
    totalBytes,
    categories,
    packs: packsObj,
    criticalFiles,
  };

  if (opts.writeManifest) {
    writeFileSync(resolve(opts.writeManifest), JSON.stringify(manifest, null, 2) + '\n');
  }

  return { skipped: false, missing, manifest };
}

/**
 * Verifies on-disk asset byte contents against the SHA-256 hashes recorded in `web-packs.json` (P1-6 fix).
 * Detects silent file corruption even when file byte size remains unchanged.
 */
export function verifyAssetIntegrity(assetsDir, packManifest) {
  const src = resolve(assetsDir);
  const entries = Object.entries(packManifest?.criticalFiles ?? {});
  if (entries.length === 0) {
    return { ok: false, verifiedCount: 0, corrupted: ['No criticalFiles hashes present in web-packs.json'] };
  }
  const corrupted = [];
  let verifiedCount = 0;
  for (const [rel, expected] of entries) {
    const full = join(src, rel);
    if (!existsSync(full)) {
      corrupted.push(`${rel}: missing`);
      continue;
    }
    const buf = readFileSync(full);
    if (buf.length !== expected.size) {
      corrupted.push(`${rel}: size mismatch (expected ${expected.size}, got ${buf.length})`);
      continue;
    }
    const actualSha256 = createHash('sha256').update(buf).digest('hex');
    if (actualSha256 !== expected.sha256) {
      corrupted.push(`${rel}: sha256 mismatch (expected ${expected.sha256}, got ${actualSha256})`);
      continue;
    }
    verifiedCount++;
  }
  return { ok: corrupted.length === 0, verifiedCount, corrupted };
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let targetDir = join(root, 'public/assets');
  let writePath = join(targetDir, 'web-packs.json');
  let strict = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-write') writePath = '';
    else if (args[i] === '--write-manifest' && args[i + 1]) writePath = args[++i];
    else if (args[i] === '--allow-missing') strict = false;
    else if (!args[i].startsWith('--')) targetDir = resolve(args[i]);
  }

  const res = auditAssets(targetDir, { writeManifest: writePath || undefined });
  if (res.skipped) {
    console.log(`[audit-assets] Skipped: ${res.reason}`);
    process.exit(0);
  }
  const { manifest, missing } = res;
  const fmtMb = b => `${(b / (1024 * 1024)).toFixed(2)} MiB`;
  console.log(`[audit-assets] Audited ${manifest.totalFiles} referenced files (${fmtMb(manifest.totalBytes)}) in ${targetDir}`);
  for (const [cat, info] of Object.entries(manifest.categories)) {
    console.log(`  - ${cat.padEnd(9)}: ${String(info.fileCount).padStart(6)} files | ${fmtMb(info.bytes)}`);
  }
  if (missing.length > 0) {
    console.error(`[audit-assets] ERROR: ${missing.length} referenced files are missing!`);
    for (const m of missing.slice(0, 20)) console.error(`  missing [${m.packId}]: ${m.rel}`);
    if (strict) process.exit(1);
  } else {
    console.log(`[audit-assets] All manifest references verified (0 missing files).`);
  }
}
