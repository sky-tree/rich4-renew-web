/**
 * M6 — App Shell PWA, Opt-in Offline Map Packs, Optional Asset CDN Resolution,
 * and Privacy-Safe Structured Telemetry Ring Buffer (with P1-4, P1-5, P1-7, P2-1, P2-2 fixes).
 */

declare const __APP_VERSION__: string | undefined;

const DEFAULT_APP_VER = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.6.6';
let currentOfflineVersion = `v1-${DEFAULT_APP_VER}`;

/** Returns the active offline cache version bound to the current app build/asset version (P2-2 fix). */
export function getOfflineCacheVersion(): string {
  return currentOfflineVersion;
}

/** Overrides the active offline cache version (e.g. when binding to `web-packs.json` buildId/hash). */
export function setOfflineCacheVersion(version: string): void {
  const clean = version.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (clean) currentOfflineVersion = clean;
}

export function getOfflineMapCachePrefix(): string {
  return `rich4-offline-map-${currentOfflineVersion}-`;
}

export const APP_SHELL_CACHE_PREFIX = 'rich4-app-shell-';
export const DEFAULT_SAFETY_MARGIN_BYTES = 150 * 1024 * 1024; // Reserve at least 150 MiB free space

export interface StorageQuotaEstimate {
  usageBytes: number;
  quotaBytes: number;
  availableBytes: number;
  usageRatio: number;
  supported: boolean;
}

export interface OfflinePackProgress {
  mapKey: string;
  loadedFiles: number;
  totalFiles: number;
  ratio: number;
}

export interface DownloadOfflinePackOptions {
  /** Content SHA-256 hash of the pack from `web-packs.json` to bind cache invalidation (P2-2). */
  contentHash?: string;
  /** Estimated pack byte size for pre-download storage quota validation. */
  estimatedBytes?: number;
  /** Minimum free bytes required after download (default 150 MiB). */
  safetyMarginBytes?: number;
  /** Progress callback after each cached file. */
  onProgress?: (progress: OfflinePackProgress) => void;
  /** Optional abort signal to cancel and clean up partial cache. */
  signal?: AbortSignal;
  /** Concurrency limit when fetching map assets (default 4). */
  concurrency?: number;
  /** Optional custom fetch implementation for unit tests. */
  fetchImpl?: typeof fetch;
  /** Optional custom CacheStorage for unit tests. */
  cachesImpl?: CacheStorage;
}

/**
 * Estimates current browser storage quota via `navigator.storage.estimate()` (M6-02).
 */
export async function estimateStorageQuota(): Promise<StorageQuotaEstimate> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      const usageBytes = typeof est.usage === 'number' && est.usage >= 0 ? est.usage : 0;
      const quotaBytes = typeof est.quota === 'number' && est.quota > 0 ? est.quota : 0;
      const availableBytes = Math.max(0, quotaBytes - usageBytes);
      const usageRatio = quotaBytes > 0 ? usageBytes / quotaBytes : 0;
      return { usageBytes, quotaBytes, availableBytes, usageRatio, supported: quotaBytes > 0 };
    }
  } catch {
    /* ignore storage estimate failure */
  }
  return { usageBytes: 0, quotaBytes: 0, availableBytes: 0, usageRatio: 0, supported: false };
}

/**
 * Checks whether the browser has enough remaining storage quota to fit an offline pack
 * of `packBytes` while keeping at least `safetyMarginBytes` free.
 */
export async function canFitOfflinePack(
  packBytes: number,
  safetyMarginBytes = DEFAULT_SAFETY_MARGIN_BYTES,
): Promise<{ ok: boolean; reason?: string; quota: StorageQuotaEstimate }> {
  const quota = await estimateStorageQuota();
  if (!quota.supported) {
    return { ok: true, quota };
  }
  const required = Math.max(0, packBytes) + Math.max(0, safetyMarginBytes);
  if (quota.availableBytes < required) {
    return {
      ok: false,
      reason: `瀏覽器可用儲存空間不足（剩餘 ${(quota.availableBytes / 1048576).toFixed(1)} MB，至少需要 ${(required / 1048576).toFixed(1)} MB）`,
      quota,
    };
  }
  return { ok: true, quota };
}

