/**
 * useAuctionViewRole.ts
 * 依 README 所述：判定目前玩家是否為 Host。
 * - 僅以 hostId 是否存在且與 myId 相等作判斷。
 * - 不做任何額外的網路/副作用。
 */

/**
 * 回傳目前玩家是否為 Host。
 *
 * @param myId   當前使用者的 playerId
 * @param hostId 當前遊戲的 Host Id（可能尚未鎖定，因此為可選）
 * @returns 是否為 Host
 */
export function isHost(myId: string, hostId?: string): boolean {
  return hostId !== undefined && myId === hostId;
}
