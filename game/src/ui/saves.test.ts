import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveData } from '../core/save';
import { __resetSavesForTest, AUTO_KEEP, AUTO_SLOT, autoSaves, listSlots, readSlot, SLOTS, writeAuto, writeSlot } from './saves';

function dummySave(savedAt: number, date = 0x19990101): SaveData {
  return {
    version: 1,
    savedAt,
    settings: { mapId: 0, players: [{ character: 0, human: true }], days: 0, startCash: 10000, startDeposit: 10000 },
    game: { date } as unknown as SaveData['game'],
    players: [{ character: 0, human: true, bankrupt: false }] as unknown as SaveData['players'],
    board: {} as unknown as SaveData['board'],
    modules: {} as unknown as SaveData['modules'],
  } as unknown as SaveData;
}

interface MockOpenReq {
  result: unknown;
  error: Error;
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function installMockIndexedDB(opts?: { failFirstOpen?: boolean; failAllOpens?: boolean }) {
  const store = new Map<number, unknown>();
  let openCount = 0;

  const mockIDB = {
    open: vi.fn((_name: string, _ver: number) => {
      openCount++;
      const req: MockOpenReq = {
        result: null,
        error: new Error('mock open failed'),
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (opts?.failAllOpens || (opts?.failFirstOpen && openCount === 1)) {
          req.onerror?.();
          return;
        }
        const db = {
          onclose: null as (() => void) | null,
          onversionchange: null as (() => void) | null,
          close: vi.fn(),
          createObjectStore: vi.fn(),
          transaction: (_storeName: string, _mode: string) => {
            const tx: {
              oncomplete: (() => void) | null;
              onerror: (() => void) | null;
              onabort: (() => void) | null;
              error: Error | null;
              objectStore: () => unknown;
            } = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              error: null,
              objectStore: () => ({
                get: (key: number) => {
                  const r = { result: store.get(key), error: null };
                  queueMicrotask(() => tx.oncomplete?.());
                  return r;
                },
                put: (val: unknown, key: number) => {
                  store.set(key, val);
                  const r = { result: key, error: null };
                  queueMicrotask(() => tx.oncomplete?.());
                  return r;
                },
              }),
            };
            return tx;
          },
        };
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    }),
  };

  vi.stubGlobal('indexedDB', mockIDB);
  return { store, getOpenCount: () => openCount };
}

describe('Web IndexedDB saves', () => {
  beforeEach(() => {
    __resetSavesForTest();
  });

  it('writes and reads manual slots via IndexedDB transaction oncomplete', async () => {
    installMockIndexedDB();
    const s1 = dummySave(1000);
    await writeSlot(1, s1);
    const got = await readSlot(1);
    expect(got).toEqual(s1);

    const all = await listSlots();
    expect(all.length).toBe(SLOTS);
    expect(all[1]).toEqual(s1);
    expect(all[2]).toBeUndefined();
  });

  it('maintains a 5-turn ring for auto saves and overwrites the same turn idempotently', async () => {
    installMockIndexedDB();
    // Write turn-1 twice: should overwrite the same ring entry
    await writeAuto(AUTO_SLOT, dummySave(100), 'turn-1');
    await writeAuto(AUTO_SLOT, dummySave(150), 'turn-1');
    let autos = await autoSaves(AUTO_SLOT);
    expect(autos.length).toBe(1);
    expect(autos[0].save.savedAt).toBe(150);

    // Fill up to 6 turns: only the newest 5 should remain
    for (let t = 2; t <= 6; t++) {
      await writeAuto(AUTO_SLOT, dummySave(t * 100), `turn-${t}`);
    }
    autos = await autoSaves(AUTO_SLOT);
    expect(autos.length).toBe(AUTO_KEEP);
    expect(autos.map(a => a.save.savedAt)).toEqual([600, 500, 400, 300, 200]);
  });

  it('retries once with a fresh connection when IndexedDB fails on first attempt', async () => {
    const { getOpenCount } = installMockIndexedDB({ failFirstOpen: true });
    const s = dummySave(2000);
    await writeSlot(2, s);
    expect(getOpenCount()).toBe(2);
    expect(await readSlot(2)).toEqual(s);
  });

  it('rejects when IndexedDB fails on both initial and retry attempts', async () => {
    installMockIndexedDB({ failAllOpens: true });
    await expect(writeSlot(3, dummySave(3000))).rejects.toThrow('mock open failed');
  });
});
