/**
 * 派對模式's network (v0.5.0, the user 2026-10-19): friends play one game on their own phones, peer to peer (WebRTC
 * through PeerJS; its free public server only introduces the phones, the game's data goes phone to phone).
 *
 * Lockstep: every phone runs the same game from the same seed (the rules use only the game's own random stream), so
 * only the players' answers travel — a seat's owner sends each of its answers, numbered in the order the game asks;
 * the others wait for that number. The room's host relays (a star), keeps every answer, and sends a phone that comes
 * back after a drop (an iPhone in the background loses the connection) what it missed. Each turn the host also sends
 * a digest of the game; a phone whose game differs says so.
 *
 * Every phone is a host-in-waiting (the user 2026-10-19: "connected, everyone is the host"): every phone keeps every
 * answer and the room's members; when the host leaves (voted out, or gone), the next player in the list takes the
 * room's id over and the others reconnect to it, sending what it lacks. A player voted out (two others agreeing — the
 * host too) leaves; in a game the computer takes the seat over (托管 at its next turn).
 *
 * Rooms: 「建立房間」 makes a room with a 4-digit code (私享: friends type the code in 「進入房間」); a 共享 room is also
 * listed in 「尋找夥伴」. That list needs no server of our own: one phone holds it (the peer id LOBBY); every shared
 * room and every phone looking at the list connects to it, and when it goes another one takes the id over and the
 * rooms announce themselves again.
 */
import Peer, { type DataConnection } from 'peerjs';
import { CHARACTERS } from '../core/characters';
import { watchPartyConnection } from './party-liveness';

const PREFIX = 'rich4-party-v1-';
// v2 (2026-10-20): the list also counts private rooms and seekers; older versions keep their own list (v1).
export const LOBBY = `${PREFIX}lobby-v2`;
const roomId = (code: string) => `${PREFIX}room-${code}`;

/** `nick`: the name the player gave themself (the user 2026-10-19); `name` is it or the character's. */
export interface Member {
  id: string;
  name: string;
  character: number;
  region?: string;
  nick?: string;
  /** In the game: its phone is gone (the host tells everyone). */
  away?: boolean;
  /** One-way SHA-256 commitment of this member's secret reconnect token (never the plaintext token). */
  tokenCommit?: string;
}

/** A nickname as kept and shown: no markup characters, trimmed, at most NICK_MAX characters. */
export const NICK_MAX = 7;
export const cleanNick = (s: unknown) => [...String(s ?? '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim()].slice(0, NICK_MAX).join('');
/** Clamps a character index to a safe integer in 0..11. */
export const safeCharacterIndex = (c: unknown, fallback = 0): number => {
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= 12) return fallback;
  return c;
};
/** The member's shown name: the nickname, else the character's. */
const named = (m: Member) => {
  m.character = safeCharacterIndex(m.character, 0);
  m.nick = cleanNick(m.nick) || undefined;
  m.name = m.nick || CHARACTERS[m.character]?.name || '玩家';
  return m;
};
/** Players in a room (the user 2026-10-19: eight; the game's NPCs come after them, core/game.ts npcBase). */
export const ROOM_MAX = 8;

export const VALID_STICKER_KEYS = new Set(['good', 'laugh', 'cry', 'angry', 'party', 'rich', 'please', 'shock']);

/** A room in the list. `private`: a 私享 room counted only (its code is a random token, never shown or joinable). */
export interface RoomInfo { code: string; host: string; character: number; map: string; players: number; max: number; at: number; region?: string; private?: boolean }
/** The title button's figures (the user 2026-10-20): 私享 rooms open now, and people waiting for partners (the players
 * in shared rooms not started, plus those looking at 「尋找夥伴」). */
export interface LobbyStats { privateRooms: number; waiting: number }
export interface ChatLine { from: string; name: string; character: number; text: string; at: number }

/**
 * The player's region from the phone's time zone (the user 2026-10-19: the region only, no IP lookup — nothing is
 * sent anywhere to find it): a country or area, never a city.
 */
export function myRegion(): string {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { /* unknown */ }
  const exact: Record<string, string> = {
    'Asia/Tokyo': '日本', 'Asia/Taipei': '台灣', 'Asia/Shanghai': '中國大陸', 'Asia/Chongqing': '中國大陸', 'Asia/Harbin': '中國大陸',
    'Asia/Urumqi': '中國大陸', 'Asia/Hong_Kong': '香港', 'Asia/Macau': '澳門', 'Asia/Seoul': '韓國', 'Asia/Singapore': '新加坡',
    'Asia/Kuala_Lumpur': '馬來西亞', 'Asia/Bangkok': '泰國', 'Asia/Manila': '菲律賓', 'Asia/Ho_Chi_Minh': '越南', 'Asia/Jakarta': '印尼',
  };
  if (exact[tz]) return exact[tz];
  const area = tz.split('/')[0];
  return ({ Asia: '亞洲', Europe: '歐洲', America: '美洲', Australia: '澳洲', Pacific: '大洋洲', Africa: '非洲' } as Record<string, string>)[area] ?? '';
}
/** What the host sends when the game starts. */
export interface StartMsg { settings: import('../core/types').GameSettings; seats: Record<string, number>; proto?: number; rules?: string }

export const PARTY_PROTOCOL_VERSION = 1;
export const PARTY_RULES_VERSION = '0.6.6';
export const MAX_PUBLIC_ROOMS = 100;
export const MAX_MSG_BYTES = 65536;
export const MAX_LOG_REPLAY = 5000;

export type Msg =
  | {
      t: 'hi';
      name: string;
      character: number;
      have?: number;
      region?: string;
      prev?: string;
      nick?: string;
      proto?: number;
      rules?: string;
      tokenCommit?: string;
      reconnectToken?: string;
    }
  | { t: 'char'; character: number; nick?: string }
  | { t: 'lobby'; members: Member[]; map: string; shared: boolean }
  | { t: 'start'; start: StartMsg }
  | { t: 'ans'; seq: number; v: unknown; u?: boolean; seat?: number }
  | { t: 'log'; from: number; answers: [unknown, boolean][]; total: number }
  | { t: 'digest'; seq: number; h: number }
  | { t: 'chat'; line: ChatLine }
  | { t: 'vote'; target: string; voter: string }
  | { t: 'votes'; target: string; voters: string[] }
  | { t: 'kicked'; id: string; seat?: number }
  | { t: 'ping' | 'pong' }
  | { t: 'bye'; why?: string; retry?: boolean };

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomBytes(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < size; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return buf;
}

/**
 * Generates a high-entropy alphanumeric room invitation code (6 chars = 30 bits of entropy, >1 billion combinations)
 * using CSPRNG instead of predictable 4-digit `Math.random()`.
 */
export function generateRoomCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return out;
}