export function offlineMapCacheName(mapKey: string, contentHash?: string): string {
  const safeKey = mapKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const hashSuffix = contentHash ? `@${contentHash.replace(/[^a-fA-F0-9]/g, '').slice(0, 12)}` : '';
  return `${getOfflineMapCachePrefix()}${safeKey}${hashSuffix}`;
}

/**
 * Downloads an explicit opt-in map offline pack into versioned Cache Storage (M6-02).
 * Never runs automatically in the background; cleans up partial caches on cancellation or error.
 */
export async function downloadMapOfflinePack(
  mapKey: string,
  urls: readonly string[],
  options: DownloadOfflinePackOptions = {},
): Promise<{ cacheName: string; cachedCount: number }> {
  const cachesApi = options.cachesImpl ?? (typeof caches !== 'undefined' ? caches : undefined);
  if (!cachesApi) {
    throw new Error('當前瀏覽器環境不支援 Cache Storage 離線快取');
  }
  const fetchFn = options.fetchImpl ?? fetch.bind(globalThis);
  const estimatedBytes = options.estimatedBytes ?? 0;
  if (estimatedBytes > 0) {
    const check = await canFitOfflinePack(estimatedBytes, options.safetyMarginBytes);
    if (!check.ok) {
      throw new Error(check.reason ?? '儲存空間不足');
    }
  }

  const uniqueUrls = Array.from(new Set(urls.filter(Boolean))).map(u => resolveCdnAssetUrl(u));
  const cacheName = offlineMapCacheName(mapKey, options.contentHash);
  const totalFiles = uniqueUrls.length;
  if (totalFiles === 0) {
    return { cacheName, cachedCount: 0 };
  }

  // Remove any older hash variants for the same mapKey before opening the new cache
  await removeMapOfflinePack(mapKey, cachesApi);

  const cache = await cachesApi.open(cacheName);
  let loadedFiles = 0;
  let nextIdx = 0;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, totalFiles));

  try {
    const worker = async (): Promise<void> => {
      while (nextIdx < totalFiles) {
        if (options.signal?.aborted) {
          throw new Error('離線地圖包下載已取消');
        }
        const i = nextIdx++;
        const url = uniqueUrls[i];
        const res = await fetchFn(url, { signal: options.signal });
        if (!res.ok) {
          throw new Error(`無法下載離線資源 ${url} (HTTP ${res.status})`);
        }
        await cache.put(url, res.clone());
        loadedFiles++;
        options.onProgress?.({
          mapKey,
          loadedFiles,
          totalFiles,
          ratio: loadedFiles / totalFiles,
        });
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { cacheName, cachedCount: loadedFiles };
  } catch (err) {
    await cachesApi.delete(cacheName).catch(() => undefined);
    throw err;
  }
}

/**
 * Deletes a previously cached map offline pack (including any hash suffix variants) (M6-02).
 */
export async function removeMapOfflinePack(
  mapKey: string,
  cachesImpl?: CacheStorage,
): Promise<boolean> {
  const cachesApi = cachesImpl ?? (typeof caches !== 'undefined' ? caches : undefined);
  if (!cachesApi) return false;
  const safeKey = mapKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const prefix = `${getOfflineMapCachePrefix()}${safeKey}`;
  const keys = await cachesApi.keys();
  let removed = false;
  for (const k of keys) {
    if (k === prefix || k.startsWith(`${prefix}@`)) {
      if (await cachesApi.delete(k)) removed = true;
    }
  }
  return removed;
}

/**
 * Lists all map keys currently cached for offline play (M6-02).
 */
export async function listCachedOfflineMaps(cachesImpl?: CacheStorage): Promise<string[]> {
  const cachesApi = cachesImpl ?? (typeof caches !== 'undefined' ? caches : undefined);
  if (!cachesApi) return [];
  const prefix = getOfflineMapCachePrefix();
  const keys = await cachesApi.keys();
  const out = new Set<string>();
  for (const k of keys) {
    if (k.startsWith(prefix)) {
      const rest = k.slice(prefix.length);
      const mapKey = rest.split('@')[0];
      if (mapKey) out.add(mapKey);
    }
  }
  return Array.from(out);
}

/**
 * Purges outdated `rich4-offline-map-*` caches whose version prefix or content hash no longer matches (P2-2 fix).
 */
export async function purgeStaleOfflineCaches(
  cachesImpl?: CacheStorage,
  expectedPackHashes?: Record<string, string>,
): Promise<string[]> {
  const cachesApi = cachesImpl ?? (typeof caches !== 'undefined' ? caches : undefined);
  if (!cachesApi) return [];
  const activePrefix = getOfflineMapCachePrefix();
  const keys = await cachesApi.keys();
  const stale = keys.filter(k => {
    if (!k.startsWith('rich4-offline-map-')) return false;
    if (!k.startsWith(activePrefix)) return true;
    if (expectedPackHashes) {
      const rest = k.slice(activePrefix.length);
      const [mapKey, hashPart] = rest.split('@');
      const expected = expectedPackHashes[mapKey];
      if (expected && hashPart && hashPart !== expected.slice(0, 12)) {
        return true;
      }
    }
    return false;
  });
  await Promise.all(stale.map(k => cachesApi.delete(k)));
  return stale;
}

/**
 * Checks whether a Service Worker registration `scope` belongs strictly to this Rich4 application
 * (e.g. `/rich4/`), preventing accidental unregistration of other apps on the same origin (P1-5 fix).
 */
export function isRich4ServiceWorkerScope(scopeUrl: string, expectedSubpath = '/rich4/'): boolean {
  try {
    const parsed = new URL(scopeUrl, 'https://localhost');
    const cleanExpected = expectedSubpath.startsWith('/') ? expectedSubpath : `/${expectedSubpath}`;
    const normExpected = cleanExpected.endsWith('/') ? cleanExpected : `${cleanExpected}/`;
    if (parsed.pathname === normExpected || parsed.pathname.startsWith(normExpected)) {
      return true;
    }
  } catch {
    /* ignore invalid URL */
  }
  return false;
}

/**
 * Checks whether the Service Worker kill-switch (`?nosw=1` or `localStorage['rich4.disableSW'] === '1'`) is active.
 */
export function isServiceWorkerDisabled(): boolean {
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('nosw') === '1') return true;
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('rich4.disableSW') === '1') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Scoped emergency kill-switch: unregisters ONLY Service Workers belonging to the `/rich4/` scope
 * and purges `rich4-*` caches, leaving other same-origin apps untouched (P1-5 fix).
 */
