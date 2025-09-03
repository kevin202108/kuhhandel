// src/services/host-election.ts

/**
 * 成員介面：僅需具備 id（playerId）。
 * 以字典序（JS 的字元序）最小者為 Host。
 */
export type HostMember = Readonly<{ id: string }>;

/**
 * 取得字典序最小的 id；若沒有有效 id，回傳空字串。
 */
function lexMin(ids: readonly string[]): string {
  let min = '';
  for (const id of ids) {
    // 跳過空字串
    if (id.length === 0) continue;
    // 初始化或更新最小值
    if (min === '' || id < min) {
      min = id;
    }
  }
  return min;
}

/**
 * 依 Presence 成員列表，選出字典序最小的 playerId 作為 Host。
 * @param members - Presence 成員（其 id 必須等於 playerId）
 * @returns hostId；若無成員則回傳空字串
 */
export function getHostId(members: HostMember[]): string {
  if (members.length === 0) return '';
  const ids: string[] = members
    .map((m) => m.id)
    .filter((id): id is string => id !== undefined && id !== null && id.length > 0);
  return lexMin(ids);
}

/**
 * 判斷是否需要重新選舉 Host。
 * 規則：
 * 1) 若目前沒有 Host（oldHostId === ''）且房內有人 → 需要選舉。
 * 2) 若舊 Host 已不在房內 → 需要改選。
 * 3) 若舊 Host 仍在，但不是當前成員中字典序最小者 → 需要改選。
 * 4) 其他情況：不需要改選。
 *
 * @param oldHostId - 目前認知的 Host id（playerId）
 * @param members - 房內所有成員的 playerId 列表
 * @returns 是否需要改選
 */
export function shouldReelect(oldHostId: string, members: string[]): boolean {
  // 沒有 Host 但已有成員 → 應選出一位
  if (oldHostId === '') {
    return members.length > 0;
  }

  const present = new Set<string>(members);

  // 舊 Host 不在成員列表 → 必須改選
  if (!present.has(oldHostId)) {
    return true;
  }

  // 舊 Host 在，但不是最小者 → 必須改選
  const min = lexMin(members);
  return oldHostId !== min;
}
