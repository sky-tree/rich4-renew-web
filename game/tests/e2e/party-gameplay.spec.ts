import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { retainEvidence } from './e2e-helper';
import { snapshot } from './gameplay-helper';

test.use({ trace: 'off', video: 'off' });

test('two clients preserve authoritative state through gameplay and transport recovery', async ({ page, context }, testInfo) => {
  test.skip(process.env.E2E_PARTY_GAME !== '1', 'Explicit long test against the private staging runtime');
  test.setTimeout(600000);
  const minimumDays = Number(process.env.E2E_PARTY_DAYS || 20);
  const forceRelay = process.env.E2E_FORCE_RELAY !== '0';
  let completed = false;
  let candidate = 'unknown';
  const codec = readFileSync(new URL('../../node_modules/peerjs-js-binarypack/dist/binarypack.mjs', import.meta.url), 'utf8');
  const unpackName = codec.match(/export \{([\w$]+) as unpack,/)?.[1];
  if (!unpackName) throw new Error('Unknown BinaryPack export');
  await context.addInitScript({ content: codec.replace(/export \{[^}]+\};/, `window.__partyUnpack = ${unpackName};`) });
  await context.addInitScript(() => {
    localStorage.setItem('rich4.speed', '2');
    localStorage.setItem('rich4.minigame', '1');
    const peers: RTCPeerConnection[] = [];
    let silentUntil = 0, suppressed = 0;
    const packets: unknown[] = [];
    const observe = (data: unknown, direction: string) => {
      void (async () => {
        try {
          const m = (window as any).__partyUnpack(data instanceof Blob ? await data.arrayBuffer() : data);
          // Never retain reconnect tokens, member identities, chat or answer payloads.
          packets.push({ direction, t: m.t, seq: m.seq, from: m.from, total: m.total,
            count: m.members?.length ?? m.answers?.length, why: m.t === 'bye' ? m.why : undefined });
          if (packets.length > 100) packets.shift();
        } catch { /* Chunked messages are outside this narrow packet summary. */ }
      })();
    };
    const instrument = (channel: RTCDataChannel) => {
      channel.addEventListener('message', event => observe(event.data, 'in'));
      const send = (channel.send as (data: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>) => void).bind(channel);
      channel.send = data => {
        if (Date.now() < silentUntil) { suppressed++; return; }
        observe(data, 'out'); send(data);
      };
      return channel;
    };
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args); peers.push(this);
        this.addEventListener('datachannel', event => instrument(event.channel));
      }
      override createDataChannel(...args: Parameters<RTCPeerConnection['createDataChannel']>) { return instrument(super.createDataChannel(...args)); }
    };
    // Only transport observation/fault injection; never mutate the rules state.
    (window as any).__partyTransportTest = {
      connected: () => peers.filter(pc => pc.connectionState === 'connected').length,
      states: () => peers.map(pc => ({ connection: pc.connectionState, ice: pc.iceConnectionState })),
      packets: () => packets,
      silence: (ms: number) => { silentUntil = Date.now() + ms; },
      suppressed: () => suppressed,
      drop: () => { const active = peers.filter(pc => pc.connectionState === 'connected'); active.forEach(pc => pc.close()); return active.length; },
    };
  });
  const guest = await context.newPage();
  const clients = [page, guest];
  const advance = async () => {
    await Promise.all(clients.map(p => p.clock.fastForward(1000)));
    // Let actual network messages run between animation-clock ticks.
    await page.waitForTimeout(10);
    for (const p of clients) await p.locator('canvas.board').click({ position: { x: 30, y: 70 }, timeout: 1000 }).catch(() => {});
  };
  const checkpoints: { days: number; hash: string; phase: string }[] = [];
  const checkpoint = async (phase: string) => {
    await expect(page.locator('.go')).toBeVisible();
    const host = await snapshot(page);
    await expect.poll(async () => JSON.stringify(await snapshot(guest)), { timeout: 15000 }).toBe(JSON.stringify(host));
    const hash = createHash('sha256').update(JSON.stringify(host)).digest('hex');
    checkpoints.push({ days: host.game.daysElapsed, hash, phase });
    return host;
  };
  const stopAtHostTurn = async () => {
    await page.locator('.party-bar [data-v="auto"]').click();
    for (let tick = 0; tick < 600; tick++) {
      if (await page.locator('.go').isVisible()) return;
      await advance();
    }
    throw new Error('Host did not return from autopilot to a manual turn');
  };
  try {
    await Promise.all(clients.map(p => p.goto(forceRelay ? './?relay=1' : './')));
    candidate = await page.evaluate(async () => (await (await fetch('./release-manifest.json', { cache: 'no-store' })).json()).gitSha);
    await Promise.all(clients.map(p => p.locator('[data-act="party"]').click()));
    await page.locator('[data-a="create"]').click({ timeout: 20000 });
    await page.locator('[data-map="2"]').click();
    await page.locator('[data-a="open"]').click();
    const code = await page.locator('.pt-code b').innerText();
    await guest.locator('[data-a="join"]').click({ timeout: 20000 });
    await guest.locator('.pt-input').fill(code);
    await guest.locator('[data-a="enter"]').click();
    await expect(page.locator('.pt-seat:not(.cpu)')).toHaveCount(2, { timeout: 30000 });
    await expect(guest.locator('.pt-seat:not(.cpu)')).toHaveCount(2);
    await page.locator('[data-fill="0"]').click();
    await page.locator('[data-a="go"]').click();
    await expect(page.locator('.go')).toBeVisible({ timeout: 30000 });
    await expect(guest.locator('.party-bar')).toBeVisible({ timeout: 30000 });
    await checkpoint('initial');
    for (const p of clients) { await p.clock.install(); await p.clock.pauseAt(new Date()); }
    await Promise.all(clients.map(p => p.locator('.party-bar [data-v="auto"]').click()));
    let days = 0;
    for (let tick = 0; tick < 4000 && days < minimumDays; tick++) {
      await advance();
      if (tick % 20 === 0) {
        days = (await snapshot(page)).game.daysElapsed;
        if (tick % 200 === 0) console.log(`Party gameplay: animation ticks=${tick}, days=${days}`);
      }
    }
    expect(days).toBeGreaterThanOrEqual(minimumDays);
    await stopAtHostTurn();
    await checkpoint(`at-least-${minimumDays}-days-before-drop`);
    const dropped = await guest.evaluate(() => (window as any).__partyTransportTest.drop());
    expect(dropped).toBeGreaterThan(0);
    // ICE and signaling run on real network time. Accelerating the application
    // clock during reconnection prematurely expires PeerJS connection timeouts.
    await Promise.all(clients.map(p => p.clock.resume()));
    await expect.poll(() => guest.evaluate(() => (window as any).__partyTransportTest.connected()),
      { timeout: 30000, message: 'A new real WebRTC connection must replace the closed one' }).toBeGreaterThan(0);
    // ICE connected is earlier than the DataChannel/host handshake. Wait for
    // application acknowledgement before accelerating any timeouts again.
    await expect(page.locator('.party-bar [data-v="people"] em')).toHaveText('2/2', { timeout: 30000 });
    await expect(guest.locator('.party-bar [data-v="people"] em')).toHaveText('2/2', { timeout: 30000 });
    await checkpoint('after-reconnect');
    for (const p of clients) await p.clock.pauseAt(await p.evaluate(() => Date.now() + 100));
    const before = (await snapshot(page)).game.daysElapsed;
    await page.locator('.party-bar [data-v="auto"]').click();
    for (let tick = 0; tick < 600; tick++) {
      await advance();
      if ((await snapshot(page)).game.daysElapsed > before) break;
    }
    expect((await snapshot(page)).game.daysElapsed).toBeGreaterThan(before);
    await stopAtHostTurn();
    await checkpoint('continued-after-reconnect');
    if (process.env.E2E_NETWORK_BLACKHOLE === '1') {
      // Keep the channel open while guest messages disappear for twenty real
      // seconds. This differs from the explicit close above: no close event is injected.
      await Promise.all(clients.map(p => p.clock.resume()));
      await guest.evaluate(() => (window as any).__partyTransportTest.silence(20000));
      await page.locator('.party-bar [data-v="auto"]').click();
      await page.waitForTimeout(22000);
      expect(await guest.evaluate(() => (window as any).__partyTransportTest.suppressed())).toBeGreaterThan(0);
      await expect(page.locator('.party-bar [data-v="people"] em')).toHaveText('2/2', { timeout: 45000 });
      await expect(guest.locator('.party-bar [data-v="people"] em')).toHaveText('2/2', { timeout: 45000 });
      for (const p of clients) await p.clock.pauseAt(await p.evaluate(() => Date.now() + 100));
      await stopAtHostTurn();
      await checkpoint('after-twenty-second-message-blackhole');
      const before = (await snapshot(page)).game.daysElapsed;
      await page.locator('.party-bar [data-v="auto"]').click();
      for (let tick = 0; tick < 600; tick++) {
        await advance();
        if ((await snapshot(page)).game.daysElapsed > before) break;
      }
      expect((await snapshot(page)).game.daysElapsed).toBeGreaterThan(before);
      await stopAtHostTurn();
      await checkpoint('continued-after-message-blackhole');
    }
    completed = true;
  } finally {
    await retainEvidence(testInfo, 'party-gameplay.json', JSON.stringify({ candidate,
      status: completed ? 'passed' : 'failed', minimumDays,
      mode: `Two Chromium pages on one Mac, ${forceRelay ? 'forced remote relay' : 'automatic ICE policy'}, UI autopilot and accelerated animation clocks`,
      fault: `Closed actual guest RTCPeerConnection${process.env.E2E_NETWORK_BLACKHOLE === '1' ? ' plus twenty-second outbound-message blackhole' : ''}; not a physical network outage`,
      equality: 'Every serialized SaveData field except savedAt; SHA-256 checkpoints', checkpoints,
      guestTransport: await guest.evaluate(() => (window as any).__partyTransportTest?.states()).catch(() => []),
      packets: await Promise.all(clients.map(p => p.evaluate(() => (window as any).__partyTransportTest?.packets()).catch(() => []))),
      finalState: await Promise.all(clients.map(async p => ({ state: await snapshot(p).catch(() => null), waiting: await p.locator('.pt-waiting').textContent().catch(() => null) }))) }, null, 2), 'application/json');
    await guest.close();
  }
});
