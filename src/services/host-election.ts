// src/services/host-election.ts

/**
 * Host 選舉與重選工具。
 *
 * 規範（摘自 README）：
 * - 以 presence 成員的 id（= clientId = playerId）為身分依據。
 * - Host 僅在兩個時機決定/變更：
 *   1) setup 開局鎖定：取字典序最小的 playerId。
 *   2) 舊 Host 離線：於剩餘成員中取字典序最小的 playerId。
 * - 其他情況不變更 hostId。
 *
 * 注意：
 * - playerId 已由上層正規化為 `[a-z0-9_-]{1,24}` 的小寫字串。
 * - 此處僅做「字典序最小」運算與是否需要重選的判斷，不做額外副作用。
 */

export type PresenceMember = { id: string };

/**
 * 回傳 members.map(m => m.id) 中字典序最小的 id。
 * 若無成員，回傳 undefined。
 */
export function getHostId(members: Array<PresenceMember>): string | undefined {
  if (!members || members.length === 0) return undefined;

  // 先取出所有有效 id；依 README 字元集，直接使用預設的字典序（Unicode code point）排序即可。
  const ids = members
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (ids.length === 0) return undefined;

  // 去重以避免 presence 端偶發重複（保守處理，不影響規範）
  const uniqueIds = Array.from(new Set(ids));

  // 依字典序升冪排序，取最小者
  uniqueIds.sort(); // 對於 [a-z0-9_-] 小寫字元集，預設排序符合需求
  return uniqueIds[0];
}

/**
 * 判斷是否需要重選 Host：
 * - 當前成員列表中找不到 oldHostId 時，回傳 true（應重選）。
 * - 否則回傳 false（維持現任）。
 */
export function shouldReelect(oldHostId: string, memberIds: string[]): boolean {
  // 根據 README，oldHostId 為既定的 hostId 字串；
  // 當前在線成員若不包含該 id，表示舊 Host 已離線，需進行重選。
  return !memberIds.includes(oldHostId);
}
