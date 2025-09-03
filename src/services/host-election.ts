// src/services/host-election.ts
// Host 選舉與遷移規則（SSoT）：
// - Host 為當前 presence 成員中 playerId「字典序最小」者。
// - 何時需要改選：舊 Host 不在目前成員名單中（離線/退出/尚未建立）。
//   * 注意：若舊 Host 仍在線，即使有更小的 id 新加入，也不自動改選（依 README：離線才移轉）。

export interface MemberRef {
  id: string; // 必須是 playerId（與 presence clientId 一致）
}

/**
 * 取得當前成員中「字典序最小」的 playerId。
 * @returns 若 members 為空，回傳空字串 ""。
 */
export function getHostId(members: MemberRef[]): string {
  if (members.length === 0) return '';

  // 過濾掉空字串 / 非法 id（保守處理）
  const ids = members
    .map((m) => m.id.trim())
    .filter(Boolean);

  if (ids.length === 0) return '';

  // 字典序最小（以原生字元順序比較；不做大小寫歸一，playerId 規範應一致）
  let min = ids[0]!;
  for (let i = 1; i < ids.length; i += 1) {
    const id = ids[i]!;
    if (id < min) min = id;
  }
  return min;
}

/**
 * 是否需要進行 Host 改選。
 * 規則：舊 Host 不在當前成員名單內時才改選。
 * - 若 oldHostId 為空字串（尚未選過），且 members 非空 → 需要改選（選出第一位 Host）。
 * - 若 oldHostId 存在且仍在 members 中 → 不改選。
 * - 若 oldHostId 不在 members 中 → 改選。
 */
export function shouldReelect(oldHostId: string, members: string[]): boolean {
  const hasOld = typeof oldHostId === 'string' && oldHostId.trim().length > 0;

  if (!hasOld) {
    // 尚未有 Host：只要房內有人就應該選出 Host
    return members.length > 0;
  }

  // 已有 Host：若已不在成員名單中，觸發改選
  return !members.includes(oldHostId);
}
