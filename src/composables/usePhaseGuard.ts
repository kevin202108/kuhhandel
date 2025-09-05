// src/composables/usePhaseGuard.ts
import type { GameState, Player, Animal } from '@/types/game';

/**
 * 依 README 權限矩陣定義的 UI 動作名稱集合。
 * 注意：這些是「UI 層」的意圖行為，不是網路協定字串。
 */
export type GuardAction =
  | 'START_GAME'
  | 'CHOOSE_AUCTION'
  | 'CHOOSE_COW_TRADE'
  | 'PLACE_BID'
  | 'PASS_BID'
  | 'HOST_AWARD'
  | 'HOST_BUYBACK'
  | 'SELECT_TARGET'
  | 'SELECT_ANIMAL'
  | 'COMMIT_COW_TRADE'
  | 'REVEAL_AND_RESOLVE';

export interface UsePhaseGuardHelpers {
  /**
   * 來自 store/game.ts 的 getter：第一回合或依牌庫判斷是否可拍賣。
   */
  canChooseAuction: () => boolean;
  /**
   * 來自 store/game.ts 的 getter：當前回合玩家是否可進行 Cow Trade（需有錢）。
   */
  canChooseCowTrade: () => boolean;
  /**
   * 來自 store/auction.ts 的 getter：主持人（auctioneer）是否具備買回條件（可湊等額）。
   */
  canAuctioneerBuyback: () => boolean;
  /**
   * 來自 store/game.ts 的 getter：該動物是否已被鎖（有人集滿 4 張）。
   */
  isAnimalLocked: (animal: Animal) => boolean;
}

export interface UsePhaseGuardOptions {
  state: GameState;
  selfId: string;
  helpers: UsePhaseGuardHelpers;
}

/**
 * Money 合計（將 0 面額視為「不具購買力」）
 */
function totalMoneyOf(player: Player): number {
  let sum = 0;
  for (const m of player.moneyCards) sum += m.value;
  return sum;
}

/**
 * 玩家是否「有錢」：合計 > 0（0 面額卡片不視為可用資金）。
 */
function playerHasSpendableMoney(state: GameState, playerId: string): boolean {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return false;
  return totalMoneyOf(p) > 0;
}

/**
 * 玩家是否擁有任一動物（總數量 > 0）。
 */
function playerHasAnyAnimal(p: Player): boolean {
  for (const key in p.animals) {
    const k = key as Animal;
    if (p.animals[k] > 0) return true;
  }
  return false;
}

/**
 * 是否存在至少一位可被挑戰的目標（有動物，且不是自己）。
 */
function existsValidCowTarget(state: GameState, initiatorId: string): boolean {
  for (const p of state.players) {
    if (p.id === initiatorId) continue;
    if (playerHasAnyAnimal(p)) return true;
  }
  return false;
}

/**
 * 目標玩家是否存在至少一種「未被鎖且該玩家持有數量 > 0」的動物。
 */
function targetHasAnyValidAnimal(
  state: GameState,
  targetPlayerId: string,
  isAnimalLocked: (a: Animal) => boolean
): boolean {
  const target = state.players.find((x) => x.id === targetPlayerId);
  if (!target) return false;
  for (const key in target.animals) {
    const a = key as Animal;
    if (target.animals[a] > 0 && !isAnimalLocked(a)) return true;
  }
  return false;
}

/**
 * 兩方是否都已提交秘密（initiator/target 的 moneyCardIds 陣列已存在）。
 * 以 exactOptionalPropertyTypes 規範：必須用 !== undefined 判斷。
 */
function bothCowSecretsCommitted(state: GameState): boolean {
  const cow = state.cow;
  if (!cow) return false;
  const initiatorCommitted = cow.initiatorSecret !== undefined;
  const targetCommitted = cow.targetSecret !== undefined;
  return initiatorCommitted && targetCommitted;
}

/**
 * 權限守門：依當前 GameState + 自己身分 + store getters，回答 UI 動作是否可觸發。
 */
