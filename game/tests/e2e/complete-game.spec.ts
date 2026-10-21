import { expect, test } from '@playwright/test';
import { assertCleanBoot, setupDiagnostics, saveFailureEvidence, retainEvidence } from './e2e-helper';
import { snapshot, startMatch } from './gameplay-helper';

test.use({ trace: 'off', video: 'off' });

test.describe('Complete production match', () => {
  test.skip(process.env.E2E_COMPLETE !== '1', 'Run explicitly with E2E_COMPLETE=1; this is a long acceptance test');

  test('one-month 2P game reaches engine gameover and visible settlement through UI autopilot', async ({ page }, testInfo) => {
    test.setTimeout(600000);
    const diag = setupDiagnostics(page);
    const started = Date.now();
    try {
      await page.addInitScript(() => {
        localStorage.setItem('rich4.speed', '2');
        localStorage.setItem('rich4.minigame', '1');
      });
      await startMatch(page, 'canvas', true);
      const initial = await snapshot(page);
      expect(initial.settings.daysLimitIndex).toBe(5);
      // Advance browser time to shorten animations; never mutate the rules state,
      // inject answers into the engine, or call the results-screen debug hook.
      await page.clock.install();
      await page.locator('nav.toolbar [data-key="autopilot"]').click();
      let settled = false;
      for (let step = 0; step < 2400; step++) {
        await page.clock.fastForward(1000);
        if (await page.locator('.rs-cover').isVisible()) { settled = true; break; }
        // A real player's tap skips captions and ending animations.
        await page.locator('canvas.board').click({ position: { x: 30, y: 70 }, timeout: 1000 }).catch(() => {});
        if (step % 100 === 0) {
          const state = await snapshot(page);
          console.log(`Complete match: animation steps=${step}, days=${state.game.daysElapsed}`);
        }
      }
      expect(settled, 'The game must finish naturally; displaying a debug results screen is insufficient').toBe(true);
      const final = await snapshot(page);
      const over = await page.evaluate(() => (window as any).__rich4.game.over);
      expect(over).not.toBeNull();
      await expect(page.locator('.rs-rank-row')).toHaveCount(2);
      await expect(page.locator('.rs-cover [data-a="home"]')).toBeVisible();
      await retainEvidence(testInfo, 'settlement.png', await page.screenshot(), 'image/png');
      await retainEvidence(testInfo, 'complete-match-evidence.json',
        JSON.stringify({ settings: initial.settings, initial: initial.game, final: final.game, over,
          players: final.players.map(p => ({ id: p.id, cash: p.cash, bank: p.bank, bankrupt: p.bankrupt })),
          timing: 'browser animation clock accelerated; rules unchanged', wallMs: Date.now() - started }, null, 2),
        'application/json');
      await assertCleanBoot(page, diag);
    } finally { saveFailureEvidence(testInfo, diag); }
  });
});