export async function unregisterAllServiceWorkers(
  cachesImpl?: CacheStorage,
  expectedSubpath = '/rich4/',
): Promise<number> {
  let count = 0;
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        if (isRich4ServiceWorkerScope(r.scope, expectedSubpath)) {
          if (await r.unregister()) count++;
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const cachesApi = cachesImpl ?? (typeof caches !== 'undefined' ? caches : undefined);
    if (cachesApi) {
      const keys = await cachesApi.keys();
      await Promise.all(
        keys.filter(k => k.startsWith('rich4-')).map(k => cachesApi.delete(k)),
      );
    }
  } catch {
    /* ignore */
  }
  return count;
}

/**
 * Registers the lightweight App Shell Service Worker (`./sw.js`) in production builds,
 * or unregisters scoped `/rich4/` workers if the kill-switch is set (M6-01).
 */
export async function initAppShellPwa(): Promise<void> {
  if (isServiceWorkerDisabled()) {
    await unregisterAllServiceWorkers();
    return;
  }
  await purgeStaleOfflineCaches();
  try {
    if (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      import.meta.env?.PROD
    ) {
      const swUrl = `${import.meta.env.BASE_URL || './'}sw.js`;
      await navigator.serviceWorker.register(swUrl, {
        scope: import.meta.env.BASE_URL || './',
      });
    }
  } catch {
    /* Service Worker registration is strictly optional enhancement */
  }
}

/**
 * Optional CDN / Object Storage base URL resolver for static game assets (M6-03 & P1-7 fix).
 * Falls back to the default local/same-origin path when no CDN is configured.
 */
let runtimeAssetCdnBase: string | null = null;

