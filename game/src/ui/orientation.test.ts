import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOrientation, orientationMode, setOrientation } from './orientation';

describe('Web screen orientation', () => {
  const storage = new Map<string, string>();
  let dataset: Record<string, string> = {};

  beforeEach(() => {
    storage.clear();
    dataset = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
    });
    vi.stubGlobal('document', {
      documentElement: { dataset },
    });
  });

  it('persists orientation mode and updates documentElement.dataset.orientation', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    vi.stubGlobal('screen', { orientation: { lock, unlock } });

    expect(orientationMode()).toBe(0);
    await setOrientation(1);
    expect(orientationMode()).toBe(1);
    expect(dataset.orientation).toBe('landscape');
    expect(lock).toHaveBeenCalledWith('landscape');

    await setOrientation(2);
    expect(orientationMode()).toBe(2);
    expect(dataset.orientation).toBe('portrait');
    expect(lock).toHaveBeenCalledWith('portrait');

    await setOrientation(0);
    expect(orientationMode()).toBe(0);
    expect(dataset.orientation).toBe('auto');
    expect(unlock).toHaveBeenCalledOnce();
  });

  it('gracefully ignores browser rejection when locking outside fullscreen', async () => {
    vi.stubGlobal('screen', {
      orientation: {
        lock: vi.fn().mockRejectedValue(new Error('NotSupportedError')),
      },
    });
    await expect(applyOrientation(1)).resolves.toBeUndefined();
    expect(dataset.orientation).toBe('landscape');
  });
});
