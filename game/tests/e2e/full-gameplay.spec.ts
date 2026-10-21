import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertCleanBoot, saveFailureEvidence, setupDiagnostics } from './e2e-helper';
import { loadViaUi, rollAndObserve, saveViaUi, snapshot, startMatch, storedSlot } from './gameplay-helper';

const HAS_ASSETS = existsSync(fileURLToPath(new URL('../../public/assets/maps/maps.json', import.meta.url)));

test.describe('Production gameplay and UI save/restore', () => {
  test.skip(!HAS_ASSETS && !process.env.E2E_REMOTE_ASSETS, 'Private full assets are required');

  test('UI save -> refresh -> UI load -> exact state -> continue rolling', async ({ page }, testInfo) => {
    test.setTimeout(90000);
    const diag = setupDiagnostics(page);
    try {
      await startMatch(page);
      const before = await snapshot(page);
      await saveViaUi(page);
      const stored = await storedSlot(page, 1);
      expect(stored).not.toBeNull();
      const { savedAt: _timestamp, ...savedState } = stored!;
      expect(savedState).toEqual(before);
      await page.reload();
      await loadViaUi(page);
      // Includes every player field, board, module, RNG, date, settings and statistics.
      expect(await snapshot(page)).toEqual(before);
      await rollAndObserve(page);
      await assertCleanBoot(page, diag);
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });

  test('natural turn snapshot is auto-saved and restored through the slot picker', async ({ page }, testInfo) => {
    test.setTimeout(90000);
    const diag = setupDiagnostics(page);
    try {
      await startMatch(page);
      const before = await snapshot(page);
      await expect.poll(async () => Boolean(await storedSlot(page, 0))).toBe(true);
      await page.reload();
      await page.locator('button[data-act="load"]').click();
      await page.locator('.slot-row').filter({ has: page.locator('.slot-badge', { hasText: /^AUTO$/ }) }).first().click();
      await expect(page.locator('.go')).toBeVisible({ timeout: 30000 });
      expect(await snapshot(page)).toEqual(before);
      await rollAndObserve(page);
      await assertCleanBoot(page, diag);
    } finally {
      saveFailureEvidence(testInfo, diag);
    }
  });
});
