import { expect, test } from '@playwright/test';
import { retainEvidence } from './e2e-helper';

test.use({ trace: 'off', video: 'off' });
test('two real PeerJS clients see both members and exchange lobby chat', async ({ page, context }, testInfo) => {
  test.skip(process.env.E2E_PARTY !== '1', 'Requires the private staging signaling and TURN runtime');
  test.setTimeout(90000);
  const config = await (await page.request.get('/api/party-config')).json();
  // Existing candidates can exercise the controlled server before the optional
  // endpoint bootstrap is enabled. Credentials remain in memory, never evidence.
  await context.addInitScript(cfg => { (window as any).__RICH4_NET_CONFIG__ = cfg; }, config);
  const guest = await context.newPage();
  await Promise.all([page.goto('./'), guest.goto('./')]);
  await Promise.all([page.locator('[data-act="party"]').click(), guest.locator('[data-act="party"]').click()]);
  await page.locator('[data-a="create"]').click({ timeout: 20000 });
  await page.locator('[data-a="open"]').click();
  const code = await page.locator('.pt-code b').innerText();
  await guest.locator('[data-a="join"]').click({ timeout: 20000 });
  await guest.locator('.pt-input').fill(code);
  await guest.locator('[data-a="enter"]').click();
  await expect(page.locator('.pt-seat:not(.cpu)')).toHaveCount(2);
  await expect(guest.locator('.pt-seat:not(.cpu)')).toHaveCount(2);
  await page.locator('.pc-form input').fill('host test');
  await page.locator('.pc-form button').click();
  await expect(guest.locator('.pc-log')).toContainText('host test');
  await guest.locator('.pc-form input').fill('guest test');
  await guest.locator('.pc-form button').click();
  await expect(page.locator('.pc-log')).toContainText('guest test');
  await retainEvidence(testInfo, 'party-lobby.json', JSON.stringify({ mode: 'Two browser pages on one Mac, real controlled PeerServer; not cross NAT',
    hostMembers: 2, guestMembers: 2, bidirectionalChat: true }), 'application/json');
  await guest.close();
});
