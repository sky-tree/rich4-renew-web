import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { commitReconnectToken, PARTY_PROTOCOL_VERSION, PARTY_RULES_VERSION, Room } from './party-net';

it('same-peer reconnect retains its seat and can answer the next lockstep question', async () => {
  const token = 'test-only-reconnect-token-32-characters';
  const host = new Room({ name: 'Host', character: 0 });
  host.host = true; host.myId = 'host-test';
  host.members = [{ id: 'host-test', name: 'Host', character: 0 },
    { id: 'guest-test', name: 'Guest', character: 1, tokenCommit: commitReconnectToken(token), away: true }];
  host.started = { settings: {} as any, seats: { 'host-test': 0, 'guest-test': 1 } };
  const connection = new EventEmitter() as any;
  connection.peer = 'guest-test'; connection.open = true; connection.send = () => {};
  (host as any).guest(connection);
  connection.emit('data', { t: 'hi', proto: PARTY_PROTOCOL_VERSION, rules: PARTY_RULES_VERSION, name: 'Guest', character: 1, prev: 'guest-test',
    reconnectToken: token, tokenCommit: commitReconnectToken('next-test-only-reconnect-token-32'), have: 0 });
  expect(host.started.seats['guest-test']).toBe(1);
  host.expectQuestionSeat(0, 1);
  connection.emit('data', { t: 'ans', seq: 0, seat: 1, v: 0, u: false });
  expect(await host.wait(0)).toBe(0);
  expect(host.ownerConnected(1)).toBe(true);
});

it('a changed peer id moves the old seat without retaining the obsolete mapping', () => {
  const room = new Room({ name: 'Host', character: 0 });
  room.started = { settings: {} as any, seats: { 'guest-old': 1 } };
  (room as any).rename('guest-old', 'guest-new');
  expect(room.started.seats).toEqual({ 'guest-new': 1 });
});
