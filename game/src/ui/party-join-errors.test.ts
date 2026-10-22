import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { Room } from './party-net';

const peers = vi.hoisted(() => [] as any[]);
vi.mock('peerjs', () => ({ default: class extends EventEmitter {
  id = 'join-diagnostic-guest';
  options = {};
  destroy = vi.fn();
  connect = vi.fn(() => {
    const c = new EventEmitter() as any;
    c.open = false; c.send = vi.fn();
    c.close = vi.fn(() => { c.open = false; c.emit('close'); });
    return c;
  });
  constructor() { super(); peers.push(this); }
} }));
afterEach(() => { vi.useRealTimers(); peers.length = 0; });

async function joining() {
  vi.useFakeTimers();
  const room = new Room({ name: 'Guest', character: 1 });
  const outcome = room.join('ABC234').then(() => '', (error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(0);
  const peer = peers[0];
  peer.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  return { room, peer, connection: peer.connect.mock.results[0].value, outcome };
}

it('does not blame missing host acknowledgement when the transport never opens', async () => {
  const { room, outcome } = await joining();
  await vi.advanceTimersByTimeAsync(10100);
  expect(await outcome).toContain('網路連線逾時');
  expect(await outcome).not.toContain('確認加入');
  expect(room.connected()).toBe(false);
});

it('identifies a missing room separately from a connected host that does not acknowledge', async () => {
  const { peer, outcome } = await joining();
  peer.emit('error', { type: 'peer-unavailable' });
  expect(await outcome).toContain('找不到房間');
});

it('preserves the host rejection reason instead of replacing it with a confirmation timeout', async () => {
  const { connection, outcome } = await joining();
  connection.open = true; connection.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  connection.emit('data', { t: 'bye', why: '遊戲已經開始' });
  expect(await outcome).toBe('遊戲已經開始');
});

it('reports acknowledgement timeout only after the transport really opens', async () => {
  const { connection, outcome } = await joining();
  connection.open = true; connection.emit('open');
  await vi.advanceTimersByTimeAsync(8100);
  expect(await outcome).toContain('房主尚未確認加入');
  expect(await outcome).not.toContain('網路連線逾時');
});
