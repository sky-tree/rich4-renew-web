import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { Room } from './party-net';

it('a guest waits for the host answer instead of advancing on an unacknowledged local answer', async () => {
  const guest = new Room({ name: 'Guest', character: 1 });
  guest.myId = 'guest-test';
  guest.started = { settings: {} as any, seats: { 'host-test': 0, 'guest-test': 1 } };
  (guest as any).toHost = { send() {}, open: true };
  const pending = guest.answer(0, { dice: 2 }, 1);
  expect((guest as any).log).toHaveLength(0);
  let completed = false;
  void Promise.resolve(pending).then(() => { completed = true; });
  await Promise.resolve();
  expect(completed).toBe(false);
  // During the outage the host took over this seat. Its answer wins on recovery.
  (guest as any).fromHost({ t: 'log', from: 0, answers: [[{ action: 'autopilot' }, false]], total: 1 });
  expect(await pending).toEqual({ action: 'autopilot' });
  expect(await guest.wait(0)).toEqual({ action: 'autopilot' });
});

it('all observers of the same answer resolve, including a UI race and the send acknowledgement', async () => {
  const guest = new Room({ name: 'Guest', character: 1 });
  let first = false, second = false;
  void guest.wait(4).then(() => { first = true; });
  void guest.wait(4).then(() => { second = true; });
  (guest as any).fromHost({ t: 'ans', seq: 4, v: 3, u: false });
  await Promise.resolve();
  expect([first, second]).toEqual([true, true]);
});

it('resends an unacknowledged guest action after replay and accepts only the host echo', async () => {
  const guest = new Room({ name: 'Guest', character: 1 });
  const send = vi.fn();
  guest.myId = 'guest-test';
  (guest as any).toHost = { send, open: true };
  const pending = guest.answer(0, 2, 1);
  expect(send).toHaveBeenCalledTimes(1);
  (guest as any).fromHost({ t: 'log', from: 0, answers: [], total: 0 });
  expect(send).toHaveBeenCalledTimes(2);
  expect((guest as any).log).toHaveLength(0);
  (guest as any).fromHost({ t: 'ans', seq: 0, v: 2, u: false });
  expect(await pending).toBe(2);
  (guest as any).fromHost({ t: 'log', from: 1, answers: [], total: 1 });
  expect(send).toHaveBeenCalledTimes(2);
});

it('a repeated guest packet gets the already committed host answer when its previous acknowledgement was lost', async () => {
  const host = new Room({ name: 'Host', character: 0 });
  host.host = true;
  host.members = [{ id: 'guest-test', name: 'Guest', character: 1 }];
  await host.answer(0, { action: 'autopilot' }, 1);
  const c = new EventEmitter() as any;
  c.peer = 'guest-test'; c.open = true; c.send = vi.fn();
  c.close = () => { c.open = false; c.emit('close'); };
  (host as any).guest(c);
  c.emit('data', { t: 'ans', seq: 0, seat: 1, v: { dice: 2 }, u: false });
  expect(c.send).toHaveBeenCalledWith({ t: 'ans', seq: 0, v: { action: 'autopilot' }, u: false });
  expect(await host.wait(0)).toEqual({ action: 'autopilot' });
  c.close();
});

it('a host still retiring an old channel can ask the guest to retry without closing the room', () => {
  const guest = new Room({ name: 'Guest', character: 1 });
  const close = vi.fn();
  (guest as any).toHost = { close };
  (guest as any).fromHost({ t: 'bye', why: 'old connection still active', retry: true });
  expect(close).toHaveBeenCalledOnce();
  expect((guest as any).closed).toBe(false);
});
