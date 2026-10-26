import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pack, unpack } from 'peerjs-js-binarypack';
import { Room, validateIncomingMsg } from './party-net';
import { partyVersion, PARTY_PROTOCOL_VERSION, PARTY_RULES_VERSION } from './party-version';

afterEach(() => vi.useRealTimers());
const connection = () => {
  const c = Object.assign(new EventEmitter(), { peer: 'guest-test', open: true, send: vi.fn(), close: () => {} });
  c.close = () => { c.open = false; c.emit('close'); };
  return c;
};

const incompatible = [
  {}, { proto: PARTY_PROTOCOL_VERSION }, { rules: PARTY_RULES_VERSION },
  { ...partyVersion(), proto: 1 }, { ...partyVersion(), rules: 'upstream-v0.7.8-lru' },
];

describe('Web party compatibility at both ends of the wire', () => {
  it('accepts equal protocol and rules independently of application release labels', async () => {
    const hi = { t: 'hi', ...partyVersion(), name: 'Guest', character: 1, app: 'another-ui-patch' };
    expect(validateIncomingMsg(unpack(await pack(hi) as ArrayBuffer)).ok).toBe(true);
    for (const version of incompatible) {
      for (const msg of [
        { t: 'hi', ...version, name: 'Guest', character: 1 },
        { t: 'lobby', ...version, members: [], map: '2', shared: false },
        { t: 'start', start: { ...version, settings: {}, seats: {} } },
        { t: 'log', ...version, from: 0, answers: [], total: 0 },
      ]) expect(validateIncomingMsg(msg).ok, JSON.stringify(msg)).toBe(false);
    }
  });

  it.each(incompatible)('host refuses incompatible joins before registering a seat: %j', version => {
    const host = new Room({ name: 'Host', character: 0 });
    host.host = true;
    const c = connection();
    (host as any).guest(c);
    c.emit('data', { t: 'hi', ...version, name: 'Guest', character: 1 });
    expect(host.members).toEqual([]);
    expect(c.send).toHaveBeenCalledWith(expect.objectContaining({ t: 'bye', incompatible: true }));
    // No later packet on a refused channel can register it after all.
    c.emit('data', { t: 'hi', ...partyVersion(), name: 'Guest', character: 1 });
    expect(host.members).toEqual([]);
    c.close(); host.close();
  });

  it.each(['lobby', 'log'] as const)('guest refuses a legacy host %s before accepting membership or replay', async type => {
    vi.useFakeTimers();
    const guest = new Room({ name: 'Guest', character: 1 });
    guest.myId = 'guest-test';
    guest.started = type === 'log' ? { settings: {} as any, seats: { 'guest-test': 1 } } : null;
    const c = connection();
    c.send.mockImplementation(msg => {
      if (msg.t !== 'hi') return;
      c.emit('data', type === 'lobby'
        ? { t: 'lobby', members: [{ id: 'guest-test', name: 'Guest', character: 1 }], map: '2', shared: false }
        : { t: 'log', from: 0, answers: [[{ dice: 3 }, false]], total: 1 });
    });
    (guest as any).peer = Object.assign(new EventEmitter(), {
      connect() { queueMicrotask(() => c.emit('open')); return c; }, destroy() {},
    });
    guest.onStatus = vi.fn();
    expect(await (guest as any).reach()).toBe(false);
    expect(guest.refused).toBe(true);
    expect(guest.members).toEqual([]);
    expect((guest as any).log).toEqual([]);
    expect(guest.onStatus).toHaveBeenCalledWith(expect.stringContaining('版本'));
    await vi.advanceTimersByTimeAsync(20000);
    expect((guest as any).rejoining).toBe(false);
  });

  it('checks start again and stamps host start with the current compatibility pair', () => {
    const guest = new Room({ name: 'Guest', character: 1 });
    guest.onStart = vi.fn();
    (guest as any).fromHost({ t: 'start', start: { ...partyVersion(), rules: 'lru', settings: {}, seats: {} } });
    expect(guest.onStart).not.toHaveBeenCalled();
    expect(guest.started).toBeNull();
    expect(guest.refused).toBe(true);
    const host = new Room({ name: 'Host', character: 0 });
    host.onStart = vi.fn();
    host.start({ settings: {} as any, seats: {} });
    expect(host.onStart).toHaveBeenCalledWith(expect.objectContaining(partyVersion()));
  });

  it('treats a legacy host version refusal as terminal during a handover', () => {
    const guest = new Room({ name: 'Guest', character: 1 });
    guest.started = { settings: {} as any, seats: { 'guest-test': 1 } };
    guest.onStatus = vi.fn();
    (guest as any).fromHost({ t: 'bye', why: '遊戲版本不一致，請重新整理網頁更新後再連線' });
    expect(guest.refused).toBe(true);
    expect((guest as any).closed).toBe(true);
    expect(guest.onStatus).toHaveBeenCalledWith(expect.stringContaining('版本'));
  });

  it('a delayed old channel cannot replace the membership accepted on a newer connection', async () => {
    vi.useFakeTimers();
    const guest = new Room({ name: 'Guest', character: 1 });
    guest.myId = 'guest-test';
    const old = connection(), current = connection();
    const channels = [old, current];
    (guest as any).peer = Object.assign(new EventEmitter(), {
      connect() { const c = channels.shift()!; queueMicrotask(() => c.emit('open')); return c; }, destroy() {},
    });
    const first = (guest as any).reach();
    await vi.advanceTimersByTimeAsync(0);
    const second = (guest as any).reach();
    await vi.advanceTimersByTimeAsync(0);
    const lobby = { t: 'lobby', ...partyVersion(), members: [{ id: 'guest-test', name: 'Guest', character: 1 }], shared: false };
    current.emit('data', { ...lobby, map: '2' });
    expect(await second).toBe(true);
    old.emit('data', { ...lobby, map: '9' });
    await vi.advanceTimersByTimeAsync(8100);
    expect(await first).toBe(false);
    expect(guest.map).toBe('2');
    expect(guest.connected()).toBe(true);
    guest.close();
  });
});
