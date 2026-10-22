import { afterEach, expect, it, vi } from 'vitest';
import { SpriteBank, type Frame } from './sprites';

afterEach(() => vi.useRealTimers());

it('retries a known board sprite after a transient network failure without retrying every draw', async () => {
  vi.useFakeTimers();
  const bank = new SpriteBank();
  (bank as any).hd.set('map/0001', { type: 'SPR', frames: [{ file: 'test.webp' }] });
  const frames = [{ img: { width: 4, height: 4 }, w: 4, h: 4, ax: 0, ay: 0, scale: 1 }] as Frame[];
  const load = vi.spyOn(bank as any, 'load').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(frames);
  expect(await bank.boardReady('map', 1)).toBeNull();
  for (let i = 0; i < 20; i++) bank.board('map', 1);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await bank.boardReady('map', 1)).toBe(frames);
});

it('cleans a rejected full-size sprite request so a later request can recover', async () => {
  vi.useFakeTimers();
  const bank = new SpriteBank();
  (bank as any).hd.set('Data/0002', { type: 'SMP', frames: [{ file: 'test.webp' }] });
  const frames = [] as Frame[];
  const load = vi.spyOn(bank as any, 'load').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(frames);
  expect(await bank.ready('Data', 2).catch(() => null)).toBeNull();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await bank.ready('Data', 2)).toBe(frames);
  expect(load).toHaveBeenCalledTimes(2);
});