/** Generates a 128-bit secret reconnect token for Commit-Reveal session authentication. */
export function generateReconnectToken(): string {
  const bytes = randomBytes(16);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Pure synchronous SHA-256 (FIPS 180-4) for Commit-Reveal reconnect token hashing across all browser/test contexts.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function commitReconnectToken(token: string): string {
  const bytes = new TextEncoder().encode(`rich4-reconnect-v1:${token}`);
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 9 + 63) & ~63);
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0, false);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => v.toString(16).padStart(8, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a reconnect identity claim (`hi.prev`) against the member's SHA-256 token commitment (P0-2 fix).
 * Prevents any third party who knows the room code and target Peer ID from hijacking a player's seat.
 */
export function verifyReconnectClaim(
  members: readonly Member[],
  prevId: string,
  reconnectToken: string | undefined,
  prevConnectionStillOpen: boolean,
): { ok: true; member: Member } | { ok: false; reason: string } {
  if (prevConnectionStillOpen) {
    return { ok: false, reason: 'peer-still-active' };
  }
  const target = members.find(m => m.id === prevId);
  if (!target) {
    return { ok: false, reason: 'unknown-prev-peer' };
  }
  if (!target.tokenCommit || typeof reconnectToken !== 'string' || reconnectToken.length < 16 || reconnectToken.length > 128) {
    return { ok: false, reason: 'missing-reconnect-token' };
  }
  const actualCommit = commitReconnectToken(reconnectToken);
  if (!constantTimeEqual(actualCommit, target.tokenCommit)) {
    return { ok: false, reason: 'invalid-reconnect-token' };
  }
  return { ok: true, member: target };
}

/**
 * Two-phase reconnect token rotation state machine (P1-02 fix).
 * Prevents premature rotation of `confirmedToken` before the host acknowledges the new `tokenCommit`.
 */
export interface ReconnectTokenState {
  /** Token currently committed on the host (used as `reconnectToken` proof until host confirms rotation). */
  confirmedToken: string;
  /** Peer ID currently registered on the host (`undefined` before first host confirmation). */
  confirmedPeerId?: string;
  /** Candidate next token whose `tokenCommit` was sent in `hi`, awaiting host acknowledgment. */
  pendingToken?: string;
  /** Candidate Peer ID used in the in-flight `hi` handshake. */
  pendingPeerId?: string;
}

export function createReconnectTokenState(initialToken = generateReconnectToken()): ReconnectTokenState {
  return { confirmedToken: initialToken };
}

/**
 * Prepares a `hi` handshake without prematurely discarding `confirmedToken` (P1-02 fix).
 * If a previous reconnect attempt dropped before host acknowledgment, `confirmedToken` is preserved
 * so subsequent retries still prove ownership against the host's stored `tokenCommit`.
 */
export function prepareReconnectHandshake(
  state: ReconnectTokenState,
  currentPeerId: string,
  explicitPrevPeerId?: string,
): {
  prev?: string;
  reconnectToken?: string;
  tokenCommit: string;
} {
  const prev = explicitPrevPeerId ?? state.confirmedPeerId;
  const isReconnect = Boolean(prev);
  if (!isReconnect) {
    state.pendingPeerId = currentPeerId;
    state.pendingToken = undefined;
    return {
      tokenCommit: commitReconnectToken(state.confirmedToken),
    };
  }
  if (!state.pendingToken) {
    state.pendingToken = generateReconnectToken();
  }
  state.pendingPeerId = currentPeerId;
  return {
    prev,
    reconnectToken: state.confirmedToken,
    tokenCommit: commitReconnectToken(state.pendingToken),
  };
}

/**
 * Commits the token rotation ONLY after the host acknowledges the peer in `lobby`
 * with matching `tokenCommit` (P1-02 fix).
 */
export function confirmReconnectHandshake(
  state: ReconnectTokenState,
  ackedPeerId: string,
  ackedTokenCommit?: string,
): boolean {
  if (!ackedPeerId || (state.pendingPeerId && ackedPeerId !== state.pendingPeerId)) {
    return false;
  }
  if (state.pendingToken) {
    const expectedCommit = commitReconnectToken(state.pendingToken);
    if (!ackedTokenCommit || !constantTimeEqual(ackedTokenCommit, expectedCommit)) {
      return false;
    }
    state.confirmedToken = state.pendingToken;
    state.pendingToken = undefined;
  } else if (ackedTokenCommit) {
    const expectedCommit = commitReconnectToken(state.confirmedToken);
    if (!constantTimeEqual(ackedTokenCommit, expectedCommit)) {
      return false;
    }
  }
  state.confirmedPeerId = ackedPeerId;
  state.pendingPeerId = undefined;
  return true;
}

/**
 * Verifies that an incoming `ans` lockstep action was sent by the peer who actually owns the seat
 * for an ALREADY OPENED question `seq` (P0-2 & P1-01 fix).
 * Rejects any unopened/future `seq` (`expectedSeats.get(seq) === undefined`) so peers cannot pre-inject future answers.
 */
export function authorizeSeatAnswer(
  seats: Record<string, number> | undefined,
  kickedSeats: ReadonlySet<number>,
  expectedSeats: ReadonlyMap<number, number>,
  peerId: string,
  seq: number,
  claimedSeat?: number,
): { ok: true; seat: number } | { ok: false; reason: string } {
  if (!seats) {
    return { ok: false, reason: 'game-not-started' };
  }
  const ownedSeat = seats[peerId];
  if (typeof ownedSeat !== 'number' || !Number.isInteger(ownedSeat) || ownedSeat < 0) {
    return { ok: false, reason: 'no-seat-owned' };
  }
  if (kickedSeats.has(ownedSeat)) {
    return { ok: false, reason: 'seat-kicked' };
  }
  if (claimedSeat !== undefined && claimedSeat !== ownedSeat) {
    return { ok: false, reason: 'seat-mismatch' };
  }
  const expectedSeat = expectedSeats.get(seq);
  if (expectedSeat === undefined) {
    return { ok: false, reason: 'unopened-question-seq' };
  }
  if (expectedSeat !== ownedSeat) {
    return { ok: false, reason: 'not-active-turn-seat' };
  }
  return { ok: true, seat: ownedSeat };
}

export interface PartyNetConfig {
  peerServer?: {
    host?: string;
    port?: number;
    path?: string;
    secure?: boolean;
  };
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}

const NET_CONFIG_KEY = 'rich4.netConfig';
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

let runtimeNetConfig: PartyNetConfig | null = null;
let fetchedConfigUntil = 0;
let fetchingConfig: Promise<void> | null = null;

/** Optional private staging endpoint; short-lived relay credentials stay in memory. */
export async function refreshPartyNetConfig(): Promise<void> {
  const path = typeof document !== 'undefined'
    ? document.querySelector<HTMLMetaElement>('meta[name="rich4-party-config"]')?.content : undefined;
  if (!path || Date.now() < fetchedConfigUntil) return;
  if (fetchingConfig) return fetchingConfig;
  fetchingConfig = (async () => {
    const url = new URL(path, location.href);
    if (url.origin !== location.origin) throw new Error('Party configuration must use the same origin');
    const response = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Party configuration unavailable');
    const cfg = await response.json() as PartyNetConfig & { expiresAt: number };
    if (!Number.isFinite(cfg.expiresAt) || cfg.expiresAt < Date.now() + 60000 || cfg.expiresAt > Date.now() + 86400000 ||
      !Array.isArray(cfg.iceServers) || !cfg.iceServers.length) throw new Error('Invalid or expired party configuration');
    setPartyNetConfig({ ...cfg, ...(new URL(location.href).searchParams.get('relay') === '1' ? { iceTransportPolicy: 'relay' as const } : {}) });
    fetchedConfigUntil = cfg.expiresAt - 60000;
  })();
  try { await fetchingConfig; } finally { fetchingConfig = null; }
}

/** Sets or overrides the runtime PeerJS / STUN / ephemeral TURN configuration (M5-01, M5-02). */
export function setPartyNetConfig(cfg: PartyNetConfig | null): void {
  runtimeNetConfig = cfg;
  if (!cfg) fetchedConfigUntil = 0;
}

/** Resolves the active PeerJS & ICE configuration without any hardcoded long-lived TURN credentials. */
export function resolvePartyNetConfig(): { iceServers: RTCIceServer[]; peerServer?: PartyNetConfig['peerServer']; iceTransportPolicy?: RTCIceTransportPolicy } {
  let merged: PartyNetConfig = {};
  try {
    const winCfg = (typeof window !== 'undefined' ? (window as unknown as { __RICH4_NET_CONFIG__?: PartyNetConfig }).__RICH4_NET_CONFIG__ : undefined);
    if (winCfg && typeof winCfg === 'object') merged = { ...merged, ...winCfg };
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(NET_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PartyNetConfig;
        if (parsed && typeof parsed === 'object') merged = { ...merged, ...parsed };
      }
    }
  } catch { /* ignore storage parse error */ }
  if (runtimeNetConfig) merged = { ...merged, ...runtimeNetConfig };
  const iceServers = Array.isArray(merged.iceServers) && merged.iceServers.length > 0
    ? merged.iceServers
    : DEFAULT_ICE_SERVERS;
  return { iceServers, peerServer: merged.peerServer, iceTransportPolicy: merged.iceTransportPolicy };
}

