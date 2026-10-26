import { afterEach, describe, expect, it } from 'vitest';
import { stickerSrc } from './party-chat';
import {
  authorizeSeatAnswer,
  commitReconnectToken,
  confirmReconnectHandshake,
  createReconnectTokenState,
  generateReconnectToken,
  generateRoomCode,
  ICE_SERVERS,
  PARTY_PROTOCOL_VERSION,
  PARTY_RULES_VERSION,
  prepareReconnectHandshake,
  resolvePartyNetConfig,
  setPartyNetConfig,
  validateIncomingMsg,
  verifyReconnectClaim,
  type Member,
} from './party-net';

describe('Party networking security, credential isolation and protocol validation (M5 & P0/P1 fixes)', () => {
  afterEach(() => {
    setPartyNetConfig(null);
  });

  it('contains no hardcoded TURN credentials in default ICE_SERVERS (M5-01)', () => {
    const json = JSON.stringify(ICE_SERVERS);
    expect(json).not.toContain('credential');
    expect(json).not.toContain('username');
    expect(json).not.toContain('29e57ad82edb53b7f8dde103');
    expect(ICE_SERVERS.length).toBeGreaterThan(0);
  });

  it('allows overriding PeerServer and ephemeral TURN servers at runtime (M5-02)', () => {
    setPartyNetConfig({
      peerServer: { host: 'signal.example.com', port: 443, path: '/peer', secure: true },
      iceServers: [{ urls: 'turn:turn.example.com:3478', username: 'ephemeral', credential: 'short-token' }],
    });
    const cfg = resolvePartyNetConfig();
    expect(cfg.peerServer?.host).toBe('signal.example.com');
    expect(cfg.iceServers[0].username).toBe('ephemeral');
  });

  it('validates protocol version, message size, sequence bounds and payload structure (M5-03)', () => {
    expect(validateIncomingMsg(null)).toEqual({ ok: false, reason: 'invalid-object' });
    expect(validateIncomingMsg({ t: 'hi', name: 'A', character: 0, proto: PARTY_PROTOCOL_VERSION, rules: PARTY_RULES_VERSION }).ok).toBe(true);
    expect(validateIncomingMsg({ t: 'hi', name: 'A', character: 0, proto: PARTY_PROTOCOL_VERSION + 1 })).toEqual({
      ok: false,
      reason: 'version-mismatch',
    });
    expect(validateIncomingMsg({ t: 'ans', seq: -1, v: 0 })).toEqual({ ok: false, reason: 'invalid-seq' });
    expect(validateIncomingMsg({ t: 'ans', seq: 999999, v: 0 })).toEqual({ ok: false, reason: 'invalid-seq' });
    expect(
      validateIncomingMsg({ t: 'chat', line: { from: 'peer_1', name: '阿土伯', character: 0, text: 'hello', at: 1 } }).ok,
    ).toBe(true);
    expect(
      validateIncomingMsg({ t: 'chat', line: { from: 'peer_1', name: '阿土伯', character: 0, text: 'x'.repeat(200) } }, 64),
    ).toEqual({
      ok: false,
      reason: 'message-too-large',
    });
  });

  it('blocks DOM XSS payloads in chat character, sticker, and sender fields (P0-1)', () => {
    // String or HTML attribute injection in `line.character` must be rejected
    expect(
      validateIncomingMsg({
        t: 'chat',
        line: { from: 'p1', name: 'H', character: '1" onerror="alert(1)', text: '[s:good]' },
      }),
    ).toEqual({ ok: false, reason: 'invalid-chat-character' });

    // Out-of-range or float character must be rejected
    expect(
      validateIncomingMsg({
        t: 'chat',
        line: { from: 'p1', name: 'H', character: 99, text: '[s:good]' },
      }),
    ).toEqual({ ok: false, reason: 'invalid-chat-character' });

    // Arbitrary sticker key injection must be rejected
    expect(
      validateIncomingMsg({
        t: 'chat',
        line: { from: 'p1', name: 'H', character: 2, text: '[s:evil"onerror="alert(1)]' },
      }),
    ).toEqual({ ok: false, reason: 'invalid-chat-sticker' });

    expect(
      validateIncomingMsg({
        t: 'chat',
        line: { from: 'p1', name: 'H', character: 2, text: '[s:nonexistent]' },
      }),
    ).toEqual({ ok: false, reason: 'invalid-chat-sticker' });

    // Valid whitelisted sticker passes and strips any extra properties
    const validSticker = validateIncomingMsg({
      t: 'chat',
      line: { from: 'peer-1', name: '<img src=x>', character: 3, text: '[s:good]', extraField: 'malicious' },
    });
    expect(validSticker.ok).toBe(true);
    if (validSticker.ok && validSticker.msg.t === 'chat') {
      expect(validSticker.msg.line.character).toBe(3);
      expect(validSticker.msg.line.name).not.toContain('<');
      expect('extraField' in validSticker.msg.line).toBe(false);
    }

    // `stickerSrc` clamps invalid inputs to safe integer & whitelisted key
    expect(stickerSrc(('1" onerror="alert(1)' as unknown) as number, 'evil"')).toMatch(
      /\/sticker-0-good\.webp$/,
    );
  });

  it('prevents reconnect identity spoofing via SHA-256 Commit-Reveal token verification (P0-2)', () => {
    const aliceSecret = generateReconnectToken();
    const aliceCommit = commitReconnectToken(aliceSecret);
    expect(aliceCommit).toMatch(/^[0-9a-f]{64}$/);

    const members: Member[] = [
      { id: 'peer-alice', name: '孫小美', character: 9, tokenCommit: aliceCommit },
    ];

    // 1. Attacker knows Alice's peer ID (`peer-alice`) and claims `prev: 'peer-alice'` without token
    expect(verifyReconnectClaim(members, 'peer-alice', undefined, false)).toEqual({
      ok: false,
      reason: 'missing-reconnect-token',
    });

    // 2. Attacker supplies a forged reconnect token or passes the public `tokenCommit` itself as the secret
    expect(verifyReconnectClaim(members, 'peer-alice', aliceCommit, false)).toEqual({
      ok: false,
      reason: 'invalid-reconnect-token',
    });

    // 3. Attacker attempts to hijack while Alice's original connection is still open
    expect(verifyReconnectClaim(members, 'peer-alice', aliceSecret, true)).toEqual({
      ok: false,
      reason: 'peer-still-active',
    });

    // 4. Legitimate Alice reconnects after drop with the true preimage `aliceSecret`
    const ok = verifyReconnectClaim(members, 'peer-alice', aliceSecret, false);
    expect(ok.ok).toBe(true);
  });

  it('preserves confirmed reconnect token across dropped reconnect attempts until host ack (P1-02)', () => {
    const state = createReconnectTokenState();
    const initialSecret = state.confirmedToken;

    // 1. First join (`peer-alice-1`)
    const hs1 = prepareReconnectHandshake(state, 'peer-alice-1');
    expect(hs1.prev).toBeUndefined();
    expect(hs1.reconnectToken).toBeUndefined();
    expect(hs1.tokenCommit).toBe(commitReconnectToken(initialSecret));
    expect(confirmReconnectHandshake(state, 'peer-alice-1', hs1.tokenCommit)).toBe(true);
    expect(state.confirmedPeerId).toBe('peer-alice-1');

    const members: Member[] = [
      { id: 'peer-alice-1', name: '孫小美', character: 9, tokenCommit: hs1.tokenCommit },
    ];

    // 2. First reconnect attempt (`peer-alice-2`) — message drops before reaching host!
    const hsDrop = prepareReconnectHandshake(state, 'peer-alice-2');
    expect(hsDrop.prev).toBe('peer-alice-1');
    expect(hsDrop.reconnectToken).toBe(initialSecret);
    expect(hsDrop.tokenCommit).not.toBe(hs1.tokenCommit);
    // Crucial: `state.confirmedToken` has NOT been rotated yet because host never acked `peer-alice-2`
    expect(state.confirmedToken).toBe(initialSecret);

    // 3. Second reconnect attempt (`peer-alice-3`) after connection drop
    const hsRetry = prepareReconnectHandshake(state, 'peer-alice-3');
    expect(hsRetry.prev).toBe('peer-alice-1');
    expect(hsRetry.reconnectToken).toBe(initialSecret);
    // Host still has `hs1.tokenCommit` and successfully verifies `hsRetry.reconnectToken`!
    const hostVerified = verifyReconnectClaim(members, hsRetry.prev!, hsRetry.reconnectToken, false);
    expect(hostVerified.ok).toBe(true);

    // Host updates member to `peer-alice-3` with `hsRetry.tokenCommit` and sends `lobby` ack
    members[0].id = 'peer-alice-3';
    members[0].tokenCommit = hsRetry.tokenCommit;
    expect(confirmReconnectHandshake(state, 'peer-alice-3', hsRetry.tokenCommit)).toBe(true);
    expect(state.confirmedPeerId).toBe('peer-alice-3');
    expect(state.confirmedToken).not.toBe(initialSecret);

    // Old token can no longer be replayed against the updated host commitment
    expect(verifyReconnectClaim(members, 'peer-alice-3', initialSecret, false)).toEqual({
      ok: false,
      reason: 'invalid-reconnect-token',
    });
  });

  it('enforces seat ownership AND rejects unopened future question sequences (P0-2 & P1-01)', () => {
    const seats: Record<string, number> = {
      'peer-host': 0,
      'peer-alice': 1,
      'peer-bob': 2,
    };
    const kickedSeats = new Set<number>();
    const expectedSeats = new Map<number, number>([[5, 1]]); // Question seq=5 belongs to seat 1 (Alice)

    // P1-01: Any attempt to pre-inject an answer for an unopened future question (e.g. seq=6 or seq=10) must be rejected
    expect(authorizeSeatAnswer(seats, kickedSeats, expectedSeats, 'peer-alice', 6, 1)).toEqual({
      ok: false,
      reason: 'unopened-question-seq',
    });
    expect(authorizeSeatAnswer(seats, kickedSeats, expectedSeats, 'peer-bob', 6, 2)).toEqual({
      ok: false,
      reason: 'unopened-question-seq',
    });

    // Bob (seat 2) tries to send an answer for seq=5 (which belongs to Alice, seat 1)
    expect(authorizeSeatAnswer(seats, kickedSeats, expectedSeats, 'peer-bob', 5)).toEqual({
      ok: false,
      reason: 'not-active-turn-seat',
    });

    // Bob claims `seat: 1` explicitly
    expect(authorizeSeatAnswer(seats, kickedSeats, expectedSeats, 'peer-bob', 5, 1)).toEqual({
      ok: false,
      reason: 'seat-mismatch',
    });

    // Stranger not in `seats` tries to answer
    expect(authorizeSeatAnswer(seats, kickedSeats, expectedSeats, 'peer-stranger', 5)).toEqual({
      ok: false,
      reason: 'no-seat-owned',
    });

    // Alice (seat 1) answers opened seq=5 legitimately
    expect(authorizeSeatAnswer(seats, kickedSeats, expectedSeats, 'peer-alice', 5, 1)).toEqual({
      ok: true,
      seat: 1,
    });

    // Kicked player can no longer submit answers
    kickedSeats.add(1);
    expect(authorizeSeatAnswer(seats, kickedSeats, expectedSeats, 'peer-alice', 5, 1)).toEqual({
      ok: false,
      reason: 'seat-kicked',
    });
  });

  it('generates 6-character high-entropy CSPRNG room codes without ambiguous characters', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode(6);
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      codes.add(code);
    }
    expect(codes.size).toBeGreaterThan(15);
  });
});
