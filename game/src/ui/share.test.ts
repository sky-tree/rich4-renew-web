import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveImage, shareImage } from './share';

function makeMockCanvas(): HTMLCanvasElement {
  return {
    toBlob: (cb: (b: Blob | null) => void, type?: string) => {
      cb(new Blob(['png-bytes'], { type: type ?? 'image/png' }));
    },
  } as unknown as HTMLCanvasElement;
}

describe('Web image save and share', () => {
  let clickedDownload = '';

  beforeEach(() => {
    clickedDownload = '';
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'a') {
          const a = {
            href: '',
            download: '',
            click: () => { clickedDownload = a.download; },
            remove: vi.fn(),
          };
          return a;
        }
        return {};
      }),
      body: { append: vi.fn() },
    });
  });

  it('saveImage triggers a browser file download', async () => {
    const res = await saveImage(makeMockCanvas(), 'result-1');
    expect(res).toBe('downloaded');
    expect(clickedDownload).toBe('result-1.png');
  });

  it('shareImage uses Web Share API when supported and returns shared', async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: shareFn,
    });
    const res = await shareImage(makeMockCanvas(), 'score', '大富翁4 成績');
    expect(res).toBe('shared');
    expect(shareFn).toHaveBeenCalledOnce();
    expect(clickedDownload).toBe('');
  });

  it('shareImage returns cancelled when user aborts Web Share sheet', async () => {
    const abortErr = new Error('User cancelled');
    abortErr.name = 'AbortError';
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: vi.fn().mockRejectedValue(abortErr),
    });
    const res = await shareImage(makeMockCanvas(), 'score', '大富翁4 成績');
    expect(res).toBe('cancelled');
  });

  it('shareImage falls back to download when Web Share API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const res = await shareImage(makeMockCanvas(), 'fallback', '大富翁4 成績');
    expect(res).toBe('downloaded');
    expect(clickedDownload).toBe('fallback.png');
  });
});
