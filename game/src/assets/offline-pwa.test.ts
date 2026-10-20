import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canFitOfflinePack,
  downloadMapOfflinePack,
  estimateStorageQuota,
  listCachedOfflineMaps,
  offlineMapCacheName,
  purgeStaleOfflineCaches,
  redactSensitiveText,
  removeMapOfflinePack,
  resolveCdnAssetUrl,
  setAssetCdnBase,
  TelemetryRingBuffer,
} from './offline-pwa';

function createMemoryCacheStorage(): CacheStorage {
  const store = new Map<string, Map<string, Response>>();
  return {
    async open(cacheName: string): Promise<Cache> {
      let bucket = store.get(cacheName);
      if (!bucket) {
        bucket = new Map();
        store.set(cacheName, bucket);
      }
      return {
        async put(req: RequestInfo | URL, res: Response) {
          bucket!.set(String(req), res);
        },
        async match(req: RequestInfo | URL) {
          return bucket!.get(String(req));
        },
      } as unknown as Cache;
    },
    async delete(cacheName: string): Promise<boolean> {
      return store.delete(cacheName);
    },
    async keys(): Promise<string[]> {
      return Array.from(store.keys());
    },
    async has(cacheName: string): Promise<boolean> {
      return store.has(cacheName);
    },
    async match(): Promise<Response | undefined> {
      return undefined;
    },
  };
}

describe('offline-pwa (M6)', () => {
  afterEach(() => {
    setAssetCdnBase(null);
    vi.restoreAllMocks();
  });

  it('estimates browser storage quota and checks offline pack capacity', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => ({
          usage: 100 * 1024 * 1024,
          quota: 500 * 1024 * 1024,
        }),
      },
    });
    const quota = await estimateStorageQuota();
    expect(quota.supported).toBe(true);
    expect(quota.availableBytes).toBe(400 * 1024 * 1024);

    const fitSmall = await canFitOfflinePack(100 * 1024 * 1024, 150 * 1024 * 1024);
    expect(fitSmall.ok).toBe(true);

    const fitTooBig = await canFitOfflinePack(300 * 1024 * 1024, 150 * 1024 * 1024);
    expect(fitTooBig.ok).toBe(false);
    expect(fitTooBig.reason).toContain('儲存空間不足');
  });

  it('downloads opt-in map offline pack with progress, lists cached maps, and deletes or rolls back on failure', async () => {
    const cachesImpl = createMemoryCacheStorage();
    const progressSteps: number[] = [];
    const fetchOk = vi.fn(async (input: RequestInfo | URL) => new Response(`data:${String(input)}`, { status: 200 }));

    const res = await downloadMapOfflinePack(
      'orig-0',
      ['/rich4/assets/maps/map-0.json', '/rich4/assets/maps/map-0.webp'],
      {
        cachesImpl,
        fetchImpl: fetchOk as unknown as typeof fetch,
        onProgress: (p) => progressSteps.push(p.loadedFiles),
      },
    );

    expect(res.cacheName).toBe(offlineMapCacheName('orig-0'));
    expect(res.cachedCount).toBe(2);
    expect(progressSteps).toEqual([1, 2]);
    expect(await listCachedOfflineMaps(cachesImpl)).toEqual(['orig-0']);

    // Failed download rolls back partial cache
    const fetchFail = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('bad.webp')
        ? new Response('not found', { status: 404 })
        : new Response('ok', { status: 200 }),
    );
    await expect(
      downloadMapOfflinePack(
        'orig-1',
        ['/rich4/assets/maps/map-1.json', '/rich4/assets/maps/bad.webp'],
        {
          cachesImpl,
          fetchImpl: fetchFail as unknown as typeof fetch,
          concurrency: 1,
        },
      ),
    ).rejects.toThrow(/HTTP 404/);
    expect(await listCachedOfflineMaps(cachesImpl)).toEqual(['orig-0']);

    // Remove cached pack
    expect(await removeMapOfflinePack('orig-0', cachesImpl)).toBe(true);
    expect(await listCachedOfflineMaps(cachesImpl)).toEqual([]);
  });

  it('purges outdated offline map caches from older versions', async () => {
    const cachesImpl = createMemoryCacheStorage();
    await cachesImpl.open('rich4-offline-map-v0-tokyo');
    await cachesImpl.open(offlineMapCacheName('tokyo'));
    const purged = await purgeStaleOfflineCaches(cachesImpl);
    expect(purged).toEqual(['rich4-offline-map-v0-tokyo']);
    expect(await cachesImpl.keys()).toEqual([offlineMapCacheName('tokyo')]);
  });

  it('resolves optional CDN base URL for static assets and falls back to local path', () => {
    expect(resolveCdnAssetUrl('assets/maps/map-0.json')).toBe('assets/maps/map-0.json');
    setAssetCdnBase('https://cdn.example.com/rich4-static/');
    expect(resolveCdnAssetUrl('./assets/maps/map-0.json')).toBe(
      'https://cdn.example.com/rich4-static/assets/maps/map-0.json',
    );
  });

  it('redacts sensitive TURN credentials, chat texts, and save payloads in telemetry ring buffer', () => {
    const buf = new TelemetryRingBuffer(3);
    buf.record(
      'net',
      'ice-error',
      '{"url":"turn:relay.example.com:3478","credential":"super-secret-password","chat":"hello private"}',
    );
    const snap = buf.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].detail).not.toContain('super-secret-password');
    expect(snap[0].detail).not.toContain('hello private');
    expect(snap[0].detail).toContain('[REDACTED]');

    // Ring buffer capacity cap
    buf.record('asset', 'e1');
    buf.record('asset', 'e2');
    buf.record('asset', 'e3');
    expect(buf.snapshot().map((e) => e.code)).toEqual(['e1', 'e2', 'e3']);
    expect(redactSensitiveText('password: "abc"')).toContain('[REDACTED]');
  });
});
