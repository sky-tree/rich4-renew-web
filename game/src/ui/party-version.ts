/** Web lockstep compatibility. UI-only fixes do not change the rules identifier. */
export const PARTY_PROTOCOL_VERSION = 2;
// The previous '0.6.6' identifier survived the v0.7.1 rules merge. Give this Web rules baseline its own identity;
// it deliberately excludes upstream v0.7.2 junction LRU and v0.7.4 balance/content changes.
export const PARTY_RULES_VERSION = 'web-v0.7.1';

export interface PartyVersion { proto?: number; rules?: string }
export const partyVersion = () => ({ proto: PARTY_PROTOCOL_VERSION, rules: PARTY_RULES_VERSION });

export function partyVersionError(value: PartyVersion | null | undefined): 'version-mismatch' | 'rules-mismatch' | null {
  if (value?.proto !== PARTY_PROTOCOL_VERSION) return 'version-mismatch';
  return value.rules === PARTY_RULES_VERSION ? null : 'rules-mismatch';
}

export function partyVersionMessage(reason: string): string {
  return reason === 'rules-mismatch'
    ? '遊戲規則版本不一致，無法加入同一對局。\n請確認使用相同的 Web 版本，重新整理網頁後再連線。'
    : '聯機協議版本不一致或未提供版本，無法加入同一對局。\n請雙方重新整理網頁更新後再連線。';
}
