/** Loads the locally linked game data and art (see scripts/link-assets.mjs). */
import { defaultAssetLoader } from '../assets/loader';
import { resolveCdnAssetUrl } from '../assets/offline-pwa';
import { parseBoard, type Board, type RawMap } from '../core/board';

export const ASSETS = `${import.meta.env.BASE_URL}assets`;

/**
 * Resolves an asset path through the optional CDN base (if configured) or against the document base URI
 * when running in the browser, preventing relative `url(...)` inside CSS custom properties from resolving
 * against bundled `assets/*.css`.
 */
export function absAssetUrl(src: string): string {
  const cdnResolved = resolveCdnAssetUrl(src);
  if (/^https?:\/\//i.test(cdnResolved)) return cdnResolved;
  try {
    if (typeof document !== 'undefined' && document.baseURI) return new URL(cdnResolved, document.baseURI).href;
  } catch { /* fallback */ }
  return cdnResolved;
}

/**
 * Returns the core URLs (map JSON, background image, and thumbnail) for a single map's opt-in offline cache pack (M6-02).
 */
export function mapOfflineUrls(entry: MapInfo): string[] {
  const base = entry.id >= 1000 ? `${ASSETS}/maps/custom/${entry.id}` : `${ASSETS}/maps/map-${entry.id}`;
  const dataUrl = entry.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`;
  const imageUrl = entry.image ? `${ASSETS}/maps/${entry.image}` : `${base}.png`;
  return [entry.thumbnail, dataUrl, imageUrl].filter(Boolean);
}

/**
 * A map of the list. `kind`: 'orig' the eight original maps (map-N.json), 'custom' the 自製地圖: the remake's own maps
 * (maps/remake/index.json: 東京, 大阪, 札幌, 九州, 沖繩, 大富翁城, with their own `data` / `image` paths). The old
 * workshop maps (editor/export_custom.py, maps/custom/index.json) are no longer offered (2026-10-17): they are listed
 * `hidden`, known only so saved games on them still load and show their name. `hidden`: not offered for a new game.
 */
export interface MapInfo { id: number; name: string; thumbnail: string; custom: boolean; kind: 'orig' | 'custom'; data?: string; image?: string; hidden?: boolean }

const images = new Map<string, Promise<HTMLImageElement>>();
export function image(rawUrl: string): Promise<HTMLImageElement> {
  const url = resolveCdnAssetUrl(rawUrl);
  let p = images.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(url);
        reject(new Error(`無法載入素材 ${url}`));
      };
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

export function __clearImageCacheForTest(): void {
  images.clear();
}

async function json<T>(url: string): Promise<T> {
  return defaultAssetLoader.fetchJson<T>(url);
}

export async function mapList(): Promise<MapInfo[]> {
  const m = await json<{ maps: { id: number; name: string; thumbnail: string }[] }>(`${ASSETS}/maps/maps.json`);
  const list: MapInfo[] = m.maps.map(x => ({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: false, kind: 'orig' }));
  // The remake's own maps (ids 8..999) are the 自製地圖 list (their `replaces` named the workshop map whose slot they took).
  try {
    const r = await json<{ maps: { id: number; name: string; thumbnail: string; data: string; image: string; replaces?: number[]; hidden?: boolean }[] }>(`${ASSETS}/maps/remake/index.json`);
    for (const x of r.maps) {
      // `hidden`: a map only 大富豪模式 uses (大富翁城, its finale, docs/rules/19) is known but not offered.
      list.push({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: true, kind: 'custom', data: x.data, image: x.image, ...(x.hidden ? { hidden: true } : {}) });
    }
  } catch { /* none installed */ }
  // Maps made in the workshop (editor/export_custom.py, ids from 1000): never offered any more, the 自製地圖 are the
  // remake's six; kept hidden so saved games on them still load (where their files are installed).
  try {
    const c = await json<{ maps: { id: number; name: string; thumbnail: string }[] }>(`${ASSETS}/maps/custom/index.json`);
    for (const x of c.maps) list.push({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: true, kind: 'custom', hidden: true });
  } catch { /* no custom maps exported */ }
  known = list;
  return list;
}

let known: MapInfo[] = [];

/** Sprites a map brings along (08 §3.4: landscapes whose resource the original archives do not have). */
export type MapSprites = Record<string, { dir: string; frames: { file: string; width: number; height: number; anchor_x: number; anchor_y: number }[] }>;

export interface MapArt {
  board: Board;
  /** The 2304×2304 top-down ground texture; the view projects it obliquely. */
  ground: HTMLImageElement;
  /** Extra sprites by "archive/NNNN", frames at 4× like the HD redraws (paths relative to maps/). */
  sprites: MapSprites;
  /**
   * Decorations: plants and the like that only dress the ground (no rules, not map records), each a map sprite
   * whose frames are the seasons (spring, summer, autumn, winter; fewer frames: the last one stands in).
   */
  decor: MapDecor[];
  /** Draw a notch across both road edges halfway between squares (the remake's own maps), whatever the ground style. */
  stepMarks: boolean;
  /** Sidewalk paths of the decorative passers-by, each a list of [x, y] map points (歌舞伎町, docs/rules/21 §8.1). */
  walkers?: [number, number][][];
}

export interface MapDecor { x: number; y: number; res: number }

export async function loadMap(id: number): Promise<MapArt> {
  let entry = known.find(m => m.id === id);
  if (!entry && id >= 8 && id < 1000) { await mapList().catch(() => []); entry = known.find(m => m.id === id); }
  const base = id >= 1000 ? `${ASSETS}/maps/custom/${id}` : `${ASSETS}/maps/map-${id}`;
  const data = entry?.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`;
  const pic = entry?.image ? `${ASSETS}/maps/${entry.image}` : `${base}.png`;
  const raw = await json<RawMap & { sprites?: MapSprites; decorations?: MapDecor[]; step_marks?: boolean; walkers?: [number, number][][] }>(data);
  return { board: parseBoard(raw), ground: await image(pic), sprites: raw.sprites ?? {}, decor: raw.decorations ?? [], stepMarks: !!raw.step_marks,
    ...(raw.walkers?.length ? { walkers: raw.walkers } : {}) };
}

/**
 * Only a map's records (no ground picture): 大富豪模式 builds all five cities' rules from these and loads the art
 * of the city on screen only (docs/rules/17 §12). Includes the JSON's optional `tycoon` overlay.
 */
export async function loadMapData(id: number): Promise<RawMap & { tycoon?: unknown }> {
  let entry = known.find(m => m.id === id);
  if (!entry && id >= 8 && id < 1000) { await mapList().catch(() => []); entry = known.find(m => m.id === id); }
  const base = id >= 1000 ? `${ASSETS}/maps/custom/${id}` : `${ASSETS}/maps/map-${id}`;
  return json(entry?.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`);
}

/** HD portrait for a character (Data.mkf #2, aligned 4x), supporting both PNG and WebP bundles before falling back to original. */
export async function portrait(character: number): Promise<HTMLImageElement> {
  const n = String(character).padStart(3, '0');
  try { return await image(`${ASSETS}/hd/Data/0002-SMP/frame-${n}.png`); }
  catch {
    try { return await image(`${ASSETS}/hd/Data/0002-SMP/frame-${n}.webp`); }
    catch { return image(`${ASSETS}/orig/Data/0002-SMP/frame-${n}.png`); }
  }
}
