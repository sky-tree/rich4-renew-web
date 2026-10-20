/**
 * Screen orientation chosen in the settings: 自動 follows the window, 橫屏 / 豎屏 attempt the standard Web
 * Screen Orientation API where supported (e.g. fullscreen mobile browsers) and set `data-orientation` on `<html>`
 * so responsive CSS remains the primary layout mechanism.
 */

export const ORIENTATIONS = ['自動', '橫屏', '豎屏'];
const KEY = 'rich4.orientation';

export function orientationMode(): number {
  try { const v = Number(localStorage.getItem(KEY) ?? 0); return v === 1 || v === 2 ? v : 0; } catch { return 0; }
}

export async function setOrientation(mode: number): Promise<void> {
  const normalized = mode === 1 || mode === 2 ? mode : 0;
  try { localStorage.setItem(KEY, String(normalized)); } catch { /* not kept */ }
  await applyOrientation(normalized);
}

export async function applyOrientation(mode = orientationMode()): Promise<void> {
  const normalized = mode === 1 || mode === 2 ? mode : 0;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.orientation = normalized === 1 ? 'landscape' : normalized === 2 ? 'portrait' : 'auto';
  }
  try {
    const so = (typeof screen !== 'undefined' ? screen.orientation : undefined) as (ScreenOrientation & {
      lock?: (orientation: 'landscape' | 'portrait') => Promise<void>;
      unlock?: () => void;
    }) | undefined;
    if (!so) return;
    if (normalized === 0) so.unlock?.();
    else await so.lock?.(normalized === 1 ? 'landscape' : 'portrait');
  } catch { /* browsers outside fullscreen or desktop browsers refuse orientation lock */ }
}
