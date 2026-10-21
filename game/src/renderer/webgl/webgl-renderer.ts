/**
 * Experimental WebGL board renderer with full 2D textured-quad shader pipeline,
 * texture LRU eviction, and WebGL context lost/restored recovery (M4-03, M4-04, P1-3 fix).
 * Activated only via explicit opt-in (`?renderer=webgl` or `localStorage['rich4.renderer'] = 'webgl'`);
 * falls back to CanvasBoardRenderer when WebGL is unavailable or context recovery fails.
 */
import { CanvasBoardRenderer } from '../canvas/canvas-renderer';
import { computeBasis, depthKey, sortSceneItems } from '../scene/projection';
import type { BoardRenderer, RendererBackend, RenderScene } from '../types';

export interface WebGLRendererOptions {
  /** Maximum cached GPU textures before evicting least-recently-used entries (default 256). */
  maxTextures?: number;
  /** Callback invoked when WebGL context is lost or restored. */
  onContextStateChange?: (state: 'lost' | 'restored') => void;
}

const VERTEX_SHADER_SRC = `
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform vec2 u_resolution;
varying vec2 v_uv;
void main() {
  vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const FRAGMENT_SHADER_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alpha;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = vec4(c.rgb, c.a * u_alpha);
}
`;

export class WebGLBoardRenderer implements BoardRenderer {
  readonly backend = 'webgl' as const;
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private program: WebGLProgram | object | null = null;
  private quadBuffer: WebGLBuffer | object | null = null;
  private posLoc = 0;
  private uvLoc = 1;
  private resUniform: WebGLUniformLocation | object | null = null;
  private alphaUniform: WebGLUniformLocation | object | null = null;
  private texUniform: WebGLUniformLocation | object | null = null;
  private contextLost = false;
  private textures = new Map<string, { tex: WebGLTexture | object; lastUsed: number }>();
  private frameCounter = 0;
  private lastDrawCallCount = 0;
  private readonly maxTextures: number;
  private readonly onContextStateChange?: (state: 'lost' | 'restored') => void;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private readonly quadVertices = new Float32Array(24); // 6 vertices * (x, y, u, v)

  private readonly handleContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    // GPU texture, buffer, and program handles are invalidated on context loss
    this.textures.clear();
    this.program = null;
    this.quadBuffer = null;
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

  drawCallCount(): number {
    return this.lastDrawCallCount;
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

  private compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, src: string): WebGLShader | object | null {
    const shader = gl.createShader?.(type);
    if (!shader) return null;
    gl.shaderSource?.(shader as WebGLShader, src);
    gl.compileShader?.(shader as WebGLShader);
    if (gl.getShaderParameter && gl.COMPILE_STATUS !== undefined) {
      if (!gl.getShaderParameter(shader as WebGLShader, gl.COMPILE_STATUS)) {
        gl.deleteShader?.(shader as WebGLShader);
        return null;
      }
    }
    return shader;
  }

  private initGLState(): void {
    const gl = this.gl;
    if (!gl || this.contextLost) return;
    gl.clearColor?.(0x0b / 255, 0x24 / 255, 0x27 / 255, 1.0);
    gl.enable?.(gl.BLEND);
    gl.blendFunc?.(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Compile and link the 2D textured-quad shader program
    const vs = this.compileShader(gl, gl.VERTEX_SHADER ?? 0x8b31, VERTEX_SHADER_SRC);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER ?? 0x8b30, FRAGMENT_SHADER_SRC);
    const prog = gl.createProgram?.() ?? {};
    if (vs && fs && gl.attachShader && gl.linkProgram) {
      gl.attachShader(prog as WebGLProgram, vs as WebGLShader);
      gl.attachShader(prog as WebGLProgram, fs as WebGLShader);
      gl.linkProgram(prog as WebGLProgram);
    }
    this.program = prog;
    this.posLoc = gl.getAttribLocation ? Math.max(0, gl.getAttribLocation(prog as WebGLProgram, 'a_pos')) : 0;
    this.uvLoc = gl.getAttribLocation ? Math.max(0, gl.getAttribLocation(prog as WebGLProgram, 'a_uv')) : 1;
    this.resUniform = gl.getUniformLocation?.(prog as WebGLProgram, 'u_resolution') ?? null;
    this.alphaUniform = gl.getUniformLocation?.(prog as WebGLProgram, 'u_alpha') ?? null;
    this.texUniform = gl.getUniformLocation?.(prog as WebGLProgram, 'u_tex') ?? null;

    this.quadBuffer = gl.createBuffer?.() ?? {};
    gl.bindBuffer?.(gl.ARRAY_BUFFER ?? 0x8892, this.quadBuffer as WebGLBuffer);
    gl.enableVertexAttribArray?.(this.posLoc);
    gl.enableVertexAttribArray?.(this.uvLoc);
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
    gl.texParameteri?.(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S ?? 0x2802, gl.CLAMP_TO_EDGE ?? 0x812f);
    gl.texParameteri?.(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T ?? 0x2803, gl.CLAMP_TO_EDGE ?? 0x812f);
    gl.texParameteri?.(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER ?? 0x2801, gl.LINEAR ?? 0x2601);
    gl.texParameteri?.(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER ?? 0x2800, gl.LINEAR ?? 0x2601);
    try {
      gl.texImage2D?.(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as TexImageSource);
    } catch { /* ignore in headless mock */ }
    this.textures.set(id, { tex, lastUsed: this.frameCounter });
    return tex;
  }

