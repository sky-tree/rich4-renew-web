import { expect, test } from '@playwright/test';
import { retainEvidence } from './e2e-helper';

const clientCount = Number(process.env.E2E_PARTY_CLIENTS || 2);
const forceRelay = process.env.E2E_FORCE_RELAY === '1';

test.use({ trace: 'off', video: 'off' });
test(`${clientCount} real PeerJS clients see all members and exchange lobby chat`, async ({ page, context }, testInfo) => {
  test.skip(process.env.E2E_PARTY !== '1', 'Requires the private staging signaling and TURN runtime');
  test.setTimeout(120000);
  expect([2, 3, 4, 5]).toContain(clientCount);
  await context.addInitScript(() => {
    const peers: RTCPeerConnection[] = [], errors: number[] = [];
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(Native, { construct(target, args) {
      const pc = new target(...args as ConstructorParameters<typeof RTCPeerConnection>);
      peers.push(pc);
      pc.addEventListener('icecandidateerror', event => errors.push(event.errorCode));
      return pc;
    } });
    (window as any).__lobbyTransport = async () => {
      const pairs: { localType?: string; remoteType?: string }[] = [];
      const connected = peers.filter(item => item.connectionState === 'connected');
      for (const pc of connected) {
        const stats = await pc.getStats();
        const pair = [...stats.values()].find(item => item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated);
        pairs.push({ localType: stats.get(pair?.localCandidateId)?.candidateType,
          remoteType: stats.get(pair?.remoteCandidateId)?.candidateType });
      }
      // PeerJS also constructs throwaway capability probes with default ICE.
      // Enforce relay on actual connected transports, retaining probe policies
      // separately so a feature check cannot masquerade as a live direct path.
      return { policies: [...new Set(connected.map(pc => pc.getConfiguration().iceTransportPolicy ?? 'all'))],
        observedPolicies: [...new Set(peers.map(pc => pc.getConfiguration().iceTransportPolicy ?? 'all'))], pairs, errors };
    };
  });
  const clients = [page];
  for (let i = 1; i < clientCount; i++) clients.push(await context.newPage());
  const builds: (string | null)[] = [];
  let runtimePolicy = 'unknown';
  let transport: { policies: string[]; pairs: { localType?: string; remoteType?: string }[]; errors: number[] }[] = [];
  let completed = false;
  let chatCompleted = false;
  try {
    await Promise.all(clients.map(p => p.goto(forceRelay ? './?relay=1' : './')));
    runtimePolicy = await page.evaluate(async () => (await (await fetch('./api/party-config', { cache: 'no-store' })).json()).iceTransportPolicy ?? 'all');
    expect(runtimePolicy).toBe('relay');
    const candidate = await page.evaluate(async () => (await (await fetch('./release-manifest.json', { cache: 'no-store' })).json()).gitSha);
    for (const p of clients) builds.push(await p.locator('.title-ver').getAttribute('data-build'));
    expect(builds).toEqual(clients.map(() => candidate));
    await Promise.all(clients.map(p => p.locator('[data-act="party"]').click()));
    await page.locator('[data-a="create"]').click({ timeout: 20000 });
    await page.locator('[data-a="open"]').click();
    const code = await page.locator('.pt-code b').innerText();
    for (const [index, guest] of clients.entries()) {
      if (!index) continue;
      await guest.locator('[data-a="join"]').click({ timeout: 20000 });
      await guest.locator('.pt-input').fill(code);
      await guest.locator('[data-a="enter"]').click();
      for (const p of clients.slice(0, index + 1)) {
        await expect(p.locator('.pt-seat:not(.cpu)')).toHaveCount(index + 1, { timeout: 30000 });
      }
    }
    for (const [index, sender] of clients.entries()) {
      const text = `client ${index + 1} lobby test`;
      await sender.locator('.pc-form input').fill(text);
      await sender.locator('.pc-form button').click();
      for (const receiver of clients) await expect(receiver.locator('.pc-log')).toContainText(text);
    }
    chatCompleted = true;
    transport = await Promise.all(clients.map(p => p.evaluate(() => (window as any).__lobbyTransport())));
    if (forceRelay || runtimePolicy === 'relay') {
      for (const client of transport) {
        expect(client.policies).toEqual(['relay']);
        expect(client.pairs.length).toBeGreaterThan(0);
        for (const pair of client.pairs) { expect(pair.localType).toBe('relay'); expect(pair.remoteType).toBe('relay'); }
      }
    }
    completed = true;
  } finally {
    await retainEvidence(testInfo, 'party-lobby.json', JSON.stringify({ status: completed ? 'passed' : 'failed', builds,
      mode: `${clientCount} browser pages on one Mac, ${forceRelay ? 'explicit relay query' : 'server default policy'}; not separate physical networks`,
      runtimePolicy, transport,
      memberCounts: await Promise.all(clients.map(p => p.locator('.pt-seat:not(.cpu)').count())),
      notices: await Promise.all(clients.map(p => p.locator('.pt-err').textContent({ timeout: 500 }).catch(() => null))),
      allClientChat: chatCompleted }), 'application/json');
    await Promise.all(clients.slice(1).map(p => p.close()));
  }
});
