/**
 * Web asset pack manifest schema and dependency resolution (M2).
 * Organizes game assets into logical packs (`shell`, `core`, `map-<id>`, `ground-<id>-<style>`, `optional`)
 * so the browser only downloads what the current screen and selected map require.
 */

export type PackId = 'shell' | 'core' | 'optional' | `map-${number}` | `ground-${number}-${string}`;

export interface AssetPackSummary {
  id: string;
  category: 'shell' | 'core' | 'map' | 'ground' | 'optional';
  fileCount: number;
  bytes: number;
  sha256?: string;
  files?: string[];
}

export interface WebAssetManifest {
  schemaVersion: 1;
  buildId: string;
  generatedAt: string;
  webp: boolean;
  totalFiles: number;
  totalBytes: number;
  categories: Record<'shell' | 'core' | 'map' | 'ground' | 'optional', { fileCount: number; bytes: number }>;
  packs: Record<string, AssetPackSummary>;
}

/** Validates a parsed `web-packs.json` manifest object. */
export function validatePackManifest(raw: unknown): raw is WebAssetManifest {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Partial<WebAssetManifest>;
  if (m.schemaVersion !== 1 || typeof m.buildId !== 'string') return false;
  if (typeof m.totalFiles !== 'number' || typeof m.totalBytes !== 'number') return false;
  if (!m.packs || typeof m.packs !== 'object' || Array.isArray(m.packs)) return false;
  for (const [id, p] of Object.entries(m.packs)) {
    if (!id || !p || typeof p !== 'object') return false;
    if (typeof p.fileCount !== 'number' || p.fileCount < 0) return false;
    if (typeof p.bytes !== 'number' || p.bytes < 0) return false;
  }
  return true;
}

/**
 * Computes the minimal ordered list of asset pack IDs needed for a given game stage:
 * - Title screen (no `mapId`): only `shell`
 * - Entering a map (`mapId` set): `shell`, `core`, `map-<id>`, and (if `groundStyle` is non-empty) `ground-<id>-<style>`
 * - Never includes other maps or unselected ground styles.
 */
export function requiredPacksFor(opts: { mapId?: number; groundStyle?: string; includeOptional?: boolean } = {}): string[] {
  const packs: string[] = ['shell'];
  if (opts.mapId !== undefined) {
    packs.push('core', `map-${opts.mapId}`);
    if (opts.groundStyle) {
      packs.push(`ground-${opts.mapId}-${opts.groundStyle}`);
    }
  }
  if (opts.includeOptional) {
    packs.push('optional');
  }
  return packs;
}
