import { expect, it, vi } from 'vitest';
import { Room } from './party-net';

it('compares a host digest arriving after the guest turn instead of silently accepting it', () => {
  const room = new Room({ name: 'Guest', character: 1 });
  const mismatch = vi.fn();
  room.onDesync = mismatch;
  expect(room.digest(7, 123)).toBe(true);
  // Deliver via the same handler as real, validated host packets.
  (room as any).fromHost({ t: 'digest', seq: 7, h: 456 });
  expect(mismatch).toHaveBeenCalledExactlyOnceWith(7);
});

it('matches digest packets to their sequence in either arrival order, including hash zero', () => {
  const room = new Room({ name: 'Guest', character: 1 });
  const mismatch = vi.fn();
  room.onDesync = mismatch;
  expect(room.digest(10, 0)).toBe(true);
  expect(room.digest(11, 123)).toBe(true);
  (room as any).fromHost({ t: 'digest', seq: 11, h: 123 });
  (room as any).fromHost({ t: 'digest', seq: 10, h: 0 });
  (room as any).fromHost({ t: 'digest', seq: 12, h: 42 });
  expect(room.digest(12, 42)).toBe(true);
  (room as any).fromHost({ t: 'digest', seq: 13, h: 42 });
  expect(room.digest(13, 43)).toBe(false);
  expect(mismatch).not.toHaveBeenCalled();
});
