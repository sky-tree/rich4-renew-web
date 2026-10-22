import { expect, test } from '@playwright/test';
import { retainEvidence } from './e2e-helper';

const clientCount = Number(process.env.E2E_PARTY_CLIENTS || 2);
const forceRelay = process.env.E2E_FORCE_RELAY === '1';

test.use({ trace: 'off', video: 'off' });
test(`${clientCount} real PeerJS clients see all members and exchange lobby chat`, async ({ page, context }, testInfo) => {
  test.skip(process.env.E2E_PARTY !== '1', 'Requires the private staging signaling and TURN runtime');
  test.setTimeout(120000);
  expect([2, 3, 4, 5]).toContain(clientCount);
  const clients = [page];
  for (let i = 1; i < clientCount; i++) clients.push(await context.newPage());
  const builds: (string | null)[] = [];
  let completed = false;
  try {
    await Promise.all(clients.map(p => p.goto(forceRelay ? './?relay=1' : './')));
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
    completed = true;
  } finally {
    await retainEvidence(testInfo, 'party-lobby.json', JSON.stringify({ status: completed ? 'passed' : 'failed', builds,
      mode: `${clientCount} browser pages on one Mac, ${forceRelay ? 'forced remote relay configuration' : 'automatic ICE'}; not separate physical networks`,
      memberCounts: await Promise.all(clients.map(p => p.locator('.pt-seat:not(.cpu)').count())),
      notices: await Promise.all(clients.map(p => p.locator('.pt-err').textContent({ timeout: 500 }).catch(() => null))),
      allClientChat: completed }), 'application/json');
    await Promise.all(clients.slice(1).map(p => p.close()));
  }
});
