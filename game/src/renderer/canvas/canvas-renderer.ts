/**
 * Canvas 2D implementation of BoardRenderer (M4-02).
 * Serves as the primary baseline and automatic fallback when WebGL is disabled or lost.
 */
import { computeBasis, depthKey, sortSceneItems } from '../scene/projection';
import type { BoardRenderer, RenderScene } from '../types';

export class CanvasBoardRenderer implements BoardRenderer {
  readonly backend = 'canvas' as const;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;

  async mount(target: HTMLElement): Promise<void> {
    const c = document.createElement('canvas');
    c.className = 'board-renderer canvas-backend';
    target.append(c);
    this.canvas = c;
    this.ctx = c.getContext('2d', { alpha: false });
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(2, Math.max(1, dpr));
    if (this.canvas) {
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
    }
  }

  render(scene: RenderScene, _interpolation: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b2427';
    ctx.fillRect(0, 0, this.width, this.height);

    const { camera, ground, worldSize, sprites } = scene;
    const fy = camera.fy ?? 0.5;
    if (ground) {
      const { a, b, c, d } = computeBasis(camera.rot, camera.zoom);
      const e = this.width / 2 - a * camera.x - c * camera.y;
      const f = this.height * fy - b * camera.x - d * camera.y;
      ctx.setTransform(a * this.dpr, b * this.dpr, c * this.dpr, d * this.dpr, e * this.dpr, f * this.dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(ground, 0, 0, worldSize, worldSize);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    const ordered = sortSceneItems(
      sprites.map(s => ({
        key: depthKey(s.screenY, s.layer),
        sprite: s,
      })),
    );

    const z = camera.zoom;
    for (const { sprite: s } of ordered) {
      if (!s.image) continue;
      const k = z * s.scale;
      const x = s.screenX - s.anchorX * k;
      const y = s.screenY - s.anchorY * k;
      const w = s.width * k;
      const h = s.height * k;
      if (s.alpha !== undefined && s.alpha < 1) {
        ctx.save();
        ctx.globalAlpha = s.alpha;
        ctx.drawImage(s.image, x, y, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(s.image, x, y, w, h);
      }
    }
  }

  dispose(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }
}