export const ICE_SERVERS: RTCIceServer[] = DEFAULT_ICE_SERVERS;

export function buildPeerOptions() {
  const cfg = resolvePartyNetConfig();
  return {
    debug: 0,
    ...(cfg.peerServer ?? {}),
    config: { iceServers: cfg.iceServers, ...(cfg.iceTransportPolicy ? { iceTransportPolicy: cfg.iceTransportPolicy } : {}) },
  };
}

const SAFE_PEER_ID_RE = /^[a-zA-Z0-9_.:-]{1,128}$/;

/**
 * Validates incoming P2P messages for structural safety, byte size cap, protocol compatibility,
 * sequence bounds, and strict chat/seat schema (P0-1 & P0-2 & M5-03).
 */
export function validateIncomingMsg(
  raw: unknown,
  maxBytes = MAX_MSG_BYTES,
): { ok: true; msg: Msg } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid-object' };
  }
  try {
    const str = JSON.stringify(raw);
    if (str.length > maxBytes) return { ok: false, reason: 'message-too-large' };
  } catch {
    return { ok: false, reason: 'unserializable' };
  }
  const m = raw as Partial<Msg> & { t?: unknown };
  if (typeof m.t !== 'string') return { ok: false, reason: 'missing-type' };
  switch (m.t) {
    case 'hi':
      if (typeof m.character !== 'number' || !Number.isInteger(m.character) || m.character < 0 || m.character >= 12) {
        return { ok: false, reason: 'invalid-character' };
      }
      if (m.proto !== undefined && m.proto !== PARTY_PROTOCOL_VERSION) {
        return { ok: false, reason: 'version-mismatch' };
      }
      if (m.prev !== undefined && (typeof m.prev !== 'string' || !SAFE_PEER_ID_RE.test(m.prev))) {
        return { ok: false, reason: 'invalid-prev-id' };
      }
      if (m.tokenCommit !== undefined && (typeof m.tokenCommit !== 'string' || !/^[0-9a-f]{64}$/.test(m.tokenCommit))) {
        return { ok: false, reason: 'invalid-token-commit' };
      }
      if (m.reconnectToken !== undefined && (typeof m.reconnectToken !== 'string' || m.reconnectToken.length > 128)) {
        return { ok: false, reason: 'invalid-reconnect-token' };
      }
      return { ok: true, msg: m as Msg };
    case 'char':
      if (typeof m.character !== 'number' || !Number.isInteger(m.character) || m.character < 0 || m.character >= 12) {
        return { ok: false, reason: 'invalid-character' };
      }
      return { ok: true, msg: m as Msg };
    case 'ans':
      if (typeof m.seq !== 'number' || !Number.isInteger(m.seq) || m.seq < 0 || m.seq > MAX_LOG_REPLAY) {
        return { ok: false, reason: 'invalid-seq' };
      }
      if (m.seat !== undefined && (typeof m.seat !== 'number' || !Number.isInteger(m.seat) || m.seat < 0 || m.seat >= ROOM_MAX)) {
        return { ok: false, reason: 'invalid-seat' };
      }
      return { ok: true, msg: m as Msg };
    case 'chat': {
      if (!m.line || typeof m.line !== 'object' || Array.isArray(m.line)) {
        return { ok: false, reason: 'invalid-chat' };
      }
      const l = m.line as unknown as Record<string, unknown>;
      if (typeof l.character !== 'number' || !Number.isInteger(l.character) || l.character < -1 || l.character >= 12) {
        return { ok: false, reason: 'invalid-chat-character' };
      }
      if (typeof l.text !== 'string') {
        return { ok: false, reason: 'invalid-chat' };
      }
      const trimmedText = l.text.trim();
      if (!trimmedText || trimmedText.length > 200) {
        return { ok: false, reason: 'invalid-chat-text' };
      }
      // If formatted like a reaction sticker `[s:...]`, strictly enforce whitelist key
      if (trimmedText.startsWith('[s:') || trimmedText.endsWith(']')) {
        const stickerMatch = /^\[s:([a-z]+)\]$/.exec(trimmedText);
        if (trimmedText.startsWith('[s:') && (!stickerMatch || !VALID_STICKER_KEYS.has(stickerMatch[1]))) {
          return { ok: false, reason: 'invalid-chat-sticker' };
        }
      }
      const from = typeof l.from === 'string' ? l.from : '';
      if (from && !SAFE_PEER_ID_RE.test(from)) {
        return { ok: false, reason: 'invalid-chat-sender' };
      }
      const rawName = typeof l.name === 'string' ? l.name : '';
      const cleanLine: ChatLine = {
        from,
        name: cleanNick(rawName) || (l.character === -1 ? '系統' : CHARACTERS[l.character]?.name || '玩家'),
        character: l.character,
        text: trimmedText.slice(0, 40),
        at: typeof l.at === 'number' && Number.isFinite(l.at) ? l.at : Date.now(),
      };
      return { ok: true, msg: { t: 'chat', line: cleanLine } };
    }
    case 'vote':
      if (typeof m.target !== 'string' || !SAFE_PEER_ID_RE.test(m.target)) {
        return { ok: false, reason: 'invalid-vote' };
      }
      return { ok: true, msg: m as Msg };
    case 'lobby':
    case 'start':
    case 'log':
    case 'digest':
    case 'votes':
    case 'kicked':
    case 'bye':
    case 'ping':
    case 'pong':
      return { ok: true, msg: m as Msg };
    default:
      return { ok: false, reason: 'unknown-type' };
  }
}

