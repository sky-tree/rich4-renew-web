import { expect, type Page } from '@playwright/test';
import type { SaveData } from '../../src/core/save';

export async function startMatch(page: Page, backend = 'canvas', short = false) {
  await page.goto(`./?renderer=${backend}`);
  await page.locator('button[data-act="start"]').click();
  await page.locator('button[data-count="2"]').click();
  await page.locator('button[data-map="2"]').click();
  if (short) {
    // A real one-month game, selected through the same UI as a player.
    await page.locator('[data-step="daysLimitIndex"][data-d="-1"]').click();
    await page.locator('[data-step="fundIndex"][data-d="-1"]').click();
    await page.locator('[data-step="fundIndex"][data-d="-1"]').click();
  }
  await page.locator('button[data-go="1"]').click();
  await expect(page.locator('.go')).toBeVisible({ timeout: 30000 });
}

/** Read-only observation; saving and restoring must use the UI. */
export async function snapshot(page: Page) {
  const data = await page.evaluate(() => {
    const hook = (window as unknown as { __rich4: { snapshot: () => SaveData } }).__rich4;
    return hook.snapshot();
  });
  const { savedAt: _timestamp, ...state } = data;
  return state;
}

export async function storedSlot(page: Page, slot: number): Promise<SaveData | null> {
  return page.evaluate(id => new Promise<SaveData | null>((resolve, reject) => {
    const request = indexedDB.open('rich4');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('saves', 'readonly');
      const read = tx.objectStore('saves').get(id);
      read.onsuccess = () => resolve(read.result ?? null);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }), slot);
}

export async function saveViaUi(page: Page) {
  await expect(page.locator('.go')).toBeVisible();
  await page.locator('nav.toolbar [data-key="save"]').click();
  await page.locator('.slot-row').filter({ has: page.locator('.slot-badge', { hasText: /^1$/ }) }).click();
  await expect.poll(async () => Boolean(await storedSlot(page, 1))).toBe(true);
}

export async function loadViaUi(page: Page) {
  await page.locator('button[data-act="load"]').click();
  await page.locator('.slot-row').filter({ has: page.locator('.slot-badge', { hasText: /^1$/ }) }).click();
  await expect(page.locator('.go')).toBeVisible({ timeout: 30000 });
}

export async function rollAndObserve(page: Page) {
  const before = await snapshot(page);
  await page.locator('.go').click();
  await expect.poll(async () => {
    const after = await snapshot(page);
    return JSON.stringify(after.game) !== JSON.stringify(before.game) ||
      JSON.stringify(after.players) !== JSON.stringify(before.players);
  }, { timeout: 20000 }).toBe(true);
}
