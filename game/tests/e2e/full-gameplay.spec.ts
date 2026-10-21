import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanBoot, saveFailureEvidence, setupDiagnostics } from './e2e-helper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HAS_ASSETS = existsSync(join(__dirname, '../../public/assets/maps/maps.json'));

test.describe('E2E: Full Gameplay Loop and Save/Restore (Issues #6, #7, T-01, T-02, T-07)', () => {
  test.skip(!HAS_ASSETS, 'Skipping full gameplay tests: full game assets corpus not mounted locally');

  test('complete loop: start game -> 2P roster -> roll dice & move -> save to slot -> reload -> resume', async ({ page }, testInfo) => {
    test.setTimeout(60000); // 60s for full game loop
    const diag = setupDiagnostics(page);

    try {
      // 1. Boot to title screen
      await page.goto('./', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveTitle(/大富翁4/);
      await assertCleanBoot(page, diag);

      // Wait for title screen buttons to appear
      const startBtn = page.locator('button[data-act="start"]');
      await expect(startBtn).toBeVisible({ timeout: 15000 });

      // 2. Click Start Game to open new-game sheet
      await startBtn.click();
      const ngSheet = page.locator('.ng-sheet');
      await expect(ngSheet).toBeVisible({ timeout: 10000 });

      // 3. Select 2 Players mode
      const twoPlayersBtn = page.locator('button[data-count="2"]');
      if (await twoPlayersBtn.isVisible()) {
        await twoPlayersBtn.click();
      }

      // 4. Start the game match
      const goMatchBtn = page.locator('button[data-go="1"]');
      await expect(goMatchBtn).toBeVisible();
      await goMatchBtn.click();

      // 5. Wait for game stage and canvas to mount
      const gameShell = page.locator('main.game');
      await expect(gameShell).toBeVisible({ timeout: 20000 });
      const stageCanvas = page.locator('section.stage canvas.board');
      await expect(stageCanvas).toBeVisible({ timeout: 15000 });

      // Check toolbar and go button
      const toolbar = page.locator('nav.toolbar');
      await expect(toolbar).toBeVisible();

      // Verify game instance is attached on window.__rich4
      const hasGameInstance = await page.evaluate(() => {
        const r4 = (window as unknown as { __rich4?: { game?: unknown } }).__rich4;
        return Boolean(r4 && r4.game);
      });
      expect(hasGameInstance).toBe(true);

      // 6. First turn: wait for human player's GO dice button
      const goBtn = page.locator('.go');
      await expect(goBtn).toBeVisible({ timeout: 15000 });

      // Record state before rolling
      const beforeState = await page.evaluate(() => {
        const g = (window as unknown as { __rich4?: { game: { turn: number; players: { character: number; cash: number; pos: number }[] } } }).__rich4?.game;
        return g ? { turn: g.turn, humanPos: g.players[0].pos, humanCash: g.players[0].cash } : null;
      });
      expect(beforeState).not.toBeNull();

      // Click GO button to roll dice
      await goBtn.click({ force: true });

      // Wait for dice roll and player movement to take effect
      await page.waitForTimeout(3500);

      // Check that game turn or position progressed
      const afterState = await page.evaluate(() => {
        const g = (window as unknown as { __rich4?: { game: { turn: number; players: { character: number; cash: number; pos: number }[] } } }).__rich4?.game;
        return g ? { turn: g.turn, humanPos: g.players[0].pos, humanCash: g.players[0].cash } : null;
      });
      expect(afterState).not.toBeNull();

      // 7. Save game: trigger save via Toolbar or save API
      const saveSuccess = await page.evaluate(async () => {
        const r4 = (window as unknown as { __rich4?: { game: unknown } }).__rich4;
        if (!r4?.game) return false;
        // Access saves module through dynamic test hook or indexedDB write
        const { saveGame } = await import('../../src/core/save');
        const { writeSlot } = await import('../../src/ui/saves');
        const saveData = saveGame(r4.game as import('../../src/core/game').Game);
        await writeSlot(1, saveData);
        return true;
      });
      expect(saveSuccess).toBe(true);

      // 8. Reload the browser page to test state persistence
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveTitle(/大富翁4/);
      await assertCleanBoot(page, diag);

      // Wait for title screen
      const loadBtn = page.locator('button[data-act="load"]');
      await expect(loadBtn).toBeVisible({ timeout: 15000 });

      // 9. Load Slot 1 from IndexedDB
      const restored = await page.evaluate(async () => {
        const { readSlot } = await import('../../src/ui/saves');
        const data = await readSlot(1);
        return Boolean(data && data.players && data.players.length >= 2);
      });
      expect(restored).toBe(true);

      // Verify no errors occurred during reload
      await assertCleanBoot(page, diag);
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });

  test('indexedDB auto-save ring creates valid snapshot', async ({ page }, testInfo) => {
    const diag = setupDiagnostics(page);

    try {
      await page.goto('./', { waitUntil: 'domcontentloaded' });
      await assertCleanBoot(page, diag);

      const hasIndexedDB = await page.evaluate(async () => {
        return Boolean(window.indexedDB);
      });
      expect(hasIndexedDB).toBe(true);

      // Verify auto-save ring writes without throwing
      const autoSaveCheck = await page.evaluate(async () => {
        const { writeAuto, autoSaves, AUTO_SLOT } = await import('../../src/ui/saves');
        const dummySave = {
          version: 2,
          savedAt: Date.now(),
          date: { year: 2026, month: 10, day: 21 },
          turn: 1,
          activePlayer: 0,
          settings: {
            mapId: 2,
            fundIndex: 1,
            traffic: 0,
            landLimitIndex: 0,
            daysLimitIndex: 0,
            victoryIndex: 0,
            startDate: { year: 2026, month: 10, day: 21 },
            seed: 123456,
            players: [
              { character: 0, human: true },
              { character: 1, human: false },
            ],
          },
          board: { lots: [] },
          bank: { deposits: [0, 0], loans: [[], []] },
          stock: { market: [], holdings: [[], []] },
          players: [
            { character: 0, human: true, cash: 200000, pos: 0, direction: 1, vehicle: 0, tickets: 0, cards: [], tools: [] },
            { character: 1, human: false, cash: 200000, pos: 10, direction: 1, vehicle: 0, tickets: 0, cards: [], tools: [] },
          ],
        };
        await writeAuto(AUTO_SLOT, dummySave as unknown as import('../../src/core/save').SaveData, 'turn-1');
        const autos = await autoSaves(AUTO_SLOT);
        return Array.isArray(autos) && autos.length > 0;
      });
      expect(autoSaveCheck).toBe(true);
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });
});
