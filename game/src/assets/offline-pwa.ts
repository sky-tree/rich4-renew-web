/**
 * M6 — App Shell PWA, Opt-in Offline Map Packs, Optional Asset CDN Resolution,
 * and Privacy-Safe Anonymous Telemetry Ring Buffer.
 */

export const OFFLINE_MAP_CACHE_VERSION = 'v1';
export const OFFLINE_MAP_CACHE_PREFIX = `rich4-offline-map-${OFFLINE_MAP_CACHE_VERSION}-`;
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
    // When the browser does not expose quota numbers, allow the attempt and rely on Cache.put error handling.
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

export function offlineMapCacheName(mapKey: string): string {
  const safeKey = mapKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${OFFLINE_MAP_CACHE_PREFIX}${safeKey}`;
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

  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  const cacheName = offlineMapCacheName(mapKey);
  const totalFiles = uniqueUrls.length;
  if (totalFiles === 0) {
    return { cacheName, cachedCount: 0 };
  }

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
    // Roll back partial cache so broken packs never linger
    await cachesApi.delete(cacheName).catch(() => undefined);
    throw err;
  }
}

/**
 * Deletes a previously cached map offline pack (M6-02).
 */
export async function removeMapOfflinePack(
  mapKey: string,
  cachesImpl?: CacheStorage,
): Promise<boolean> {
  const cachesApi = cachesImpl ?? (typeof caches !== 'undefined' ? caches : undefined);
  if (!cachesApi) return false;
  return cachesApi.delete(offlineMapCacheName(mapKey));
}

/**
 * Lists all map keys currently cached for offline play (M6-02).
 */
export async function listCachedOfflineMaps(cachesImpl?: CacheStorage): Promise<string[]> {
  const cachesApi = cachesImpl ?? (typeof caches !== 'undefined' ? caches : undefined);
  if (!cachesApi) return [];
  const keys = await cachesApi.keys();
  return keys
    .filter((k) => k.startsWith(OFFLINE_MAP_CACHE_PREFIX))
    .map((k) => k.slice(OFFLINE_MAP_CACHE_PREFIX.length));
}

/**
 * Purges outdated `rich4-offline-map-*` caches whose version prefix no longer matches `OFFLINE_MAP_CACHE_PREFIX`.
 */
export async function purgeStaleOfflineCaches(cachesImpl?: CacheStorage): Promise<string[]> {
  const cachesApi = cachesImpl ?? (typeof caches !== 'undefined' ? caches : undefined);
  if (!cachesApi) return [];
  const keys = await cachesApi.keys();
  const stale = keys.filter(
    (k) => k.startsWith('rich4-offline-map-') && !k.startsWith(OFFLINE_MAP_CACHE_PREFIX),
  );
  await Promise.all(stale.map((k) => cachesApi.delete(k)));
  return stale;
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
 * Emergency kill-switch: unregisters all Service Workers under the current scope and purges `rich4-*` caches.
 */
export async function unregisterAllServiceWorkers(cachesImpl?: CacheStorage): Promise<number> {
  let count = 0;
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        if (await r.unregister()) count++;
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
        keys.filter((k) => k.startsWith('rich4-')).map((k) => cachesApi.delete(k)),
      );
    }
  } catch {
    /* ignore */
  }
  return count;
}

/**
 * Registers the lightweight App Shell Service Worker (`./sw.js`) in production builds,
 * or unregisters everything if the kill-switch is set (M6-01).
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
 * Optional CDN / Object Storage base URL resolver for static game assets (M6-03).
 * Falls back to the default local/same-origin path when no CDN is configured.
 */
let runtimeAssetCdnBase: string | null = null;

export function setAssetCdnBase(cdnBase: string | null): void {
  runtimeAssetCdnBase = cdnBase ? cdnBase.replace(/\/+$/, '') : null;
}

export function resolveCdnAssetUrl(assetPath: string): string {
  const winCdn = (globalThis as { __RICH4_ASSET_CDN__?: string }).__RICH4_ASSET_CDN__;
  const envCdn = (import.meta.env as Record<string, string | undefined> | undefined)?.VITE_RICH4_ASSET_CDN;
  const base = runtimeAssetCdnBase ?? (winCdn ? winCdn.replace(/\/+$/, '') : envCdn ? envCdn.replace(/\/+$/, '') : '');
  if (!base) return assetPath;
  const clean = assetPath.replace(/^(\.\/|\/)+/, '');
  return `${base}/${clean}`;
}

/**
 * Privacy-safe, anonymous local diagnostic & telemetry ring buffer (M6-04).
 * Strips credentials, TURN passwords, room chat texts, and save payloads before recording.
 */
export interface DiagnosticEvent {
  ts: number;
  category: 'asset' | 'render' | 'net' | 'storage' | 'error';
  code: string;
  detail?: string;
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /("?(?:credential|password|token|secret)"?\s*:\s*)"[^"]*"/gi,
  /(turn:[^\s"']+)/gi,
  /("?(?:chat|text|saveData|world|players)"?\s*:\s*)(\{[\s\S]*?\}|\[[\s\S]*?\]|"[^"]*")/gi,
];

export function redactSensitiveText(input: string, maxLength = 240): string {
  let out = input;
  for (const re of SENSITIVE_PATTERNS) {
    out = out.replace(re, '$1"[REDACTED]"');
  }
  if (out.length > maxLength) {
    out = `${out.slice(0, maxLength)}…`;
  }
  return out;
}

export class TelemetryRingBuffer {
  private readonly buffer: DiagnosticEvent[] = [];
  constructor(private readonly capacity = 50) {}

  record(category: DiagnosticEvent['category'], code: string, rawDetail?: string): void {
    const entry: DiagnosticEvent = {
      ts: Date.now(),
      category,
      code,
      ...(rawDetail ? { detail: redactSensitiveText(rawDetail) } : {}),
    };
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
