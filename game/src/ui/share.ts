/**
 * Saving and sharing a picture (the results screen's 「儲存到相簿」 / 「分享」).
 * Pure Web implementation: uses canvas.toBlob, Web Share API (when supported), and browser file download.
 */

function blobOf(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('無法產生圖片'))), 'image/png'));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${name}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Saves the picture as a PNG download in the browser. */
export async function saveImage(canvas: HTMLCanvasElement, name: string): Promise<'saved' | 'downloaded'> {
  download(await blobOf(canvas), name);
  return 'downloaded';
}

/** Opens the browser share sheet with the picture; falls back to a download where sharing files is not possible. */
export async function shareImage(canvas: HTMLCanvasElement, name: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await blobOf(canvas);
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { canShare?: (d: ShareData) => boolean }) | undefined;
  if (nav?.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: '大富翁4', text }); return 'shared'; } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  download(blob, name);
  return 'downloaded';
}
