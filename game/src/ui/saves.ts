/**
 * Save slots and the slot picker (Web IndexedDB).
 * Database `rich4`, object store `saves`: 7 slots where 0 is normal mode auto-save and 6 is 大富豪模式 auto-save,
 * plus a 5-turn ring buffer per automatic slot.
 */
import { CHARACTERS } from '../core/characters';
import type { SaveData } from '../core/save';
import type { SpriteBank } from './sprites';
import { audio } from './audio';

export const SLOTS = 7;
export const SAVE_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const BACKUP_BASE = 2000;
/** Slot 0 is the automatic save, as SAVE0.DAT in the original. */
export const AUTO_SLOT = 0;
/** 大富豪模式 saves itself into its own slot, so a world never overwrites a normal game's automatic save. */
export const TYCOON_AUTO_SLOT = 6;
const isAuto = (i: number) => i === AUTO_SLOT || i === TYCOON_AUTO_SLOT;
/** A 大富豪 world's save (core/save.ts WorldSaveData) in a slot: its date, current city and twelve players. */
type AnySave = SaveData & { kind?: 'tycoon'; world?: { date: number; current: number }; cities?: { game: { date: number } }[] };

const DB = 'rich4', STORE = 'saves';

/** A promise that gives up after `ms` (a stuck IndexedDB never answers). */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ---------------------------------------------------------------- IndexedDB (browser)

let conn: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (conn ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const d = req.result;
      // A lost or closed connection is opened again next time.
      d.onclose = () => { conn = null; };
      d.onversionchange = () => { d.close(); conn = null; };
      resolve(d);
    };
    req.onerror = () => { conn = null; reject(req.error); };
  }));
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const go = async () => {
    const d = await within(db(), 4000, 'IndexedDB open');
    return within(new Promise<T>((resolve, reject) => {
      const t = d.transaction(STORE, mode), req = run(t.objectStore(STORE));
      // A write counts once its transaction is committed, not when the request is queued.
      t.oncomplete = () => resolve(req.result);
      t.onerror = t.onabort = () => reject(t.error ?? req.error);
    }), 8000, 'IndexedDB transaction');
  };
  try { return await go(); }
  catch { conn = null; return go(); } // one fresh connection, then give up
}

let writing: Promise<unknown> = Promise.resolve();
/** Writes a slot (one write at a time, in order); resolves once the save is really stored. */
export function writeSlot(slot: number, data: SaveData): Promise<void> {
  const run = () => idb('readwrite', s => s.put(data, slot)).then(() => {});
  const p = writing.then(run, run);
  writing = p.catch(() => {});
  return p;
}
export const readSlot = (slot: number): Promise<SaveData | undefined> => idb<SaveData | undefined>('readonly', s => s.get(slot));

/** Reset internal connection & ring state for unit tests. */
export function __resetSavesForTest(): void {
  conn = null;
  ringAt.clear();
  writing = Promise.resolve();
  autoChain = Promise.resolve();
}

/**
 * The automatic saves keep the last five turns (the user 2026-10-19): the automatic slot itself and four more
 * (ids 1000 + slot × 10 + k), written in turn, the oldest overwritten. `turn` names the turn being saved: saving it
 * again (going to the background, a retry) rewrites the same one instead of pushing an older turn out.
 */
export const AUTO_KEEP = 5;
const ringIds = (slot: number) => [slot, ...Array.from({ length: AUTO_KEEP - 1 }, (_, k) => 1000 + slot * 10 + k)];
const ringAt = new Map<number, { turn: string; at: number }>();
let autoChain: Promise<unknown> = Promise.resolve();

/** The automatic saves of a slot that hold a game, newest first. */
export async function autoSaves(slot: number): Promise<{ id: number; save: SaveData }[]> {
  const ids = ringIds(slot);
  const got = await Promise.all(ids.map(id => readSlot(id).catch(() => undefined)));
  return got.map((save, k) => ({ id: ids[k], save })).filter((x): x is { id: number; save: SaveData } => !!x.save)
    .sort((a, b) => (b.save.savedAt ?? 0) - (a.save.savedAt ?? 0));
}

