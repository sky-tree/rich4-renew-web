import { afterEach, expect, it, vi } from 'vitest';
import { buildPeerOptions, refreshPartyNetConfig, setPartyNetConfig } from './party-net';

afterEach(() => { setPartyNetConfig(null); vi.unstubAllGlobals(); });

function pageConfig(path = '/api/party-config') {
  vi.stubGlobal('document', { querySelector: () => ({ content: path }) });
  vi.stubGlobal('location', { href: 'https://test.example/?relay=1', origin: 'https://test.example' });
}

it('refreshes expiring credentials, coalesces fetches and keeps relay mode in memory', async () => {
  pageConfig();
  const now = Date.now();
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ expiresAt: now + 120000,
    iceServers: [{ urls: 'turn:relay.example', username: 'short-lived', credential: 'test-only' }] }) });
  vi.stubGlobal('fetch', fetch);
  await Promise.all([refreshPartyNetConfig(), refreshPartyNetConfig()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('https://test.example/api/party-config', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }));
  expect(buildPeerOptions().config.iceTransportPolicy).toBe('relay');
  await refreshPartyNetConfig();
  expect(fetch).toHaveBeenCalledTimes(1);
  const time = vi.spyOn(Date, 'now').mockReturnValue(now + 65000);
  try {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ expiresAt: now + 3600000, iceServers: [{ urls: 'stun:relay.example' }] }) });
    await refreshPartyNetConfig();
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { time.mockRestore(); }
});

it('rejects cross-origin endpoints before any credential-bearing request', async () => {
  pageConfig('https://other.example/api');
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(refreshPartyNetConfig()).rejects.toThrow('same origin');
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects expired configuration and retries after an authorization failure', async () => {
  pageConfig();
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true,
    json: async () => ({ expiresAt: Date.now() - 1000, iceServers: [{ urls: 'turn:relay.example' }] }) });
  vi.stubGlobal('fetch', fetch);
  await expect(refreshPartyNetConfig()).rejects.toThrow('unavailable');
  await expect(refreshPartyNetConfig()).rejects.toThrow('expired');
  expect(fetch).toHaveBeenCalledTimes(2);
});
