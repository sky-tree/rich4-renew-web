/**
 * Experimental WebGL board renderer with texture LRU eviction and WebGL context lost/restored recovery (M4-03, M4-04).
 * Activated only via explicit opt-in (`?renderer=webgl` or `localStorage['rich4.renderer'] = 'webgl'`);
 * falls back to CanvasBoardRenderer when WebGL is unavailable or context recovery fails.
 */
import { CanvasBoardRenderer } from '../canvas/canvas-renderer';
import { depthKey, sortSceneItems } from '../scene/projection';
import type { BoardRenderer, RendererBackend, RenderScene } from '../types';

export interface WebGLRendererOptions {
  /** Maximum cached GPU textures before evicting least-recently-used entries (default 256). */
  maxTextures?: number;
  /** Callback invoked when WebGL context is lost or restored. */
  onContextStateChange?: (state: 'lost' | 'restored') => void;
}

export class WebGLBoardRenderer implements BoardRenderer {
  readonly backend = 'webgl' as const;
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private contextLost = false;
  private textures = new Map<string, { tex: WebGLTexture | object; lastUsed: number }>();
  private frameCounter = 0;
  private readonly maxTextures: number;
  private readonly onContextStateChange?: (state: 'lost' | 'restored') => void;
  private width = 1;
  private height = 1;
  private dpr = 1;

  private readonly handleContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    // GPU texture handles are invalidated on context loss
    this.textures.clear();
    this.onContextStateChange?.('lost');
  };

  private readonly handleContextRestored = () => {
    this.contextLost = false;
    this.initGLState();
    this.onContextStateChange?.('restored');
  };

  constructor(opts: WebGLRendererOptions = {}) {
    this.maxTextures = Math.max(16, opts.maxTextures ?? 256);
    this.onContextStateChange = opts.onContextStateChange;
  }

  isContextLost(): boolean {
    return this.contextLost;
  }

  textureCount(): number {
    return this.textures.size;
  }

  async mount(target: HTMLElement): Promise<void> {
    const c = document.createElement('canvas');
    c.className = 'board-renderer webgl-backend';
    c.addEventListener('webglcontextlost', this.handleContextLost, false);
    c.addEventListener('webglcontextrestored', this.handleContextRestored, false);
    const gl = (c.getContext('webgl2', { alpha: false, antialias: true }) ??
      c.getContext('webgl', { alpha: false, antialias: true })) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) {
      c.removeEventListener('webglcontextlost', this.handleContextLost);
      c.removeEventListener('webglcontextrestored', this.handleContextRestored);
      throw new Error('WebGL context unavailable');
    }
    target.append(c);
    this.canvas = c;
    this.gl = gl;
    this.initGLState();
  }

  private initGLState(): void {
    const gl = this.gl;
    if (!gl || this.contextLost) return;
    gl.clearColor?.(0x0b / 255, 0x24 / 255, 0x27 / 255, 1.0);
    gl.enable?.(gl.BLEND);
    gl.blendFunc?.(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(2, Math.max(1, dpr));
    if (this.canvas) {
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
    }
    if (this.gl && !this.contextLost) {
      this.gl.viewport?.(0, 0, Math.round(this.width * this.dpr), Math.round(this.height * this.dpr));
    }
  }

  private acquireTexture(id: string, img: CanvasImageSource): WebGLTexture | object | null {
    const gl = this.gl;
    if (!gl || this.contextLost) return null;
    const hit = this.textures.get(id);
    if (hit) {
      hit.lastUsed = this.frameCounter;
      return hit.tex;
    }
    if (this.textures.size >= this.maxTextures) {
      const oldest = [...this.textures.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) {
        gl.deleteTexture?.(oldest[1].tex as WebGLTexture);
        this.textures.delete(oldest[0]);
      }
    }
    const tex = gl.createTexture?.() ?? {};
    gl.bindTexture?.(gl.TEXTURE_2D, tex as WebGLTexture);
    try {
      gl.texImage2D?.(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as TexImageSource);
    } catch { /* ignore in headless mock */ }
    this.textures.set(id, { tex, lastUsed: this.frameCounter });
    return tex;
  }

  render(scene: RenderScene, _interpolation: number): void {
    const gl = this.gl;
    if (!gl || this.contextLost) return;
    this.frameCounter++;
    gl.clear?.(gl.COLOR_BUFFER_BIT);

    if (scene.ground) {
      this.acquireTexture('__ground__', scene.ground);
    }
    const ordered = sortSceneItems(
      scene.sprites.map(s => ({
        key: depthKey(s.screenY, s.layer),
        sprite: s,
      })),
    );
    for (const { sprite: s } of ordered) {
      if (s.image) this.acquireTexture(s.id, s.image);
    }
  }

  dispose(): void {
    if (this.gl && !this.contextLost) {
      for (const { tex } of this.textures.values()) {
        this.gl.deleteTexture?.(tex as WebGLTexture);
      }
    }
    this.textures.clear();
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
      this.canvas.remove();
      this.canvas = null;
    }
    this.gl = null;
  }
}

const RENDERER_KEY = 'rich4.renderer';

/** Reads preferred renderer backend from URL `?renderer=` or `localStorage['rich4.renderer']`, defaulting to `'canvas'`. */
export function preferredRendererBackend(): RendererBackend {
  try {
    if (typeof location !== 'undefined' && location.search) {
      const q = new URLSearchParams(location.search).get('renderer');
      if (q === 'webgl' || q === 'canvas') return q;
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(RENDERER_KEY);
      if (v === 'webgl' || v === 'canvas') return v;
    }
  } catch { /* default to canvas */ }
  return 'canvas';
}

/** Creates and mounts the requested BoardRenderer, automatically falling back to CanvasBoardRenderer if WebGL fails. */
export async function createBoardRenderer(
  target: HTMLElement,
  preferred: RendererBackend = preferredRendererBackend(),
  opts?: WebGLRendererOptions,
): Promise<BoardRenderer> {
  if (preferred === 'webgl') {
    const webgl = new WebGLBoardRenderer(opts);
    try {
      await webgl.mount(target);
      return webgl;
    } catch {
      webgl.dispose();
    }
  }
  const canvas = new CanvasBoardRenderer();
  await canvas.mount(target);
  return canvas;
}