export function writeAuto(slot: number, data: SaveData, turn: string): Promise<void> {
  const run = async () => {
    const r = ringAt.get(slot);
    let at: number;
    if (r?.turn === turn) at = r.at;
    else if (r) at = (r.at + 1) % AUTO_KEEP;
    else {
      // First automatic save since the app started: the empty or oldest of the five.
      const ids = ringIds(slot);
      const got = await Promise.all(ids.map(id => readSlot(id).catch(() => undefined)));
      at = 0;
      got.forEach((g, k) => { if ((g ? g.savedAt ?? 0 : -1) < (got[at] ? got[at]!.savedAt ?? 0 : -1)) at = k; });
    }
    ringAt.set(slot, { turn, at });
    await writeSlot(ringIds(slot)[at], data);
  };
  const p = autoChain.then(run, run);
  autoChain = p.catch(() => {});
  return p;
}

export async function listSlots(): Promise<(SaveData | undefined)[]> {
  try { return await Promise.all(Array.from({ length: SLOTS }, (_, i) => readSlot(i))); }
  catch { return new Array(SLOTS).fill(undefined); }
}

export interface ExportedSaveEnvelope {
  schemaVersion: number;
  exportedAt: number;
  slot?: number;
  save: SaveData;
}

/** Serializes a SaveData into a portable JSON string with schemaVersion metadata (M5-04). */
export function exportSaveJson(save: SaveData, slot?: number): string {
  const envelope: ExportedSaveEnvelope = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    exportedAt: Date.now(),
    ...(slot !== undefined ? { slot } : {}),
    save,
  };
  return JSON.stringify(envelope, null, 2);
}