/** A PeerJS peer with a given id, or null when the id is taken (another phone has it). */
async function open(id?: string): Promise<Peer | null> {
  try { await refreshPartyNetConfig(); } catch { return null; }
  return new Promise(resolve => {
    const opts = buildPeerOptions();
    const p = id ? new Peer(id, opts) : new Peer(opts);
    let done = false;
    p.on('open', () => { if (!done) { done = true; resolve(p); } });
    p.on('error', e => {
      if (done) return;
      done = true;
      p.destroy();
      resolve((e as { type?: string }).type === 'unavailable-id' ? null : null);
    });
    setTimeout(() => { if (!done) { done = true; p.destroy(); resolve(null); } }, 12000);
  });
}

async function connect(peer: Peer, id: string): Promise<DataConnection | null> {
  try {
    await refreshPartyNetConfig();
    if (peer.options) peer.options.config = buildPeerOptions().config;
  } catch { return null; }
  return new Promise(resolve => {
    let c: DataConnection;
    try { c = peer.connect(id, { reliable: true }); } catch { resolve(null); return; }
    let done = false;
    const finish = (accepted: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.off('error', peerError);
      if (!accepted) c.close();
      resolve(accepted ? c : null);
    };
    const fail = () => finish(false);
    const peerError = (e: unknown) => { if ((e as { type?: string }).type === 'peer-unavailable') fail(); };
    const timer = setTimeout(fail, 10000);
    c.on('open', () => finish(true));
    c.on('error', fail);
    peer.on('error', peerError);
  });
}

/** The 「尋找夥伴」 list: held by whichever phone has the LOBBY id (see the header). */
export class Lobby {
  rooms = new Map<string, RoomInfo>();
  onRooms: (rooms: RoomInfo[]) => void = () => {};
  private peer: Peer | null = null;
  private holder: Peer | null = null;
  private conns = new Set<DataConnection>();
  private toHolder: DataConnection | null = null;
  private timer = 0;
  private closed = false;
  private mine: RoomInfo | null = null;
  /** This phone looks at 「尋找夥伴」 (counted as waiting for partners). */
  seeking = false;
  /** Seekers by connection (the holder's bookkeeping), last seen. */
  private seekers = new Map<DataConnection, number>();
  stats: LobbyStats = { privateRooms: 0, waiting: 0 };
  onStats: (s: LobbyStats) => void = () => {};

  /** Starts watching (and announcing `room` every 8 s while set). */
  async start(room?: RoomInfo, seeking = false): Promise<void> {
    this.mine = room ?? null;
    this.seeking = seeking;
    void this.loop();
  }
  announce(room: RoomInfo | null) { this.mine = room; this.push(); }

  private all(): RoomInfo[] {
    const now = Date.now();
    for (const [k, r] of this.rooms) if (now - r.at > 25000) this.rooms.delete(k);
    return [...this.rooms.values()].sort((a, b) => b.at - a.at);
  }
  /** The shared rooms (private ones are only counted). */
  private list(): RoomInfo[] { return this.all().filter(r => !r.private); }
  private count(): LobbyStats {
    const now = Date.now();
    for (const [c, at] of this.seekers) if (!c.open || now - at > 25000) this.seekers.delete(c);
    const rooms = this.all();
    return {
      privateRooms: rooms.filter(r => r.private).length,
      waiting: rooms.filter(r => !r.private).reduce((a, r) => a + r.players, 0) + this.seekers.size + (this.seeking ? 1 : 0),
    };
  }
  private push() {
    if (this.holder) {
      if (this.mine) this.rooms.set(this.mine.code, { ...this.mine, at: Date.now() });
      const rooms = this.list(), stats = this.count();
      for (const c of this.conns) c.open && c.send({ t: 'rooms', rooms, stats });
      this.onRooms(rooms);
      this.stats = stats; this.onStats(stats);
    } else if (this.toHolder?.open) {
      this.toHolder.send(this.mine ? { t: 'room', room: { ...this.mine, at: Date.now() } } : { t: 'list', seek: this.seeking });
    }
  }

  private async loop() {
    while (!this.closed) {
      if (!this.holder && !this.toHolder?.open) {
        // Join the list's holder, else become it.
        this.peer ??= await open();
        const c = this.peer && await connect(this.peer, LOBBY);
        if (c) {
          this.toHolder = c;
          c.on('data', d => {
            const m = d as { t: string; rooms?: RoomInfo[]; stats?: LobbyStats };
            if (m.t === 'rooms' && m.rooms) { this.rooms = new Map(m.rooms.map(r => [r.code, r])); this.onRooms(this.list()); }
            if (m.t === 'rooms' && m.stats) { this.stats = m.stats; this.onStats(m.stats); }
          });
          c.on('close', () => { this.toHolder = null; });
        } else {
          const h = await open(LOBBY);
          if (h) {
            this.holder = h;
            h.on('connection', c2 => {
              this.conns.add(c2);
              c2.on('data', d => {
                const m = d as { t: string; room?: RoomInfo; code?: string; seek?: boolean };
                if (m.t === 'room' && m.room && typeof m.room.code === 'string' && m.room.code.length <= 16) {
                  if (this.rooms.size < MAX_PUBLIC_ROOMS || this.rooms.has(m.room.code)) {
                    this.rooms.set(m.room.code, { ...m.room, at: Date.now() });
                  }
                }
                if (m.t === 'room-off' && m.code) this.rooms.delete(m.code);
                if (m.t === 'list') { if (m.seek) this.seekers.set(c2, Date.now()); else this.seekers.delete(c2); }
                this.push();
              });
              c2.on('close', () => { this.conns.delete(c2); this.seekers.delete(c2); });
            });
            h.on('disconnected', () => { if (!this.closed) h.reconnect(); });
          }
        }
      }
      this.push();
      await wait(8000);
    }
  }