export function setAssetCdnBase(cdnBase: string | null): void {
  runtimeAssetCdnBase = cdnBase ? cdnBase.replace(/\/+$/, '') : null;
}

export function resolveCdnAssetUrl(assetPath: string): string {
  if (!assetPath || /^(?:data:|blob:|https?:\/\/)/i.test(assetPath)) {
    return assetPath;
  }
  const winCdn = (globalThis as { __RICH4_ASSET_CDN__?: string }).__RICH4_ASSET_CDN__;
  const envCdn = (import.meta.env as Record<string, string | undefined> | undefined)?.VITE_RICH4_ASSET_CDN;
  const base = runtimeAssetCdnBase ?? (winCdn ? winCdn.replace(/\/+$/, '') : envCdn ? envCdn.replace(/\/+$/, '') : '');
  if (!base) return assetPath;
  // Normalize `/rich4/assets/...` or `./assets/...` to `assets/...` when rewriting to an external CDN root
  const idx = assetPath.indexOf('assets/');
  const clean = idx >= 0 ? assetPath.slice(idx) : assetPath.replace(/^(\.\/|\/)+/, '');
  return `${base}/${clean}`;
}

/**
 * Privacy-safe, structured local diagnostic & telemetry ring buffer (M6-04 & P2-1 fix).
 * Strips credentials, TURN URLs, userinfo, room chat texts, and save payloads before recording.
 */
export interface DiagnosticEvent {
  ts: number;
  category: 'asset' | 'render' | 'net' | 'storage' | 'error';
  code: string;
  metrics?: Record<string, number | boolean | string>;
  detail?: string;
}

export function redactSensitiveText(input: string, maxLength = 240): string {
  let out = String(input ?? '');
  // 1. Redact any TURN/TURNS URI completely without preserving `$1` (fixes P2-1 leak)
  out = out.replace(/turns?:[^\s"',}\]]+/gi, 'turn:[REDACTED]');
  // 2. Redact any URI with embedded `user:pass@`
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  // 3. Redact sensitive JSON / key-value fields (credentials, tokens, chat, saves)
  out = out.replace(
    /("?(?:credential|password|username|token|reconnectToken|tokenCommit|secret|chat|text|saveData|world|players)"?\s*[:=]\s*)(\{[\s\S]*?\}|\[[\s\S]*?\]|"[^"]*"|'[^']*'|[^\s,}\]]+)/gi,
    '$1"[REDACTED]"',
  );
  if (out.length > maxLength) {
    out = `${out.slice(0, maxLength)}…`;
  }
  return out;
}

const ALLOWED_METRIC_KEYS = new Set([
  'status',
  'durationMs',
  'attempt',
  'packId',
  'mapId',
  'fps',
  'fps1Low',
  'longFrames',
  'reason',
  'backend',
]);

export class TelemetryRingBuffer {
  private readonly buffer: DiagnosticEvent[] = [];
  constructor(private readonly capacity = 50) {}

  record(
    category: DiagnosticEvent['category'],
    code: string,
    rawDetailOrMetrics?: string | Record<string, number | boolean | string>,
  ): void {
    const safeCode = code.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 64);
    const entry: DiagnosticEvent = {
      ts: Date.now(),
      category,
      code: safeCode,
    };
    if (typeof rawDetailOrMetrics === 'string' && rawDetailOrMetrics) {
      entry.detail = redactSensitiveText(rawDetailOrMetrics);
    } else if (rawDetailOrMetrics && typeof rawDetailOrMetrics === 'object') {
      const cleanMetrics: Record<string, number | boolean | string> = {};
      for (const [k, v] of Object.entries(rawDetailOrMetrics)) {
        if (!ALLOWED_METRIC_KEYS.has(k)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) cleanMetrics[k] = v;
        else if (typeof v === 'boolean') cleanMetrics[k] = v;
        else if (typeof v === 'string') cleanMetrics[k] = redactSensitiveText(v, 80);
      }
      entry.metrics = cleanMetrics;
    }
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(entry);
  }

  snapshot(): DiagnosticEvent[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

export const defaultTelemetry = new TelemetryRingBuffer(50);