/** Triggers a browser download of the slot's save as a `.json` file. */
export function downloadSaveJson(save: SaveData, slot: number): void {
  const json = exportSaveJson(save, slot);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date(save.savedAt || Date.now()).toISOString().slice(0, 10);
  a.href = url;
  a.download = `rich4-slot-${slot}-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function hasPrototypePollutionKey(obj: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) {
    return obj.some(item => hasPrototypePollutionKey(item, depth + 1));
  }
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
    if (hasPrototypePollutionKey((obj as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Safely parses and validates an imported JSON save string (M5-04).
 * Checks byte limit, rejects prototype pollution keys, and verifies schema version & required fields.
 */
export function parseAndValidateSaveImport(rawText: string, maxBytes = MAX_IMPORT_BYTES): SaveData {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('存檔內容為空');
  }
  if (rawText.length > maxBytes) {
    throw new Error('存檔檔案過大（超過 5 MB 上限）');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('存檔 JSON 格式損壞，無法解析');
  }
  if (hasPrototypePollutionKey(parsed)) {
    throw new Error('存檔包含不安全的屬性名稱，已拒絕匯入');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('存檔結構無效');
  }
  const maybeEnv = parsed as Partial<ExportedSaveEnvelope>;
  if (maybeEnv.schemaVersion !== undefined && maybeEnv.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new Error(`不支援較新版本的存檔格式 (schemaVersion=${maybeEnv.schemaVersion})`);
  }
  const candidate = (maybeEnv.save && typeof maybeEnv.save === 'object' ? maybeEnv.save : parsed) as Partial<AnySave>;
  if (typeof candidate.version === 'number' && candidate.version > SAVE_SCHEMA_VERSION) {
    throw new Error(`不支援較新版本的遊戲存檔 (version=${candidate.version})`);
  }
  if (!candidate.settings || typeof candidate.settings.mapId !== 'number') {
    throw new Error('存檔缺少有效的地圖設定 (settings.mapId)');
  }
  if (!Array.isArray(candidate.players) || candidate.players.length === 0 || candidate.players.length > 12) {
    throw new Error('存檔缺少有效的玩家清單 (players)');
  }
  for (const p of candidate.players) {
    if (!p || typeof p.character !== 'number' || p.character < 0 || p.character >= 12) {
      throw new Error('存檔包含無效的角色編號');
    }
  }
  const isTycoon = candidate.kind === 'tycoon';
  if (isTycoon) {
    if (!candidate.world || typeof candidate.world.date !== 'number') {
      throw new Error('大富豪存檔缺少世界日期資料');
    }
  } else if (!candidate.game || typeof candidate.game.date !== 'number') {
    throw new Error('存檔缺少遊戲回合日期資料');
  }
  return {
    ...candidate,
    savedAt: typeof candidate.savedAt === 'number' && candidate.savedAt > 0 ? candidate.savedAt : Date.now(),
  } as SaveData;
}

/** Reads the pre-import backup of a manual slot (`1..5`), if any. */
export function readBackupSlot(slot: number): Promise<SaveData | undefined> {
  return readSlot(BACKUP_BASE + slot);
}

/**
 * Validates and imports a JSON save string into `slot`, keeping the previous occupant in a backup slot (`2000 + slot`)
 * and resolving only after the IndexedDB transaction completes (M5-04, M5-05).
 */
export async function importSaveToSlot(slot: number, rawText: string): Promise<{ restored: SaveData; backup?: SaveData }> {
  if (slot < 1 || slot >= SLOTS || isAuto(slot)) {
    throw new Error('只能匯入至手動存檔槽位 (1..5)');
  }
  const restored = parseAndValidateSaveImport(rawText);
  const backup = await readSlot(slot).catch(() => undefined);
  if (backup) {
    await writeSlot(BACKUP_BASE + slot, backup);
  }
  await writeSlot(slot, restored);
  return { restored, backup };
}

/**
 * The save/load screen (09 §7.11): one row per slot with the game date, the map thumbnail and every player's
 * portrait. `mode` save lists slots 1..5 (the automatic slot is not written by hand); load lists 0..5 and
 * only filled slots can be picked. Resolves with the slot, or -1 when cancelled.
 */
export async function pickSlot(parent: HTMLElement, mode: 'save' | 'load', mapName: (id: number) => string,
                               bank: SpriteBank | null, mapThumb: (id: number) => string): Promise<number> {
  const saves = await listSlots();
  const autos = new Map<number, { id: number; save: SaveData }[]>();
  if (mode === 'load') for (const i of [AUTO_SLOT, TYCOON_AUTO_SLOT]) autos.set(i, await autoSaves(i).catch(() => []));
  const art = (archive: 'Data', id: number, frame: number) => bank?.art(archive, id, frame)?.src ?? '';
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'slots-overlay';
    const box = document.createElement('div');
    box.className = `msg sheet slots ${mode}`;
    box.innerHTML = `<div class="ribbon">${mode === 'save' ? '儲存進度' : '讀取進度'}</div>`;
    const list = document.createElement('div');
    list.className = 'slot-list';
    // Save / load slots (rich4_ui_save_load.asm): hover Effect#0, a slot confirms (#2), cancel #4.
    const done = (v: number) => { audio.ui(v >= 0 ? 'yes' : 'no'); overlay.remove(); resolve(v); };
    /** One save's row: badge, game date, map, faces, when it was saved. */
    const filled = (s: AnySave, badge: string): string => {
      const tycoon = s.kind === 'tycoon';
      // A slot that can't be read as a game (damaged, or from a newer version) shows as such instead of breaking the list.
      try {
        const d = tycoon ? s.world!.date : s.game.date, y = d >>> 16, m = (d >>> 8) & 0xff, dd = d & 0xff;
        const when = new Date(s.savedAt).toLocaleString('zh-Hant', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const thumb = !tycoon && s.settings.mapId < 8 ? art('Data', 520, 2 + s.settings.mapId) : '';
        const name = tycoon ? `大富豪模式・${mapName(s.settings.mapId)}` : mapName(s.settings.mapId);
        // 12 players in a world: the human's face first, the rest still standing, so the row stays one line.
        const faces = tycoon ? [...s.players.filter(p => p.human), ...s.players.filter(p => !p.human && !p.bankrupt)].slice(0, 6) : s.players;
        return `${badge}<span class="slot-date"><small>${y}</small><b>${m}/${dd}</b></span>
          <span class="slot-map">${thumb || mapThumb(s.settings.mapId) ? `<img src="${thumb || mapThumb(s.settings.mapId)}" alt="">` : ''}</span>
          <span class="slot-main"><b class="slot-mapname">${name}</b><span class="slot-faces">${faces.map(p => `<span class="slot-face${p.bankrupt ? ' out' : ''}" title="${CHARACTERS[p.character].name}">${art('Data', 2, p.character) ? `<img src="${art('Data', 2, p.character)}" alt="">` : CHARACTERS[p.character].name}</span>`).join('')}</span></span>
          <span class="slot-when">${when}</span>`;
      } catch { return `${badge}<span class="slot-empty">（存檔無法顯示）</span>`; }
    };
    const button = (html: string, empty: boolean, pick: () => void) => {
      const b = document.createElement('button');
      b.className = `slot-row${empty ? ' empty' : ''}`;
      b.disabled = mode === 'load' && empty;
      b.innerHTML = html;
      b.onclick = pick;
      b.onpointerenter = e => { if (e.pointerType === 'mouse' && !b.disabled) audio.ui('hover'); };
      return b;
    };
    let inAuto = false;
    /** An automatic slot's last five turns, newest first; 返回 goes back to the slots. */
    const showAuto = (i: number) => {
      inAuto = true;
      audio.ui('yes');
      const all = autos.get(i) ?? [];
      list.replaceChildren(Object.assign(document.createElement('div'), { className: 'slot-note', textContent: `自動存檔：最近 ${all.length} 回合（點一個讀取）` }),
        ...all.map(({ id, save }, k) => button(filled(save as AnySave, `<span class="slot-badge auto">${k === 0 ? '最新' : `-${k}`}</span>`), false, () => done(id))));
      cancel.textContent = '返回';
    };
    const showSlots = () => {
      inAuto = false;
      cancel.textContent = '取消';
      list.replaceChildren();
      for (let i = mode === 'save' ? 1 : 0; i < SLOTS; i++) {
        if (mode === 'save' && isAuto(i)) continue;   // automatic slots are not written by hand
        const ring = autos.get(i);
        const s = (ring ? ring[0]?.save : saves[i]) as AnySave | undefined;
        const badge = `<span class="slot-badge${isAuto(i) ? ' auto' : ''}">${isAuto(i) ? 'AUTO' : i}</span>`;
        const more = ring && ring.length > 1 ? `<span class="slot-more">${ring.length} 回合 ▸</span>` : '';
        const html = s ? filled(s, badge).replace('<span class="slot-when">', `<span class="slot-when">${more}`) : `${badge}<span class="slot-empty">${mode === 'save' ? '空白檔位 · 點這裡存檔' : '（空）'}</span>`;
        list.append(button(html, !s, () => (ring && ring.length > 1 ? showAuto(i) : done(ring?.[0]?.id ?? i))));
      }
    };
    const row = document.createElement('div');
    row.className = 'choices';
    const exportBtn = document.createElement('button');
    exportBtn.className = 'candy ghost';
    exportBtn.textContent = '匯出 JSON';
    exportBtn.onclick = () => {
      const idx = saves.findIndex((s, i) => i > 0 && !isAuto(i) && !!s);
      const slot = idx >= 0 ? idx : saves.findIndex(Boolean);
      const target = slot >= 0 ? saves[slot] : autos.get(AUTO_SLOT)?.[0]?.save;
      if (!target) { audio.ui('error'); return; }
      audio.ui('yes');
      downloadSaveJson(target, slot >= 0 ? slot : AUTO_SLOT);
    };
    const importBtn = document.createElement('button');
    importBtn.className = 'candy ghost';
    importBtn.textContent = '匯入 JSON';
    importBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const emptySlot = [1, 2, 3, 4, 5].find(i => !saves[i]) ?? 1;
          const { restored } = await importSaveToSlot(emptySlot, text);
          saves[emptySlot] = restored;
          audio.ui('yes');
          showSlots();
        } catch (err) {
          audio.ui('error');
          alert((err as Error)?.message ?? '匯入失敗');
        }
      };
      input.click();
    };
    const cancel = document.createElement('button');
    cancel.className = 'candy ghost';
    cancel.onclick = () => (inAuto ? (audio.ui('no'), showSlots()) : done(-1));
    row.append(exportBtn, importBtn, cancel);
    showSlots();
    box.append(list, row);
    overlay.append(box);
    overlay.onclick = e => { if (e.target === overlay) done(-1); };
    parent.append(overlay);
  });
}