  close() {
    this.closed = true;
    if (this.mine && this.toHolder?.open) this.toHolder.send({ t: 'room-off', code: this.mine.code });
    clearTimeout(this.timer);
    this.toHolder?.close();
    this.holder?.destroy();
    this.peer?.destroy();
  }
}

/** One room: the host's side or a guest's (and a guest that becomes the host). */
export class Room {
  code = '';
  host = false;
  /** The players; [0] is the host. */
  members: Member[] = [];
  map = '';
  shared = false;
  started: StartMsg | null = null;
  /** The player seats this phone plays. */
  mine = new Set<number>();
  onLobby: () => void = () => {};
  onStart: (s: StartMsg) => void = () => {};
  onStatus: (text: string) => void = () => {};
  /** A host digest arrived after our turn and disagrees with our saved digest. */
  onDesync: (seq: number) => void = () => {};
  /** Chat (the user 2026-10-19: text only; a sender can be muted on this phone). */
  chat: ChatLine[] = [];
  onChat: (line: ChatLine) => void = () => {};
  muted = new Set<string>();
  /** Kick votes: target → voters; two others agreeing send anyone (the host too) away. */
  votes = new Map<string, Set<string>>();
  onVotes: () => void = () => {};
  /** Seats of players sent away: the host answers them for the computer (托管 at their next turn). */
  kickedSeats = new Set<number>();
  /** This phone was sent away (the game screen goes back to the title). */
  kicked = false;
  private kickedIds = new Set<string>();

  private peer: Peer | null = null;
  private guests = new Map<string, DataConnection>();
  private toHost: DataConnection | null = null;
  private lostHost = '';
  private rejoining = false;
  private log: [unknown, boolean][] = [];
  private waiters = new Map<number, { promise: Promise<unknown>; resolve: (v: unknown) => void }>();
  private pendingAnswers = new Map<number, Extract<Msg, { t: 'ans' }>>();
  private digests = new Map<number, number>();
  private localDigests = new Map<number, number>();
  /** Maps question `seq` -> expected player `seat` so the host rejects spoofed or premature answers. */
  private expectedSeats = new Map<number, number>();
  /** Holds at most one unverified in-flight answer per `(peerId, seq)` when a guest's packet arrives slightly before host's `expectQuestionSeat(seq)`. */
  private unverifiedAnswers = new Map<string, { peer: string; seq: number; v: unknown; seat?: number }>();
  private tokenState = createReconnectTokenState();
  private closed = false;
  myId = '';

  constructor(readonly me: { name: string; character: number; region?: string; nick?: string }) {}

  /** Host: a new room; resolves with its code. */
  async create(map: string, shared: boolean): Promise<string> {
    this.map = map; this.shared = shared;
    let peer: Peer | null = null;
    for (let k = 0; k < 6 && !peer; k++) {
      const code = generateRoomCode(6);
      peer = await open(roomId(code));
      if (peer) this.code = code;
    }
    if (!peer) throw new Error('無法建立房間（網路連不上）');
    this.tokenState.confirmedPeerId = peer.id;
    this.members = [named({ id: peer.id, ...this.me, tokenCommit: commitReconnectToken(this.tokenState.confirmedToken) })];
    this.becomeHost(peer);
    return this.code;
  }

  /** Host: whether the phone playing `seat` is connected now (this phone's own seats always are). */
  ownerConnected(seat: number): boolean {
    const id = this.started ? Object.keys(this.started.seats).find(k => this.started!.seats[k] === seat) : undefined;
    return !id || id === this.myId || !!this.guests.get(id)?.open;
  }
  /** This phone reaches the room (the host, or a guest with its host connection up). */
  connected(): boolean { return this.host || !!this.toHost?.open; }
  private connWaiters: (() => void)[] = [];
  untilConnected(): Promise<void> { return this.connected() ? Promise.resolve() : new Promise(r => this.connWaiters.push(r)); }
  private hostWaiters: (() => void)[] = [];
  /** Resolves when this phone becomes the host (a hand-over): it then answers the seats sent away. */
  untilHost(): Promise<void> { return this.host ? Promise.resolve() : new Promise(r => this.hostWaiters.push(r)); }

  /** The room's id is this phone's: it hosts. */
  private becomeHost(peer: Peer) {
    const prev = this.myId;
    this.peer?.destroy();
    this.peer = peer;
    this.host = true;
    this.toHost = null;
    this.myId = peer.id;
    if (this.tokenState.pendingToken) {
      this.tokenState.confirmedToken = this.tokenState.pendingToken;
      this.tokenState.pendingToken = undefined;
    }
    this.tokenState.confirmedPeerId = peer.id;
    this.tokenState.pendingPeerId = undefined;
    if (prev && prev !== peer.id) this.rename(prev, peer.id, commitReconnectToken(this.tokenState.confirmedToken));
    const me = this.members.find(x => x.id === this.myId);
    if (me) this.members = [me, ...this.members.filter(x => x !== me)];
    peer.on('connection', c => this.guest(c));
    peer.on('disconnected', () => { if (!this.closed && this.host) peer.reconnect(); });
    // Back from the background with the room's id taken by a new host: join it as a guest.
    peer.on('error', e => { if (!this.closed && this.host && (e as { type?: string }).type === 'unavailable-id') void this.demote(); });
    for (const w of this.hostWaiters.splice(0)) w();
    for (const w of this.connWaiters.splice(0)) w();
  }

  /** A player's peer id changed (a phone that became the host, or came back with a new verified connection). */
  private rename(prev: string, id: string, nextTokenCommit?: string) {
    for (const m of this.members) {
      if (m.id === prev) {
        m.id = id;
        if (nextTokenCommit) m.tokenCommit = nextTokenCommit;
      }
    }
    if (this.started && prev !== id && prev in this.started.seats) {
      this.started.seats[id] = this.started.seats[prev];
      delete this.started.seats[prev];
    }
  }

  /** Guest: joins the room with that code. */
  async join(code: string): Promise<void> {
    this.code = code.trim().toUpperCase();
    const peer = await open();
    if (!peer) throw new Error('網路連不上');
    this.asGuest(peer);
    if (!(await this.reach())) {
      this.close();
      throw new Error('房主尚未確認加入\n請確認雙方版本與網路後再試一次');
    }
  }

