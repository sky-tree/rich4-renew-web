import { describe, expect, it, vi } from 'vitest';
import { buildingFrame, computeBasis, depthKey, projectPoint, RenderLayer, screenDir, sortSceneItems, unprojectPoint } from './scene/projection';
import { RenderMetricsCollector, type RenderScene } from './types';
import { createBoardRenderer, WebGLBoardRenderer } from './webgl/webgl-renderer';

describe('Isometric scene projection and depth sorting (M4-01)', () => {
  it('round-trips projectPoint and unprojectPoint across all 8 rotations with sub-pixel accuracy', () => {
    const view = { width: 960, height: 640 };
    for (let rot = 0; rot < 8; rot++) {
      const cam = { x: 1152, y: 1152, rot, zoom: 1.25, fy: 0.48 };
      const b = computeBasis(rot, cam.zoom);
      expect(Math.abs(b.a * b.d - b.b * b.c)).toBeGreaterThan(0.1);

      for (const pt of [
        { x: 0, y: 0 },
        { x: 1152, y: 1152 },
        { x: 420.5, y: 1980.25 },
        { x: 2304, y: 600 },
      ]) {
        const scr = projectPoint(pt.x, pt.y, cam, view);
        const back = unprojectPoint(scr.x, scr.y, cam, view);
        expect(back.x).toBeCloseTo(pt.x, 5);
        expect(back.y).toBeCloseTo(pt.y, 5);
      }
    }
  });

  it('orders depth keys by screenY first and logical layer second', () => {
    const items = [
      { id: 'zzz', key: depthKey(200, RenderLayer.zzz) },
      { id: 'building-front', key: depthKey(210, RenderLayer.building) },
      { id: 'building-same-y', key: depthKey(200, RenderLayer.building) },
      { id: 'player-same-y', key: depthKey(200, RenderLayer.player) },
      { id: 'current-same-y', key: depthKey(200, RenderLayer.current) },
    ];
    const sorted = sortSceneItems(items).map(i => i.id);
    expect(sorted).toEqual(['building-same-y', 'player-same-y', 'current-same-y', 'zzz', 'building-front']);
    expect(screenDir(2, 1)).toBe(1);
    expect(buildingFrame(3, 2)).toBe(3);
  });
});

describe('RenderMetricsCollector frame telemetry (M4-05)', () => {
  it('computes average FPS, 1% low FPS, p50/p95/p99 and >50ms long frames', () => {
    const m = new RenderMetricsCollector(200);
    for (let i = 0; i < 98; i++) m.recordFrame(16.6);
    m.recordFrame(33.3);
    m.recordFrame(60.0); // > 50ms long frame
    const s = m.summary();
    expect(s.sampleCount).toBe(100);
    expect(s.longFrames).toBe(1);
    expect(s.p50Ms).toBeCloseTo(16.6, 1);
    expect(s.p99Ms).toBeCloseTo(60.0, 1);
    expect(s.fpsAvg).toBeGreaterThan(50);
    expect(s.fps1Low).toBeCloseTo(16.7, 1);
  });
});

describe('WebGLBoardRenderer lifecycle, LRU texture eviction, context loss & fallback (M4-03, M4-04, M4-06)', () => {
  it('handles WebGL context loss/restore and evicts LRU textures above budget', async () => {
    const listeners = new Map<string, (e: Event) => void>();
    const deleted: unknown[] = [];
    const mockGL = {
      BLEND: 1,
      SRC_ALPHA: 2,
      ONE_MINUS_SRC_ALPHA: 3,
      COLOR_BUFFER_BIT: 4,
      TEXTURE_2D: 5,
      RGBA: 6,
      UNSIGNED_BYTE: 7,
      clearColor: vi.fn(),
      enable: vi.fn(),
      blendFunc: vi.fn(),
      viewport: vi.fn(),
      clear: vi.fn(),
      createTexture: vi.fn(() => ({ id: Math.random() })),
      bindTexture: vi.fn(),
      texImage2D: vi.fn(),
      deleteTexture: vi.fn((t: unknown) => deleted.push(t)),
    };

    vi.stubGlobal('document', {
      createElement: () => ({
        className: '',
        width: 0,
        height: 0,
        addEventListener: (ev: string, fn: (e: Event) => void) => listeners.set(ev, fn),
        removeEventListener: (ev: string) => listeners.delete(ev),
        getContext: (kind: string) => (kind === 'webgl2' ? mockGL : null),
        remove: vi.fn(),
      }),
    });

    const states: string[] = [];
    const renderer = new WebGLBoardRenderer({
      maxTextures: 16,
      onContextStateChange: st => states.push(st),
    });
    const host = { append: vi.fn() } as unknown as HTMLElement;
    await renderer.mount(host);

    const scene: RenderScene = {
      camera: { x: 0, y: 0, rot: 0, zoom: 1 },
      ground: {} as CanvasImageSource,
      worldSize: 2304,
      sprites: Array.from({ length: 20 }, (_, i) => ({
        id: `spr-${i}`,
        image: {} as CanvasImageSource,
        screenX: i * 10,
        screenY: i * 10,
        width: 32,
        height: 32,
        anchorX: 16,
        anchorY: 32,
        scale: 1,
        layer: 0,
      })),
    };

    renderer.render(scene, 0);
    expect(renderer.textureCount()).toBe(16);
    expect(deleted.length).toBeGreaterThan(0);

    // Simulate webglcontextlost
    listeners.get('webglcontextlost')?.({ preventDefault: vi.fn() } as unknown as Event);
    expect(renderer.isContextLost()).toBe(true);
    expect(renderer.textureCount()).toBe(0);

    // Simulate webglcontextrestored
    listeners.get('webglcontextrestored')?.({} as Event);
    expect(renderer.isContextLost()).toBe(false);
    expect(states).toEqual(['lost', 'restored']);

    renderer.dispose();
    expect(renderer.textureCount()).toBe(0);
  });

  it('automatically falls back to CanvasBoardRenderer when WebGL context creation fails', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        className: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getContext: (kind: string) => (kind === '2d' ? {} : null),
        remove: vi.fn(),
      }),
    });
    const host = { append: vi.fn() } as unknown as HTMLElement;
    const r = await createBoardRenderer(host, 'webgl');
    expect(r.backend).toBe('canvas');
    r.dispose();
  });
});
