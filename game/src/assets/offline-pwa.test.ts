import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canFitOfflinePack,
  downloadMapOfflinePack,
  estimateStorageQuota,
  isRich4ServiceWorkerScope,
  listCachedOfflineMaps,
  offlineMapCacheName,
  purgeStaleOfflineCaches,
  redactSensitiveText,
  removeMapOfflinePack,
  resolveCdnAssetUrl,
  setAssetCdnBase,
  TelemetryRingBuffer,
  unregisterAllServiceWorkers,
} from './offline-pwa';
import { resolveMapOfflinePackSpec } from '../ui/assets';

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

describe('offline-pwa (M6, P1-5, P2-1, P2-2)', () => {
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

  it('purges outdated offline map caches from older versions or stale content hashes (P2-2)', async () => {
    const cachesImpl = createMemoryCacheStorage();
    await cachesImpl.open('rich4-offline-map-v0-tokyo');
    await cachesImpl.open(offlineMapCacheName('tokyo', 'aa11bb22cc33'));
    await cachesImpl.open(offlineMapCacheName('tokyo', 'dd44ee55ff66'));
    const purged = await purgeStaleOfflineCaches(cachesImpl, { tokyo: 'dd44ee55ff66' });
    expect(purged).toEqual([
      'rich4-offline-map-v0-tokyo',
      offlineMapCacheName('tokyo', 'aa11bb22cc33'),
    ]);
    expect(await cachesImpl.keys()).toEqual([offlineMapCacheName('tokyo', 'dd44ee55ff66')]);
  });

  it('unregisters ONLY /rich4/ scoped Service Workers without touching sibling apps on the same origin (P1-5)', async () => {
    expect(isRich4ServiceWorkerScope('https://apps.example.com/rich4/')).toBe(true);
    expect(isRich4ServiceWorkerScope('https://apps.example.com/other-app/')).toBe(false);
    expect(isRich4ServiceWorkerScope('https://apps.example.com/')).toBe(false);

    const unregRich4 = vi.fn(async () => true);
    const unregOther = vi.fn(async () => true);
    const unregRoot = vi.fn(async () => true);
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: async () => [
          { scope: 'https://apps.example.com/rich4/', unregister: unregRich4 },
          { scope: 'https://apps.example.com/other-app/', unregister: unregOther },
          { scope: 'https://apps.example.com/', unregister: unregRoot },
        ],
      },
    });
    const cachesImpl = createMemoryCacheStorage();
    await cachesImpl.open('rich4-app-shell-v1');
    await cachesImpl.open('other-app-cache-v1');
    vi.stubGlobal('caches', cachesImpl);

    const count = await unregisterAllServiceWorkers();
    expect(count).toBe(1);
    expect(unregRich4).toHaveBeenCalledTimes(1);
    expect(unregOther).not.toHaveBeenCalled();
    expect(unregRoot).not.toHaveBeenCalled();
    expect(await cachesImpl.keys()).toEqual(['other-app-cache-v1']);
  });

  it('resolves optional CDN base URL for static assets and full map offline pack closure from web-packs.json (P1-04 & P2)', async () => {
    expect(resolveCdnAssetUrl('assets/maps/map-0.json')).toBe('assets/maps/map-0.json');
    setAssetCdnBase('https://cdn.example.com/rich4-static/');
    expect(resolveCdnAssetUrl('./assets/maps/map-0.json')).toBe(
      'https://cdn.example.com/rich4-static/assets/maps/map-0.json',
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            packs: {
              shell: {
                id: 'shell',
                category: 'shell',
                fileCount: 2,
                bytes: 1024,
                sha256: '1111222233334444',
                files: ['maps/maps.json', 'orig/manifest.json'],
              },
              'map-8': {
                id: 'map-8',
                category: 'map',
                fileCount: 4,
                bytes: 20480,
                sha256: 'aabbccddeeff001122334455',
                files: [
                  'maps/remake/kabukicho.json',
                  'maps/remake/kabukicho.webp',
                  'maps/remake/sprites/1901/frames.json',
                  'maps/remake/sprites/1901/frame-000.webp',
                ],
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const spec = await resolveMapOfflinePackSpec({
      id: 8,
      name: '歌舞伎町',
      thumbnail: './assets/maps/remake/thumbs/kabukicho.webp',
      custom: true,
      kind: 'custom',
      data: 'remake/kabukicho.json',
      image: 'remake/kabukicho.webp',
    });
    expect(spec.contentHash).toBe('aabbccddeeff001122334455');
    expect(spec.bytes).toBe(20480 + 1024);
    expect(spec.urls.length).toBeGreaterThanOrEqual(6);
    expect(spec.urls.some(u => u.includes('sprites/1901/frame-000.webp'))).toBe(true);
    expect(spec.urls.every(u => u.startsWith('https://cdn.example.com/rich4-static/assets/'))).toBe(true);
  });

  it('completely redacts TURN URLs with embedded credentials, chat texts, and supports structured metrics (P2-1)', () => {
    // Regression test for P2-1: turn:user:secret@host must NOT retain 'secret' or 'user'
    const turnLeak = redactSensitiveText('ICE failed on turn:alice:topSecretPass123@turn.example.com:3478?transport=udp');
    expect(turnLeak).not.toContain('topSecretPass123');
    expect(turnLeak).not.toContain('alice');
    expect(turnLeak).toContain('turn:[REDACTED]');

    const buf = new TelemetryRingBuffer(3);
    buf.record(
      'net',
      'ice-error',
      '{"url":"turns:user99:mySecretTurnKey@relay.example.com:5349","credential":"super-secret-password","chat":"hello private"}',
    );
    const snap = buf.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].detail).not.toContain('mySecretTurnKey');
    expect(snap[0].detail).not.toContain('super-secret-password');
    expect(snap[0].detail).not.toContain('hello private');
    expect(snap[0].detail).toContain('[REDACTED]');

    // Structured metric whitelist
    buf.record('render', 'frame-summary', { fps: 60, longFrames: 0, secretLeak: 'nope' });
    expect(buf.snapshot()[1].metrics).toEqual({ fps: 60, longFrames: 0 });

    // Ring buffer capacity cap
    buf.record('asset', 'e1');
    buf.record('asset', 'e2');
    expect(buf.snapshot().map((e) => e.code)).toEqual(['frame-summary', 'e1', 'e2']);
  });
});
