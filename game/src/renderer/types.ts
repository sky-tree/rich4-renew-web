/**
 * Renderer interface abstractions and frame performance telemetry (M4-02, M4-05).
 */
import type { CameraState } from './scene/projection';

export type RendererBackend = 'canvas' | 'webgl';

export interface SpriteQuadState {
  id: string;
  image: CanvasImageSource | null;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  scale: number;
  layer: number;
  alpha?: number;
}

export interface RenderScene {
  camera: CameraState;
  ground: CanvasImageSource | null;
  worldSize: number;
  sprites: ReadonlyArray<SpriteQuadState>;
}

export interface BoardRenderer {
  readonly backend: RendererBackend;
  mount(target: HTMLElement): Promise<void>;
  render(scene: RenderScene, interpolation: number): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

export interface PerfSummary {
  sampleCount: number;
  fpsAvg: number;
  fps1Low: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  longFrames: number;
}

/**
 * Rolling frame-time telemetry collector for paired Canvas vs WebGL A/B comparison (M4-05).
 */
export class RenderMetricsCollector {
  private readonly samples: number[] = [];
  private readonly maxSamples: number;
  private longFrameCount = 0;

  constructor(maxSamples = 600) {
    this.maxSamples = Math.max(10, maxSamples);
  }

  recordFrame(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    if (durationMs > 50) this.longFrameCount++;
    if (this.samples.length >= this.maxSamples) this.samples.shift();
    this.samples.push(durationMs);
  }

  reset(): void {
    this.samples.length = 0;
    this.longFrameCount = 0;
  }

  summary(): PerfSummary {
    const n = this.samples.length;
    if (n === 0) {
      return { sampleCount: 0, fpsAvg: 0, fps1Low: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, longFrames: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const meanMs = sum / n;
    const pick = (q: number) => sorted[Math.min(n - 1, Math.floor(n * q))];
    const p50Ms = pick(0.5);
    const p95Ms = pick(0.95);
    const p99Ms = pick(0.99);
    return {
      sampleCount: n,
      fpsAvg: meanMs > 0 ? Math.round((1000 / meanMs) * 10) / 10 : 0,
      fps1Low: p99Ms > 0 ? Math.round((1000 / p99Ms) * 10) / 10 : 0,
      p50Ms: Math.round(p50Ms * 100) / 100,
      p95Ms: Math.round(p95Ms * 100) / 100,
      p99Ms: Math.round(p99Ms * 100) / 100,
      longFrames: this.longFrameCount,
    };
  }
}
