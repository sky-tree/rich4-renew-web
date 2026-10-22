import { afterEach, expect, it, vi } from 'vitest';
import { checkNetwork } from './party-check';
import { setPartyNetConfig } from './party-net';

vi.mock('peerjs', () => ({ default: class {
  on(event: string, fn: () => void) { if (event === 'open') queueMicrotask(fn); }
  destroy() {}
} }));

afterEach(() => { setPartyNetConfig(null); vi.unstubAllGlobals(); vi.useRealTimers(); });

function network(kinds: string[]) {
  vi.useFakeTimers();
  const options: RTCConfiguration[] = [];
  vi.stubGlobal('RTCPeerConnection', class {
    onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null = null;
    constructor(config: RTCConfiguration) { options.push(config); }
    createDataChannel() {}
    async createOffer() { return {}; }
    async setLocalDescription() {
      for (const kind of kinds) this.onicecandidate?.({ candidate: { candidate: `candidate:test typ ${kind}` } });
      this.onicecandidate?.({ candidate: null });
    }
    close() {}
  });
  return options;
}

it('requires an actual relay candidate when the game forces relay, even if STUN succeeds', async () => {
  const options = network(['host', 'srflx']);
  setPartyNetConfig({ iceTransportPolicy: 'relay', iceServers: [{ urls: 'turn:test.example' }] });
  const result = await checkNetwork();
  expect(options[0].iceTransportPolicy).toBe('relay');
  expect(result).toMatchObject({ ok: false, title: '連不上轉送伺服器', retry: true });
});

it('permits a relay-only path and still permits STUN in normal automatic mode', async () => {
  network(['relay']);
  setPartyNetConfig({ iceTransportPolicy: 'relay', iceServers: [{ urls: 'turn:test.example' }] });
  expect(await checkNetwork()).toMatchObject({ ok: true });
  network(['srflx']);
  setPartyNetConfig(null);
  expect(await checkNetwork()).toEqual({ ok: true });
});
