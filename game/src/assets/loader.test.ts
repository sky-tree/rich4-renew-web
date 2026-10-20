import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetLoader, AssetLoadError } from './loader';
import { requiredPacksFor, validatePackManifest } from './manifest';
import { __clearImageCacheForTest, portrait } from '../ui/assets';

describe('Web asset pack manifest and dependency resolution (M2)', () => {
  it('validates a well-formed WebAssetManifest and rejects malformed ones', () => {
    expect(validatePackManifest(null)).toBe(false);
    expect(validatePackManifest({ schemaVersion: 2 })).toBe(false);
    expect(
      validatePackManifest({
        schemaVersion: 1,
        buildId: 'abc1234',
        generatedAt: '2026-10-21T00:00:00Z',
        webp: true,
        totalFiles: 10,
        totalBytes: 1024,
        categories: {
          shell: { fileCount: 5, bytes: 512 },
          core: { fileCount: 5, bytes: 512 },
          map: { fileCount: 0, bytes: 0 },
          ground: { fileCount: 0, bytes: 0 },
          optional: { fileCount: 0, bytes: 0 },
        },
        packs: {
          shell: { id: 'shell', category: 'shell', fileCount: 5, bytes: 512 },
          core: { id: 'core', category: 'core', fileCount: 5, bytes: 512 },
        },
      }),
    ).toBe(true);
  });

  it('resolves only required packs for title screen vs map play without pulling other maps', () => {
    expect(requiredPacksFor()).toEqual(['shell']);
    expect(requiredPacksFor({ mapId: 0 })).toEqual(['shell', 'core', 'map-0']);
    expect(requiredPacksFor({ mapId: 100, groundStyle: 'ghibli' })).toEqual(['shell', 'core', 'map-100', 'ground-100-ghibli']);
    expect(requiredPacksFor({ mapId: 2, groundStyle: '', includeOptional: true })).toEqual(['shell', 'core', 'map-2', 'optional']);
  });
});

describe('AssetLoader concurrency, deduplication, retry and fail-fast', () => {
  it('deduplicates concurrent in-flight JSON requests to the same URL', async () => {
    let calls = 0;
    const loader = new AssetLoader({
      fetchFn: vi.fn(async () => {
        calls++;
        await new Promise(r => setTimeout(r, 20));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    });
    const [a, b, c] = await Promise.all([
      loader.fetchJson<{ ok: boolean }>('/test.json'),
      loader.fetchJson<{ ok: boolean }>('/test.json'),
      loader.fetchJson<{ ok: boolean }>('/test.json'),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(c).toEqual({ ok: true });
  });

  it('retries transient 502 errors with backoff and succeeds', async () => {
    let calls = 0;
    const loader = new AssetLoader({
      maxRetries: 2,
      baseDelayMs: 10,
      fetchFn: vi.fn(async () => {
        calls++;
        if (calls < 3) return new Response('Bad Gateway', { status: 502 });
        return new Response(JSON.stringify({ recovered: true }), { status: 200 });
      }),
    });
    const res = await loader.fetchJson<{ recovered: boolean }>('/flaky.json');
    expect(res).toEqual({ recovered: true });
    expect(calls).toBe(3);
  });

  it('fails fast on HTTP 404 without retrying', async () => {
    let calls = 0;
    const loader = new AssetLoader({
      maxRetries: 3,
      baseDelayMs: 10,
      fetchFn: vi.fn(async () => {
        calls++;
        return new Response('Not Found', { status: 404 });
      }),
    });
    await expect(loader.fetchJson('/missing.json')).rejects.toThrow(AssetLoadError);
    expect(calls).toBe(1);
  });

  it('enforces concurrency limit across parallel requests', async () => {
    let active = 0;
    let maxObserved = 0;
    const loader = new AssetLoader({
      concurrency: 2,
      fetchFn: vi.fn(async () => {
        active++;
        maxObserved = Math.max(maxObserved, active);
        await new Promise(r => setTimeout(r, 15));
        active--;
        return new Response(JSON.stringify({ v: 1 }), { status: 200 });
      }),
    });
    await Promise.all(Array.from({ length: 6 }, (_, i) => loader.fetchJson(`/u-${i}.json`)));
    expect(maxObserved).toBeLessThanOrEqual(2);
  });
});

describe('portrait() WebP and orig fallback (M2-07)', () => {
  beforeEach(() => {
    __clearImageCacheForTest();
  });

  it('falls back to .webp when HD .png is missing (RICH4_WEBP=1 bundle)', async () => {
    const requested: string[] = [];
    class MockImage {
      decoding = 'async';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = '';
      get src() { return this._src; }
      set src(v: string) {
        this._src = v;
        requested.push(v);
        queueMicrotask(() => {
          if (v.endsWith('.webp')) this.onload?.();
          else this.onerror?.();
        });
      }
    }
    vi.stubGlobal('Image', MockImage);
    const img = await portrait(2);
    expect(img.src).toContain('hd/Data/0002-SMP/frame-002.webp');
    expect(requested.length).toBe(2);
  });
});
