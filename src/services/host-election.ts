// src/services/host-election.ts

/**
 * Host 選舉（兩時機）工具。
 *
 * 規範摘要：
 * - playerId ≡ clientId ≡ senderId
 * - Host 只在兩個時機決定/變更：
 *   1) 開局鎖定（setup）：從當前 presence 成員取字典序最小者
 *   2) 舊 Host 離線：從剩餘成員取字典序最小者
 *
 * 注意：
 * - 本模組不做 I/O（不觸碰 Ably / Store），只純函式計算。
 * - 以嚴格型別撰寫，不使用 `any`。
 */

/** 合法的 playerId 規則（小寫英數、底線、破折號，1~24 字元） */
export const PLAYER_ID_REGEX = /^[a-z0-9_-]{1,24}$/;

/**
 * 檢查 playerId 是否符合規範。
 * 已在 main.ts 層做過正規化，這裡仍防禦性過濾，避免外部來源不合規資料滲入。
 */
export function isValidPlayerId(id: string): boolean {
  return PLAYER_ID_REGEX.test(id);
}

/** 以字典序（ASCII）比較兩個字串，回傳 -1 / 0 / 1。 */
function compareAsciiLex(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 去重 + 過濾非法 ID，回傳乾淨候選清單。 */
function sanitizeMemberIds(memberIds: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of memberIds) {
    const id = typeof raw === 'string' ? raw : '';
    if (isValidPlayerId(id) && !seen.has(id)) {
      seen.add(id);
    }
  }
  return Array.from(seen);
}

/** 自候選清單中取出字典序最小的 playerId；若無候選回傳 null。 */
function pickSmallestLex(candidates: readonly string[]): string | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort(compareAsciiLex);
  return sorted[0] ?? null;
}

/**
 * 開局鎖定：在 setup 階段，從當前 presence 成員中挑出字典序最小的 playerId 作為 host。
 *
 * @param memberIds - 當前 presence 成員 id（=playerId）
 * @returns 最小字典序的 playerId；若無可用成員則拋出錯誤（交由呼叫端決策）
 *
 * 空集合處理策略：
 * - README 中建議「可回傳 null 交由呼叫端決策」或「拋錯」兩擇一。
 * - 依照目前函式簽名（回傳 string），採 **拋錯**，確保呼叫端顯式處理此異常。
 */
export function chooseHostAtSetup(memberIds: readonly string[]): string {
  const candidates = sanitizeMemberIds(memberIds);
  const smallest = pickSmallestLex(candidates);
  if (smallest === null) {
    throw new Error('[host-election] chooseHostAtSetup: no eligible members to elect as host.');
  }
  return smallest;
}

/**
 * 舊 Host 離線後的重選：
 * 在剩餘成員中（排除舊 Host）取字典序最小的 playerId 作為新 Host。
 *
 * @param oldHostId - 舊 Host 的 playerId
 * @param memberIds - 當前仍在線的成員 id（=playerId）
 * @returns 新 Host 的 playerId；若無成員可選則回傳 null（由呼叫端決策）
 */
export function reelectOnHostLeave(
  oldHostId: string,
  memberIds: readonly string[]
): string | null {
  const candidates = sanitizeMemberIds(memberIds).filter((id) => id !== oldHostId);
  return pickSmallestLex(candidates);
}

/* ====== 簡單型別測試（開發時可暫留；若不需可移除） ======
 * // 期望：'a'
 * console.assert(chooseHostAtSetup(['b', 'a', 'c']) === 'a');
 * // 期望：'b'
 * console.assert(reelectOnHostLeave('a', ['b', 'c']) === 'b');
 * // 期望：null（無剩餘成員）
 * console.assert(reelectOnHostLeave('a', []) === null);
 * // 期望：過濾非法 id、去重
 * console.assert(chooseHostAtSetup(['A', 'a', 'a', 'c']).toString() === 'a');
 * ====================================================== */
