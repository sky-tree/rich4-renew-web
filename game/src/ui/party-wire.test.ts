import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { pack, unpack } from 'peerjs-js-binarypack';
import { Room, validateIncomingMsg } from './party-net';

afterEach(() => { vi.useRealTimers(); });

it('first join survives the actual PeerJS BinaryPack wire format and waits for host membership', async () => {
  vi.useFakeTimers();
  let accepted = false;
  let validation: unknown;
  const connection = new EventEmitter() as EventEmitter & { open: boolean; send: (value: any) => void; close: () => void };
  connection.open = true;
  connection.close = () => connection.emit('close');
  connection.send = async value => {
    const wire = unpack(await pack(value) as ArrayBuffer);
    validation = validateIncomingMsg(wire);
    if ((validation as { ok: boolean }).ok) {
      accepted = true;
      connection.emit('data', { t: 'lobby', members: [{ id: 'guest-test', name: 'Guest', character: 1 }], map: '2', shared: false });
    }
  };
  const room = new Room({ name: 'Guest', character: 1 });
  room.myId = 'guest-test';
  // A fake signaling handle only; packets still cross the real wire codec and
  // real host validator, which pure object-level security tests had missed.
  (room as any).peer = { connect: () => { queueMicrotask(() => connection.emit('open')); return connection; }, on: () => {} };
  const joined = await (room as any).reach();
  expect(validation).toMatchObject({ ok: true });
  expect(accepted).toBe(true);
  expect(joined).toBe(true);
  expect(room.members.map(m => m.id)).toContain('guest-test');
});

it('an open data channel without host acknowledgement does not count as joining', async () => {
  vi.useFakeTimers();
  const connection = new EventEmitter() as any;
  connection.open = true; connection.send = () => {}; connection.close = vi.fn();
  const room = new Room({ name: 'Guest', character: 1 });
  (room as any).peer = { connect: () => { queueMicrotask(() => connection.emit('open')); return connection; }, on: () => {} };
  const joining = (room as any).reach();
  await vi.advanceTimersByTimeAsync(8100);
  expect(await joining).toBe(false);
  expect(room.connected()).toBe(false);
  expect(connection.close).toHaveBeenCalled();
});