  private asGuest(peer: Peer) {
    this.peer = peer;
    this.host = false;
    this.myId = peer.id;
    peer.on('disconnected', () => { if (!this.closed && !this.host) peer.reconnect(); });
  }

  /** A host whose room id another phone has taken over: a guest of the new host. */
  private async demote() {
    const prev = this.myId;
    for (const c of this.guests.values()) c.close();
    this.guests.clear();
    this.peer?.destroy();
    this.peer = null;
    const peer = await open();
    if (!peer || this.closed) return;
    this.asGuest(peer);
    await this.reach(prev);
    if (!this.toHost) void this.rejoin();
  }

  private async reach(prev?: string): Promise<boolean> {
    const c = this.peer && await connect(this.peer, roomId(this.code));
    if (!c) return false;
    this.toHost = c;
    let acknowledge: (accepted: boolean) => void = () => {};
    const acknowledged = new Promise<boolean>(resolve => { acknowledge = resolve; });
    const timer = setTimeout(() => acknowledge(false), 8000);
    c.on('data', d => {
      const checked = validateIncomingMsg(d);
      if (checked.ok) {
        const m = checked.msg;
        this.fromHost(m);
        if (m.t === 'lobby' && m.members.some(member => member.id === this.myId) || m.t === 'log' && this.started) acknowledge(true);
        if (m.t === 'bye') acknowledge(false);
      }
    });
    c.on('close', () => { acknowledge(false); if (this.toHost === c) { this.toHost = null; if (!this.closed && !this.host) void this.rejoin(); } });
    watchPartyConnection(c);
    const hs = prepareReconnectHandshake(this.tokenState, this.myId, prev);
    try { c.send({
      t: 'hi',
      name: this.me.name,
      character: this.me.character,
      ...(this.me.region ? { region: this.me.region } : {}),
      ...(this.me.nick ? { nick: this.me.nick } : {}),
      ...(this.started ? { have: this.log.length } : {}),
      proto: PARTY_PROTOCOL_VERSION,
      rules: PARTY_RULES_VERSION,
      // BinaryPack encodes an explicit undefined property as null. Spreading
      // the handshake omits absent prev/reconnect fields so validation survives.
      ...hs,
    } satisfies Msg); } catch { acknowledge(false); }
    const accepted = await acknowledged;
    clearTimeout(timer);
    if (!accepted) { if (this.toHost === c) this.toHost = null; c.close(); return false; }
    for (const w of this.connWaiters.splice(0)) w();
    return true;
  }

  /**
   * The host is gone (the phone slept, the network dropped, it was voted out): try it again; the next player in the
   * list (after the lost host) takes the room's id over when it is free, and the others reconnect to it.
   */
  private async rejoin() {
    if (this.rejoining) return;
    this.rejoining = true;
    const lost = this.lostHost || this.members[0]?.id || '';
    this.onStatus('與房主的連線中斷，重新連線中…');
    for (let k = 0; !this.closed && !this.toHost && !this.host; k++) {
      await wait(Math.min(2000 + k * 1000, 6000));
      if (this.closed || this.host) break;
      if (await this.reach()) break;
      const next = this.members.find(x => x.id !== lost);
      if (next?.id === this.myId && k >= 1) {
        const p = await open(roomId(this.code));
        if (p) { this.becomeHost(p); this.onStatus(''); this.heard({ from: '', name: '系統', character: -1, text: '你成為新的房主', at: Date.now() }); break; }
      }
    }
    this.lostHost = '';
    this.rejoining = false;
    if (this.toHost) this.onStatus('');
  }

  private guest(c: DataConnection) {
    watchPartyConnection(c);
    c.on('data', d => {
      const checked = validateIncomingMsg(d);
      if (!checked.ok) {
        if (checked.reason === 'version-mismatch') {
          c.send({ t: 'bye', why: '遊戲版本不一致，請重新整理網頁更新後再連線' } satisfies Msg);
        }
        return;
      }
      const m = checked.msg;
      if (this.kickedIds.has(c.peer)) { c.send({ t: 'bye', why: '你已被投票請出房間' } satisfies Msg); return; }
      if (m.t === 'hi') {
        const claimedPrev = m.prev || (this.members.some(x => x.id === c.peer) ? c.peer : undefined);
        if (claimedPrev) {
          if (this.kickedIds.has(claimedPrev)) {
            c.send({ t: 'bye', why: '你已被投票請出房間' } satisfies Msg);
            return;
          }
          const existingConn = this.guests.get(claimedPrev);
          const stillOpen = Boolean(existingConn && existingConn !== c && existingConn.open);
          const verified = verifyReconnectClaim(this.members, claimedPrev, m.reconnectToken, stillOpen);
          if (!verified.ok) {
            c.send({ t: 'bye', why: '重連身分驗證失敗', ...(verified.reason === 'peer-still-active' ? { retry: true } : {}) } satisfies Msg);
            return;
          }
          this.rename(claimedPrev, c.peer, m.tokenCommit);
        } else if (this.started) {
          // Once a game has started, strangers who do not hold an existing seat token cannot join mid-game.
          c.send({ t: 'bye', why: '遊戲已經開始' } satisfies Msg);
          return;
        }
        this.guests.set(c.peer, c);
        if (this.started) {
          // Back after a drop, or to a new host: what it missed; it sends back what this phone lacks.
          const from = Math.max(0, Math.min(m.have ?? 0, this.log.length));
          c.send({ t: 'log', from, answers: this.log.slice(from), total: this.log.length } satisfies Msg);
          for (const x of this.members) if (x.id === c.peer) x.away = false;
          this.lobbyChanged();
          this.onStatus('');
          return;
        }
        if (!this.members.some(x => x.id === c.peer)) {
          if (this.members.length >= ROOM_MAX) { c.send({ t: 'bye' } satisfies Msg); return; }
          this.members.push(
            named({
              id: c.peer,
              name: m.name,
              character: this.freeCharacter(m.character, c.peer),
              region: m.region,
              nick: m.nick,
              tokenCommit: m.tokenCommit,
            }),
          );
        }
        this.lobbyChanged();
      } else if (m.t === 'char') {
        const x = this.members.find(y => y.id === c.peer);
        if (x && !this.started) { x.character = this.freeCharacter(m.character, c.peer); x.nick = m.nick; named(x); this.lobbyChanged(); }
      } else if (m.t === 'ans') {
        // Strictly verify that `c.peer` is a room member AND owns the seat expected to answer `m.seq` (P0-2 & P1-01 fix).
        if (!this.members.some(y => y.id === c.peer)) return;
        if (m.seq < this.log.length && this.log[m.seq] !== undefined) {
          const [v, u] = this.log[m.seq];
          c.send({ t: 'ans', seq: m.seq, v: v ?? null, u } satisfies Msg);
          return;
        }
        const auth = authorizeSeatAnswer(
          this.started?.seats,
          this.kickedSeats,
          this.expectedSeats,
          c.peer,
          m.seq,
          m.seat,
        );
        if (!auth.ok) {
          // If the active seat's packet arrived slightly before the host reached `expectQuestionSeat(m.seq)` (within +4 of current log),
          // stage it in an isolated unverified buffer keyed by `(peer, seq)` without touching `this.log` or broadcasting.
          if (auth.reason === 'unopened-question-seq' && m.seq >= this.log.length && m.seq <= this.log.length + 4) {
            this.unverifiedAnswers.set(`${c.peer}:${m.seq}`, {
              peer: c.peer,
              seq: m.seq,
              v: m.u ? undefined : m.v,
              seat: m.seat,
            });
          }
          return;
        }
        this.record(m.seq, m.u ? undefined : m.v, true);
      } else if (m.t === 'chat') {
        const sender = this.members.find(y => y.id === c.peer);
        if (!sender) return;
        const cleanText = String(m.line.text ?? '').trim().slice(0, 40);
        if (!cleanText) return;
        // Construct ChatLine from authoritative host member state, never trusting remote `m.line.character` or `m.line.name`
        this.heard({
          from: c.peer,
          name: sender.name,
          character: safeCharacterIndex(sender.character, 0),
          text: cleanText,
          at: Date.now(),
        });
      } else if (m.t === 'vote') {
        if (!this.members.some(y => y.id === c.peer)) return;
        this.voted(m.target, c.peer);
      }
    });
    c.on('close', () => {
      if (this.guests.get(c.peer) !== c) return;
      this.guests.delete(c.peer);
      if (!this.started) { this.members = this.members.filter(x => x.id !== c.peer); this.lobbyChanged(); }
      else if (!this.closed) { for (const x of this.members) if (x.id === c.peer) x.away = true; this.lobbyChanged(); this.onStatus('有玩家斷線，等待他回來…'); }
    });
  }

