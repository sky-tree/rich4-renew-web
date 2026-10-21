import { expect, test } from '@playwright/test';
import { retainEvidence } from './e2e-helper';

test.use({ trace: 'off', video: 'off' });
test('authenticated short-lived TURN credentials carry a forced-relay data channel', async ({ page }, testInfo) => {
  test.skip(process.env.E2E_PARTY !== '1', 'Requires the private staging TURN runtime');
  test.setTimeout(60000);
  const response = await page.request.get('/api/party-config');
  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toContain('no-store');
  const config = await response.json();
  await page.goto('./');
  const result = await page.evaluate(async cfg => {
    const left = new RTCPeerConnection({ iceServers: cfg.iceServers, iceTransportPolicy: 'relay' });
    const right = new RTCPeerConnection({ iceServers: cfg.iceServers, iceTransportPolicy: 'relay' });
    const gather = (pc: RTCPeerConnection) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Relay gathering timed out')), 15000);
      // A blocked alternative STUN/TCP probe may keep gathering after a usable
      // relay candidate exists. Start the connection as soon as relay is ready.
      const check = () => { if (pc.localDescription?.sdp.includes(' typ relay')) { clearTimeout(timer); resolve(); } };
      pc.addEventListener('icegatheringstatechange', check); check();
      pc.addEventListener('icecandidate', check);
    });
    try {
      const channel = left.createDataChannel('relay-check');
      const received: number[] = [];
      const delivered = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Forced relay echo timed out')), 20000);
        right.ondatachannel = event => { event.channel.onmessage = message => event.channel.send(message.data); };
        channel.onopen = () => { for (let i = 0; i < 20; i++) channel.send(String(i)); };
        channel.onmessage = event => { received.push(Number(event.data)); if (received.length === 20) { clearTimeout(timer); resolve(); } };
      });
      // Catch early rejection while ICE gathering is still pending.
      void delivered.catch(() => {});
      await left.setLocalDescription(await left.createOffer()); await gather(left);
      await right.setRemoteDescription(left.localDescription!);
      await right.setLocalDescription(await right.createAnswer()); await gather(right);
      await left.setRemoteDescription(right.localDescription!);
      await delivered;
      const report = [];
      for (const pc of [left, right]) {
        const stats = await pc.getStats();
        const pair = [...stats.values()].find(item => item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated);
        report.push({ localType: stats.get(pair?.localCandidateId)?.candidateType,
          remoteType: stats.get(pair?.remoteCandidateId)?.candidateType });
      }
      return { received, report };
    } finally { left.close(); right.close(); }
  }, config);
  expect(result.received).toEqual(Array.from({ length: 20 }, (_, i) => i));
  for (const pair of result.report) { expect(pair.localType).toBe('relay'); expect(pair.remoteType).toBe('relay'); }
  await retainEvidence(testInfo, 'turn-relay.json', JSON.stringify({ timestamp: new Date().toISOString(),
    mode: 'Two real WebRTC clients on one Mac through remote TURN; not cross-NAT gameplay', ...result }, null, 2), 'application/json');
});
