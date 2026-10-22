import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { Lobby } from './party-net';

const peers = vi.hoisted(() => [] as any[]);
vi.mock('peerjs', () => ({ default: class extends EventEmitter {
  id = 'test-peer';
  options = {};
  destroy = vi.fn();
  connect = vi.fn(() => {
    const c = new EventEmitter() as any;
    c.open = false; c.close = vi.fn(); c.send = vi.fn();
    return c;
  });
  constructor() { super(); peers.push(this); }
} }));
afterEach(() => { vi.useRealTimers(); peers.length = 0; });

it('destroys a peer that finishes opening after its lobby has closed', async () => {
  vi.useFakeTimers();
  const lobby = new Lobby();
  await lobby.start();
  await vi.advanceTimersByTimeAsync(0);
  const peer = peers[0];
  lobby.close();
  peer.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  expect(peer.destroy).toHaveBeenCalled();
  expect(peer.connect).not.toHaveBeenCalled();
});

it('closes a late connection instead of retaining it after leaving the lobby', async () => {
  vi.useFakeTimers();
  const lobby = new Lobby();
  await lobby.start();
  await vi.advanceTimersByTimeAsync(0);
  const peer = peers[0];
  peer.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  const c = peer.connect.mock.results[0].value;
  lobby.close();
  c.open = true; c.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  expect(c.close).toHaveBeenCalled();
  expect((lobby as any).toHolder).toBeNull();
});

it('destroys a late lobby-holder peer instead of claiming the shared ID after leaving', async () => {
  vi.useFakeTimers();
  const lobby = new Lobby();
  await lobby.start();
  await vi.advanceTimersByTimeAsync(0);
  const peer = peers[0];
  peer.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  peer.connect.mock.results[0].value.emit('error', new Error('unavailable'));
  await vi.advanceTimersByTimeAsync(0);
  const holder = peers[1];
  lobby.close();
  holder.emit('open');
  await vi.advanceTimersByTimeAsync(0);
  expect(holder.destroy).toHaveBeenCalled();
  expect((lobby as any).holder).toBeNull();
});