  freeCharacter(want: number, id: string): number {
    const used = new Set(this.members.filter(x => x.id !== id).map(x => x.character));
    let c = safeCharacterIndex(want, 0);
    for (let k = 0; k < 12 && used.has(c); k++) c = (c + 1) % 12;
    return c;
  }

  private lobbyChanged() {
    const m: Msg = { t: 'lobby', members: this.members, map: this.map, shared: this.shared };
    for (const c of this.guests.values()) c.open && c.send(m);
    this.onLobby();
  }
  setMap(map: string) { this.map = map; this.lobbyChanged(); }
  /** This phone's character and nickname (in the room, before the game). */
  setCharacter(c: number, nick = this.me.nick) {
    const safeChar = safeCharacterIndex(c, 0);
    this.me.character = safeChar; this.me.nick = cleanNick(nick) || undefined;
    if (this.host) { const x = this.members[0]; x.character = this.freeCharacter(safeChar, x.id); x.nick = this.me.nick; named(x); this.lobbyChanged(); }
    else this.toHost?.send({ t: 'char', character: safeChar, nick: this.me.nick } satisfies Msg);
  }

  private fromHost(m: Msg) {
    if (m.t === 'lobby') {
      this.members = m.members.map(x => named({ ...x }));
      const meInLobby = this.members.find(x => x.id === this.myId);
      if (meInLobby) {
        confirmReconnectHandshake(this.tokenState, this.myId, meInLobby.tokenCommit);
      }
      this.map = m.map;
      this.shared = m.shared;
      this.onLobby();
      this.onVotes();
    }
    else if (m.t === 'start') { this.begin(m.start); }
    else if (m.t === 'ans') this.record(m.seq, m.u ? undefined : m.v, false);
    else if (m.t === 'log') {
      m.answers.forEach(([v, u], k) => this.record(m.from + k, u ? undefined : v, false));
      // This phone has answers the (new) host lacks: send them on.
      const mySeat = this.started?.seats[this.myId];
      for (let seq = m.total; seq < this.log.length; seq++) {
        const e = this.log[seq];
        if (e) this.toHost?.send({ t: 'ans', seq, v: e[0] ?? null, u: e[1], ...(mySeat !== undefined ? { seat: mySeat } : {}) } satisfies Msg);
      }
      for (const [seq, answer] of this.pendingAnswers) if (seq >= m.total) this.toHost?.send(answer);
    }
    else if (m.t === 'digest') {
      const ours = this.localDigests.get(m.seq);
      if (ours === undefined) this.rememberDigest(this.digests, m.seq, m.h);
      else {
        this.localDigests.delete(m.seq);
        if (ours !== m.h) this.onDesync(m.seq);
      }
    }
    else if (m.t === 'chat') this.heard(m.line);
    else if (m.t === 'votes') { this.votes.set(m.target, new Set(m.voters)); this.onVotes(); }
    else if (m.t === 'kicked') this.away(m.id, m.seat);
    else if (m.t === 'bye') {
      if (m.retry === true) { this.toHost?.close(); return; }
      this.kicked = /請出/.test(m.why ?? ''); this.onStatus(m.why ?? '房間已滿'); this.close();
    }
  }

  /** Someone was voted out (told by the host): this phone leaves, or forgets them (the host's leaving starts the hand-over). */
  private away(id: string, seat?: number) {
    this.votes.delete(id);
    if (id === this.myId) { this.kicked = true; this.onStatus('你已被投票請出房間'); this.close(); return; }
    if (seat !== undefined) this.kickedSeats.add(seat);
    if (id === this.members[0]?.id) this.lostHost = id;
    this.members = this.members.filter(x => x.id !== id);
    this.onVotes(); this.onLobby();
  }

  /** Host: starts the game for everyone. */
  start(s: StartMsg) {
    const m: Msg = { t: 'start', start: s };
    for (const c of this.guests.values()) c.open && c.send(m);
    this.begin(s);
  }
  private begin(s: StartMsg) {
    this.started = s;
    this.mine = new Set(Object.entries(s.seats).filter(([id]) => id === this.myId).map(([, seat]) => seat));
    this.onStart(s);
  }

  /** Registers which player seat is expected to answer lockstep question `seq` and flushes any verified staged answer (P1-01). */
  expectQuestionSeat(seq: number, seat: number): void {
    if (Number.isInteger(seq) && seq >= 0 && Number.isInteger(seat) && seat >= 0) {
      this.expectedSeats.set(seq, seat);
      if (this.host) {
        for (const [key, staged] of this.unverifiedAnswers) {
          if (staged.seq !== seq) continue;
          this.unverifiedAnswers.delete(key);
          const auth = authorizeSeatAnswer(
            this.started?.seats,
            this.kickedSeats,
            this.expectedSeats,
            staged.peer,
            seq,
            staged.seat,
          );
          if (auth.ok) {
            this.record(seq, staged.v, true);
          }
        }
      }
    }
  }

