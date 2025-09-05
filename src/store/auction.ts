// src/store/auction.ts
import { defineStore } from 'pinia';
import { useGameStore } from './game';
import type {
  AuctionState,
  Bid,
  GameState,
  MoneyCard,
  Player
} from '@/types/game';

/**
 * Auction Store（Phase 1：單機 MVP）
 * - enterBidding(): 抽牌並進入 auction.bidding
 * - placeBid(): 只保留最高價；平手比 ts（先到先贏）
 * - passBid(): 更新 passes:string[]；「除了最高出價者與主持人外」皆 pass 後 → auction.closing
 * - hostAward(): 主持人結標給最高出價者（或無人出價 → 主持人直接拿）
 * - settle('award'): 一次性轉移資產，phase='turn.end'
 *
 * 注意：
 * - 本檔不處理網路廣播/Host；僅單機邏輯。
 * - `passes` 使用 string[]（可序列化）。
 */

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
function now() {
  return Date.now();
}
function getPlayerById(game: GameState, id: string): Player {
  const p = game.players.find((x) => x.id === id);
  if (!p) throw new Error(`Player not found: ${id}`);
  return p;
}
function moneyTotalOf(player: Player, moneyCardIds: string[]): number {
  const want = uniq(moneyCardIds);
  const ownedIds = new Set(player.moneyCards.map((m) => m.id));
  for (const id of want) {
    if (!ownedIds.has(id)) throw new Error(`Money card ${id} not owned by player ${player.id}`);
  }
  let total = 0;
  const byId = new Map(player.moneyCards.map((m) => [m.id, m]));
  for (const id of want) total += byId.get(id)!.value;
  return total;
}
/** 有錢的非主持人（沒錢者不需要按 pass） */
function eligibleNonHostIdsForBidding(game: GameState, auctioneerId: string): string[] {
  return game.players
    .filter((p) => p.id !== auctioneerId && p.moneyCards.length > 0)
    .map((p) => p.id);
}