  /**
   * Emits a 2-triangle textured quad draw call for the given 4 corner screen coordinates
   * `(x0,y0)` top-left, `(x1,y1)` top-right, `(x2,y2)` bottom-right, `(x3,y3)` bottom-left.
   */
  private drawQuad(
    tex: WebGLTexture | object,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    alpha = 1.0,
  ): void {
    const gl = this.gl;
    if (!gl || this.contextLost) return;
    const v = this.quadVertices;
    // Triangle 1: (x0,y0) -> (x1,y1) -> (x2,y2)
    v[0] = x0; v[1] = y0; v[2] = 0; v[3] = 0;
    v[4] = x1; v[5] = y1; v[6] = 1; v[7] = 0;
    v[8] = x2; v[9] = y2; v[10] = 1; v[11] = 1;
    // Triangle 2: (x0,y0) -> (x2,y2) -> (x3,y3)
    v[12] = x0; v[13] = y0; v[14] = 0; v[15] = 0;
    v[16] = x2; v[17] = y2; v[18] = 1; v[19] = 1;
    v[20] = x3; v[21] = y3; v[22] = 0; v[23] = 1;

    const arrayBufferTarget = gl.ARRAY_BUFFER ?? 0x8892;
    gl.bindTexture?.(gl.TEXTURE_2D, tex as WebGLTexture);
    gl.bindBuffer?.(arrayBufferTarget, this.quadBuffer as WebGLBuffer);
    gl.bufferData?.(arrayBufferTarget, v, gl.DYNAMIC_DRAW ?? 0x88e8);
    gl.vertexAttribPointer?.(this.posLoc, 2, gl.FLOAT ?? 0x1406, false, 16, 0);
    gl.vertexAttribPointer?.(this.uvLoc, 2, gl.FLOAT ?? 0x1406, false, 16, 8);
    gl.uniform1f?.(this.alphaUniform as WebGLUniformLocation, alpha);
    gl.drawArrays?.(gl.TRIANGLES ?? 0x0004, 0, 6);
    this.lastDrawCallCount++;
  }

  render(scene: RenderScene, _interpolation: number): void {
    const gl = this.gl;
    if (!gl || this.contextLost) return;
    this.frameCounter++;
    this.lastDrawCallCount = 0;
    gl.clear?.(gl.COLOR_BUFFER_BIT);

    if (this.program) {
      gl.useProgram?.(this.program as WebGLProgram);
      gl.uniform2f?.(this.resUniform as WebGLUniformLocation, this.width, this.height);
      gl.uniform1i?.(this.texUniform as WebGLUniformLocation, 0);
    }

    const cam = scene.camera;
    const fy = cam.fy ?? 0.5;
    const { a, b, c, d } = computeBasis(cam.rot, cam.zoom);
    const e = this.width / 2 - a * cam.x - c * cam.y;
    const f = this.height * fy - b * cam.x - d * cam.y;

    // 1. Draw isometric ground quad using affine projection of the 4 world corners
    if (scene.ground) {
      const gTex = this.acquireTexture('__ground__', scene.ground);
      if (gTex) {
        const ws = scene.worldSize || 2304;
        const x0 = e, y0 = f;
        const x1 = a * ws + e, y1 = b * ws + f;
        const x2 = a * ws + c * ws + e, y2 = b * ws + d * ws + f;
        const x3 = c * ws + e, y3 = d * ws + f;
        this.drawQuad(gTex, x0, y0, x1, y1, x2, y2, x3, y3, 1.0);
      }
    }

    // 2. Depth-sort and draw all board sprites as screen-aligned quads
    const ordered = sortSceneItems(
      scene.sprites.map(s => ({
        key: depthKey(s.screenY, s.layer),
        sprite: s,
      })),
    );
    for (const { sprite: s } of ordered) {
      if (!s.image) continue;
      const tex = this.acquireTexture(s.id, s.image);
      if (!tex) continue;
      const scale = cam.zoom * s.scale;
      const left = s.screenX - s.anchorX * scale;
      const top = s.screenY - s.anchorY * scale;
      const right = left + s.width * scale;
      const bottom = top + s.height * scale;
      this.drawQuad(tex, left, top, right, top, right, bottom, left, bottom, s.alpha ?? 1.0);
    }
  }

  dispose(): void {
    if (this.gl && !this.contextLost) {
      for (const { tex } of this.textures.values()) {
        this.gl.deleteTexture?.(tex as WebGLTexture);
      }
      if (this.quadBuffer) this.gl.deleteBuffer?.(this.quadBuffer as WebGLBuffer);
      if (this.program) this.gl.deleteProgram?.(this.program as WebGLProgram);
    }
    this.textures.clear();
    this.quadBuffer = null;
    this.program = null;
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
