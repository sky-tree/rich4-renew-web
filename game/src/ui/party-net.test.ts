import { afterEach, describe, expect, it } from 'vitest';
import {
  ICE_SERVERS,
  PARTY_PROTOCOL_VERSION,
  resolvePartyNetConfig,
  setPartyNetConfig,
  validateIncomingMsg,
} from './party-net';

describe('Party networking security, credential isolation and protocol validation (M5)', () => {
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
    expect(validateIncomingMsg({ t: 'hi', name: 'A', character: 0, proto: PARTY_PROTOCOL_VERSION }).ok).toBe(true);
    expect(validateIncomingMsg({ t: 'hi', name: 'A', character: 0, proto: PARTY_PROTOCOL_VERSION + 1 })).toEqual({
      ok: false,
      reason: 'version-mismatch',
    });
    expect(validateIncomingMsg({ t: 'ans', seq: -1, v: 0 })).toEqual({ ok: false, reason: 'invalid-seq' });
    expect(validateIncomingMsg({ t: 'ans', seq: 999999, v: 0 })).toEqual({ ok: false, reason: 'invalid-seq' });
    expect(validateIncomingMsg({ t: 'chat', line: { text: 'hello' } }).ok).toBe(true);
    expect(validateIncomingMsg({ t: 'chat', line: { text: 'x'.repeat(200) } }, 64)).toEqual({
      ok: false,
      reason: 'message-too-large',
    });
  });
});