export const useAuctionStore = defineStore('auction', {
  state: () => ({
    auction: null as AuctionState | null
  }),

  getters: {
    // Phase 1 未實作買回；此 getter 保留介面位置（永遠 false）
    canAuctioneerBuyback: (state) => {
      void state;
      return false;
    }
  },

  actions: {
    /**
     * 依「目前最高出價者免按放棄」的規則，檢查是否應進入結標
     * - 取出「有錢的非主持人」清單 eligible
     * - 若存在最高出價者 highest → 將其自 eligible 排除
     * - 若剩餘所有人都已在 passes → 進入 auction.closing
     */
    maybeEnterClosing() {
      const game = useGameStore();
      const a = this.auction;
      if (!a || game.phase !== 'auction.bidding') return;

      const eligible = eligibleNonHostIdsForBidding(game.$state, a.auctioneerId!);
      const highestId = a.highest?.playerId;

      const required = highestId ? eligible.filter((id) => id !== highestId) : eligible;
      const allRequiredPassed = required.every((id) => a.passes.includes(id));

      if (allRequiredPassed) {
        a.closed = true;
        game.phase = 'auction.closing';
        game.appendLog(
          highestId
            ? '除目前最高出價者與主持人外皆已放棄，進入結標'
            : '所有競標者皆已放棄，進入結標'
        );
      }
    },

    /**
     * 進入拍賣流程：抽一張牌，建立 AuctionState，phase='auction.bidding'
     * 若場上除主持人外皆無錢，直接進入 'auction.closing'
     */
    enterBidding() {
      const game = useGameStore();
      if (game.phase !== 'turn.choice') return;

      const auctioneerId = game.turnOwnerId;
      const card = game.drawCardForAuction();

      this.auction = {
        auctioneerId,
        card,
        highest: undefined,
        passes: [],
        closed: false
      };

      game.phase = 'auction.bidding';
      game.appendLog(
        `拍賣開始：${card.animal}（主持人：${getPlayerById(game.$state, auctioneerId).name}）`
      );

      // 若沒有任何具備資金的競標者，直接進入結標階段
      const eligible = eligibleNonHostIdsForBidding(game.$state, auctioneerId);
      if (eligible.length === 0) {
        this.auction.closed = true;
        game.phase = 'auction.closing';
        game.appendLog('除主持人外無人具備資金，進入結標');
      }
    },

    /**
     * 出價：只保留最高；同額則以 ts 先到先贏（不覆蓋既有最高）
     * 不會立即轉移資產，直到 settle('award')
     * ※ 出價後若「除了最新最高者與主持人外」其餘皆已放棄，則自動進入結標
     */
    placeBid(playerId: string, moneyCardIds: string[], actionId: string) {
      const game = useGameStore();
      if (game.phase !== 'auction.bidding' || !this.auction) return;

      // 禁止已經宣告放棄者再出價
      if (this.auction.passes.includes(playerId)) return;

      const bidder = getPlayerById(game.$state, playerId);
      const total = moneyTotalOf(bidder, moneyCardIds);

      const newBid: Bid = {
        playerId,
        moneyCardIds: uniq(moneyCardIds),
        total,
        ts: now(),
        actionId
      };

      const current = this.auction.highest;
      const shouldReplace =
        !current ||
        newBid.total > current.total ||
        (newBid.total === current.total && newBid.ts < current.ts);

      if (shouldReplace) {
        this.auction.highest = newBid;
        game.appendLog(`出價：${bidder.name} ＠ ${total}`);

        // 最高者變更後，若其他人都已放棄 → 立即進入結標
        this.maybeEnterClosing();
      }
      // 低於或平手但較晚 → 忽略
    },

    /**
     * 放棄出價：加入 passes
     * - 「除了目前最高出價者與主持人外」其餘皆 pass 後 → 進入 auction.closing
     */
    passBid(playerId: string) {
      const game = useGameStore();
      if (!this.auction || game.phase !== 'auction.bidding') return;

      const { auctioneerId } = this.auction;
      if (playerId === auctioneerId) {
        // 主持人不可 pass（規則），直接忽略
        return;
      }

      if (!this.auction.passes.includes(playerId)) {
        this.auction.passes.push(playerId);
        const p = getPlayerById(game.$state, playerId);
        game.appendLog(`放棄：${p.name}`);
      }

      // 檢查是否已符合「除了最高者與主持人外皆放棄」
      this.maybeEnterClosing();
    },

    /**
     * 主持人結標（Phase 1 僅支援 award）
     * - 若有最高出價者：將牌給得標者，款項轉給主持人
     * - 若無人出價：主持人免費獲得該牌
     * 最終呼叫 settle('award')
     */
    hostAward() {
      const game = useGameStore();
      if (!this.auction || (game.phase !== 'auction.closing' && game.phase !== 'auction.bidding'))
        return;

      // 保守：僅在 closing 允許結標
      if (game.phase === 'auction.bidding') return;

      this.auction.closed = true;
      this.settle('award');
    },

    /**
     * 結算（Phase 1 僅 'award'）
     * - 一次性轉移資產（錢卡 / 動物卡），寫入 log
     * - phase='turn.end'，清空 auction 狀態
     */
    settle(mode: 'award' | 'buyback') {
      const game = useGameStore();
      if (!this.auction) return;
      if (mode !== 'award') {
        // Phase 1 不支援買回；預留介面但不執行
        return;
      }

      const a = this.auction;
      const { card, highest, auctioneerId } = a;
      if (!card || !auctioneerId) throw new Error('Invalid auction state');

      const seller = getPlayerById(game.$state, auctioneerId);

      if (highest) {
        // 有得標者：錢卡從買家移轉給主持人；動物卡給買家
        const buyer = getPlayerById(game.$state, highest.playerId);

        // 轉移錢卡（從 buyer 移除 → 加到 seller）
        const idSet = new Set(highest.moneyCardIds);
        const moved: MoneyCard[] = [];
        buyer.moneyCards = buyer.moneyCards.filter((m) => {
          if (idSet.has(m.id)) {
            moved.push(m);
            return false;
          }
          return true;
        });
        seller.moneyCards.push(...moved);

        // 動物卡 → buyer
        buyer.animals[card.animal] = (buyer.animals[card.animal] ?? 0) + 1;

        game.appendLog(
          `結標：${buyer.name} 以 ${highest.total} 得標 ${card.animal}（主持人收款 ${moved.length} 張）`
        );
      } else {
        // 無人出價：主持人直接拿牌
        seller.animals[card.animal] = (seller.animals[card.animal] ?? 0) + 1;
        game.appendLog(`無人出價：主持人 ${seller.name} 取得 ${card.animal}`);
      }

      // 清理與收尾
      game.phase = 'turn.end';
      this.auction = null;
    }
  }
});