  /** An answer to the game's question number `seq` (from this phone, or arriving). */
  private record(seq: number, v: unknown, fromGuest: boolean) {
    if (seq < this.log.length && this.log[seq] !== undefined) return;
    this.log[seq] = [v, v === undefined];
    if (this.host && fromGuest) {
      const m: Msg = { t: 'ans', seq, v: v ?? null, u: v === undefined };
      for (const c of this.guests.values()) c.open && c.send(m);
    }
    this.pendingAnswers.delete(seq);
    this.waiters.get(seq)?.resolve(v);
    this.waiters.delete(seq);
  }
  /** This phone answered question `seq` (one of its seats, or a seat sent away when it hosts). */
  answer(seq: number, v: unknown, seat?: number): Promise<unknown> {
    const have = this.log[seq];
    if (have) return Promise.resolve(have[1] ? undefined : have[0]);
    const resolvedSeat = seat ?? this.expectedSeats.get(seq) ?? this.started?.seats[this.myId];
    const m: Msg = {
      t: 'ans',
      seq,
      v: v ?? null,
      u: v === undefined,
      ...(typeof resolvedSeat === 'number' ? { seat: resolvedSeat } : {}),
    };
    if (this.host) {
      this.record(seq, v, false);
      for (const c of this.guests.values()) c.open && c.send(m);
      return Promise.resolve(v);
    }
    // Only the host's committed answer enters the replay log. In particular an
    // offline guest must not execute a dice answer that the host replaced with autopilot.
    this.pendingAnswers.set(seq, m);
    const accepted = this.wait(seq);
    if (this.toHost?.open) {
      try { this.toHost.send(m); } catch { this.toHost.close(); }
    }
    return accepted;
  }
  /** The answer to question `seq` of another phone's seat. */
  wait(seq: number): Promise<unknown> {
    const have = this.log[seq];
    if (have) return Promise.resolve(have[1] ? undefined : have[0]);
    let pending = this.waiters.get(seq);
    if (!pending) {
      let resolve!: (v: unknown) => void;
      const promise = new Promise<unknown>(done => { resolve = done; });
      pending = { promise, resolve };
      this.waiters.set(seq, pending);
    }
    return pending.promise;
  }

  private rememberDigest(target: Map<number, number>, seq: number, h: number) {
    target.set(seq, h);
    // Bound unmatched packets/checkpoints during long outages or a host handover.
    if (target.size > 256) target.delete(target.keys().next().value!);
  }

  /** Compare now if the host is ahead; otherwise retain our turn hash for the arriving packet. */
  digest(seq: number, h: number): boolean {
    if (this.host) { const m: Msg = { t: 'digest', seq, h }; for (const c of this.guests.values()) c.open && c.send(m); return true; }
    const theirs = this.digests.get(seq);
    if (theirs === undefined) { this.rememberDigest(this.localDigests, seq, h); return true; }
    this.digests.delete(seq);
    return theirs === h;
  }

  // ---------------------------------------------------------------- chat, mute, kick votes

  /** Sends a line (at most 40 characters). */
  say(text: string) {
    const t = text.trim().slice(0, 40);
    if (!t) return;
    const mine = this.members.find(x => x.id === this.myId);
    const line: ChatLine = { from: this.myId, name: mine?.name ?? this.me.name, character: mine?.character ?? this.me.character, text: t, at: Date.now() };
    if (this.host) this.heard(line);
    else { this.toHost?.send({ t: 'chat', line } satisfies Msg); this.heard(line, false); }
  }
  /** A line arrived (the host passes it on). */
  private heard(line: ChatLine, relay = true) {
    if (this.chat.some(l => l.from === line.from && l.at === line.at && l.text === line.text)) return;
    this.chat.push(line);
    if (this.chat.length > 100) this.chat.shift();
    if (this.host && relay && line.from) { const m: Msg = { t: 'chat', line }; for (const [id, c] of this.guests) if (id !== line.from && c.open) c.send(m); }
    if (!this.muted.has(line.from)) this.onChat(line);
  }
  toggleMute(id: string) { if (this.muted.has(id)) this.muted.delete(id); else this.muted.add(id); }

  /** This phone votes to send `target` away (anyone else, the host too). */
  vote(target: string) {
    if (target === this.myId) return;
    if (this.host) this.voted(target, this.myId);
    else this.toHost?.send({ t: 'vote', target, voter: this.myId } satisfies Msg);
  }
  /** Host: counts a vote (even against itself); two others agreeing send the player away. */
  private voted(target: string, voter: string) {
    if (!this.host || voter === target || !this.members.some(x => x.id === target)) return;
    const v = this.votes.get(target) ?? new Set<string>();
    v.add(voter);
    this.votes.set(target, v);
    const m: Msg = { t: 'votes', target, voters: [...v] };
    for (const c of this.guests.values()) c.open && c.send(m);
    this.onVotes();
    if (v.size >= 2) this.kick(target);
  }
  private kick(id: string) {
    const seat = this.started ? this.started.seats[id] : undefined, name = this.nameOf(id);
    this.kickedIds.add(id);
    const note = `${name}被投票請出房間${seat !== undefined ? '，由電腦接手' : ''}`;
    if (id === this.myId) {
      // The host itself: everyone is told, then this phone leaves; the next player takes the room over.
      this.heard({ from: '', name: '系統', character: -1, text: note, at: Date.now() });
      const m: Msg = { t: 'kicked', id, seat };
      for (const c of this.guests.values()) c.open && c.send(m);
      this.kicked = true;
      setTimeout(() => { this.onStatus('你已被投票請出房間'); this.close(); }, 600);
      return;
    }
    this.votes.delete(id);
    if (seat !== undefined) this.kickedSeats.add(seat);
    const m: Msg = { t: 'kicked', id, seat };
    for (const c of this.guests.values()) c.open && c.send(m);
    const c = this.guests.get(id);
    setTimeout(() => c?.close(), 500);
    this.guests.delete(id);
    this.members = this.members.filter(x => x.id !== id);
    this.heard({ from: '', name: '系統', character: -1, text: note, at: Date.now() });
    this.onVotes();
    this.lobbyChanged();
  }
  nameOf(id: string) { return this.members.find(x => x.id === id)?.name ?? '玩家'; }

  close() {
    this.closed = true;
    for (const c of this.guests.values()) c.close();
    this.toHost?.close();
    this.peer?.destroy();
  }
}
