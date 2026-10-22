import { devices, expect, test, webkit } from '@playwright/test';
import { retainEvidence } from './e2e-helper';

test.use({ trace: 'off', video: 'off' });
test('Chromium host and separate iPhone WebKit guest acknowledge membership and chat through relay', async ({ page, context }, testInfo) => {
  test.skip(process.env.E2E_CROSS_BROWSER !== '1', 'Explicit private staging mixed-engine test');
  test.setTimeout(120000);
  const safari = await webkit.launch();
  const guestContext = await safari.newContext({ ...devices['iPhone 14 Pro Max'],
    baseURL: testInfo.project.use.baseURL, storageState: await context.storageState() });
  const guest = await guestContext.newPage();
  let completed = false;
  const httpFailures: { client: number; path: string; status: number }[] = [];
  const websocketErrors: number[] = [];
  const clients = [page, guest];
  for (const [client, p] of clients.entries()) {
    p.on('response', response => {
      if (response.status() >= 400) httpFailures.push({ client,
        path: new URL(response.url()).pathname.replace(/\/peerjs\/.*/, '/peerjs/[redacted]'), status: response.status() });
    });
    p.on('websocket', socket => socket.on('socketerror', () => websocketErrors.push(client)));
    await p.addInitScript(() => {
      const peers: RTCPeerConnection[] = [];
      const Native = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Native {
        constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) { super(...args); peers.push(this); }
      };
      (window as any).__mixedTransport = () => peers.map(pc => ({ connection: pc.connectionState, ice: pc.iceConnectionState,
        policy: pc.getConfiguration().iceTransportPolicy }));
    });
  }
  try {
    await Promise.all(clients.map(p => p.goto('./?relay=1')));
    await Promise.all(clients.map(p => p.locator('[data-act="party"]').click()));
    await page.locator('[data-a="create"]').click({ timeout: 20000 });
    await page.locator('[data-a="open"]').click();
    const code = await page.locator('.pt-code b').innerText();
    await guest.locator('[data-a="join"]').click({ timeout: 20000 });
    await guest.locator('.pt-input').fill(code);
    await guest.locator('[data-a="enter"]').click();
    await expect(page.locator('.pt-seat:not(.cpu)')).toHaveCount(2, { timeout: 30000 });
    await expect(guest.locator('.pt-seat:not(.cpu)')).toHaveCount(2);
    await page.locator('.pc-form input').fill('mixed host test');
    await page.locator('.pc-form button').click();
    await expect(guest.locator('.pc-log')).toContainText('mixed host test');
    await guest.locator('.pc-form input').fill('mixed guest test');
    await guest.locator('.pc-form button').click();
    await expect(page.locator('.pc-log')).toContainText('mixed guest test');
    completed = true;
  } finally {
    await retainEvidence(testInfo, 'party-cross-browser.json', JSON.stringify({ status: completed ? 'passed' : 'failed',
      mode: 'Separate Chromium and WebKit contexts on one Mac, forced remote relay; not physical iPhone or separate networks',
      httpFailures, websocketErrors,
      transport: await Promise.all(clients.map(p => p.evaluate(() => (window as any).__mixedTransport?.()).catch(() => []))),
      guestNotice: await guest.locator('.pt-err').textContent().catch(() => null) }, null, 2), 'application/json');
    await guestContext.close();
    await safari.close();
  }
});
