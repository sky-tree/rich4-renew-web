/**
 * Pure geometric projection, camera coordinate transforms, and depth sorting for the isometric board (M4-01).
 * Completely decoupled from Canvas 2D and WebGL APIs so both renderers share identical spatial semantics.
 */

export const OBLIQUE_S = 1.2175;
export const OBLIQUE_K = Math.SQRT1_2;
export const BASE_VIEW_SIZE = 440;

export const RenderLayer = {
  markDisc: -1,
  building: 0,
  npc: 8,
  player: 0xc,
  current: 0xd,
  zzz: 0xe,
  highlight: 0xf,
} as const;

export interface BasisMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface CameraState {
  x: number;
  y: number;
  rot: number;
  zoom: number;
  /** Vertical focal fraction of viewport height (default 0.5). */
  fy?: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const screenDir = (dir: number, rot: number): number => (dir + 8 - rot) & 7;
export const buildingFrame = (facing: number, rot: number): number => (8 - facing - rot) & 7;

/** Computes the 2x2 oblique projection basis matrix for rotation `rot` (0..7) and `zoom`. */
export function computeBasis(rot: number, zoom: number): BasisMatrix {
  const th = ((-22.5 + 45 * (rot & 7)) * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  return {
    a: zoom * OBLIQUE_S * cos,
    b: zoom * OBLIQUE_K * OBLIQUE_S * sin,
    c: -zoom * OBLIQUE_S * sin,
    d: zoom * OBLIQUE_K * OBLIQUE_S * cos,
  };
}

/** Projects a world pixel `(x, y)` to CSS canvas coordinates `(sx, sy)`. */
export function projectPoint(
  x: number,
  y: number,
  cam: CameraState,
  view: ViewportSize,
): { x: number; y: number } {
  const { a, b, c, d } = computeBasis(cam.rot, cam.zoom);
  const dx = x - cam.x;
  const dy = y - cam.y;
  const fy = cam.fy ?? 0.5;
  return {
    x: view.width / 2 + a * dx + c * dy,
    y: view.height * fy + b * dx + d * dy,
  };
}

/** Inverse-projects CSS canvas coordinates `(sx, sy)` back to world pixel `(x, y)`. */
export function unprojectPoint(
  sx: number,
  sy: number,
  cam: CameraState,
  view: ViewportSize,
): { x: number; y: number } {
  const { a, b, c, d } = computeBasis(cam.rot, cam.zoom);
  const det = a * d - b * c;
  const fy = cam.fy ?? 0.5;
  const u = sx - view.width / 2;
  const v = sy - view.height * fy;
  return {
    x: cam.x + (d * u - c * v) / det,
    y: cam.y + (-b * u + a * v) / det,
  };
}

/** Computes the deterministic painter's algorithm sort key from screen Y and logical layer. */
export function depthKey(screenY: number, layer: number): number {
  return screenY * 16 + layer;
}

/** Sorts renderables in ascending depth order (back-to-front). */
export function sortSceneItems<T extends { key: number }>(items: T[]): T[] {
  return items.sort((x, y) => x.key - y.key);
}