export function usePhaseGuard(opts: UsePhaseGuardOptions) {
  const { state, selfId, helpers } = opts;

  function isActionAllowed(action: GuardAction): boolean {
    // 快速引用
    const phase = state.phase;

    switch (action) {
      // -------------------------
      // SETUP：Host-only 開始遊戲
      // -------------------------
      case 'START_GAME': {
        if (phase !== 'setup') return false;
        // 需要 hostId 已經鎖定且為自己，且人數 2 ~ 5（README 建議範圍）
        if (state.hostId === undefined) return false;
        if (selfId !== state.hostId) return false;
        const n = state.players.length;
        return n >= 2 && n <= 5;
      }

      // -------------------------
      // TURN CHOICE（回合主動作）
      // -------------------------
      case 'CHOOSE_AUCTION': {
        if (phase !== 'turn.choice') return false;
        if (selfId !== state.turnOwnerId) return false;
        return helpers.canChooseAuction();
      }
      case 'CHOOSE_COW_TRADE': {
        if (phase !== 'turn.choice') return false;
        if (selfId !== state.turnOwnerId) return false;
        // README：當前玩家是否有錢
        return helpers.canChooseCowTrade();
      }

      // -------------------------
      // AUCTION（競標階段）
      // -------------------------
      case 'PLACE_BID': {
        if (phase !== 'auction.bidding') return false;
        // 沒錢禁用（0 面額不算錢）
        return playerHasSpendableMoney(state, selfId);
      }
      case 'PASS_BID': {
        if (phase !== 'auction.bidding') return false;
        const auction = state.auction;
        if (!auction) return false;
        // 主持人（auctioneer）不可 PASS
        if (auction.auctioneerId !== undefined && auction.auctioneerId === selfId) return false;
        // 沒錢禁用（依 README）
        return playerHasSpendableMoney(state, selfId);
      }
      case 'HOST_AWARD': {
        if (phase !== 'auction.closing') return false;
        const auction = state.auction;
        if (!auction) return false;
        // 只有拍賣主持人（auctioneer）可操作
        return auction.auctioneerId !== undefined && auction.auctioneerId === selfId;
      }
      case 'HOST_BUYBACK': {
        if (phase !== 'auction.closing') return false;
        const auction = state.auction;
        if (!auction) return false;
        // 只有拍賣主持人（auctioneer）可操作，且需可買回
        if (auction.auctioneerId === undefined || auction.auctioneerId !== selfId) return false;
        return helpers.canAuctioneerBuyback();
      }

      // -------------------------
      // COW TRADE（選目標 / 選動物 / 提交 / 揭示）
      // -------------------------
      case 'SELECT_TARGET': {
        if (phase !== 'cow.selectTarget') return false;
        // 發起者：一般是回合玩家；若 state.cow.initiatorId 已定，使用它；否則回退到 turnOwnerId
        const initiatorId =
          state.cow && state.cow.initiatorId !== undefined
            ? state.cow.initiatorId
            : state.turnOwnerId;
        if (selfId !== initiatorId) return false;
        // 必須存在至少一位「有動物」的目標（且不是自己）
        return existsValidCowTarget(state, initiatorId);
      }
      case 'SELECT_ANIMAL': {
        if (phase !== 'cow.selectAnimal') return false;
        const cow = state.cow;
        if (!cow) return false;
        const initiatorId = cow.initiatorId !== undefined ? cow.initiatorId : state.turnOwnerId;
        if (selfId !== initiatorId) return false;
        if (cow.targetPlayerId === undefined) return false;
        // 目標玩家需存在至少一種未被鎖、且持有數量 > 0 的動物
        return targetHasAnyValidAnimal(state, cow.targetPlayerId, helpers.isAnimalLocked);
      }
      case 'COMMIT_COW_TRADE': {
        if (phase !== 'cow.commit') return false;
        const cow = state.cow;
        if (!cow) return false;

        const isInitiator = cow.initiatorId !== undefined && cow.initiatorId === selfId;
        const isTarget = cow.targetPlayerId !== undefined && cow.targetPlayerId === selfId;
        if (!isInitiator && !isTarget) return false;

        // 發起者必須有錢才能行動（README：沒錢玩家禁用發起 Cow Trade）
        if (isInitiator && !playerHasSpendableMoney(state, selfId)) return false;

        // 不能重複提交
        if (isInitiator && cow.initiatorSecret !== undefined) return false;
        if (isTarget && cow.targetSecret !== undefined) return false;

        // 目標被挑戰者可被挑戰，即使沒有錢也可提交（可能提交 0）
        return true;
      }
      case 'REVEAL_AND_RESOLVE': {
        if (phase !== 'cow.reveal') return false;
        // 只有「網路 Host（state.hostId）」可觸發揭示與結算
        if (state.hostId === undefined || selfId !== state.hostId) return false;
        return bothCowSecretsCommitted(state);
      }

      // -------------------------
      // 不屬於矩陣的預設
      // -------------------------
      default:
        return false;
    }
  }

  return { isActionAllowed };
}
