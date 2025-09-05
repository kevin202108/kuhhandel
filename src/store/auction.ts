import { defineStore } from 'pinia';
import { useGameStore } from './game';
import type { AuctionState, Bid, GameState, MoneyCard, Player } from '@/types/game';

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
function now(): number {
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
    // Phase 3 才會實作買回；此處保留介面（永遠 false）
    canAuctioneerBuyback: (state): boolean => {
      void state;
      return false;
    }
  },

  actions: {
    /**
     * 依「目前最高出價者免按放棄」的規則，檢查是否應進入結標
     */
    maybeEnterClosing(): void {
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
    enterBidding(): void {
      const game = useGameStore();
      if (game.phase !== 'turn.choice') return;

      if (!game.hostId) throw new Error('Host not set');
      const auctioneerId = game.turnOwnerId;

      // Phase 2：game.drawCardForAuction 需要 actorId（Host）
      const card = game.drawCardForAuction(game.hostId);

      const next: AuctionState = {
        auctioneerId,
        card,
        passes: [] as string[],
        closed: false
      };
      this.auction = JSON.parse(JSON.stringify(next)) as AuctionState;

      game.phase = 'auction.bidding';
      game.appendLog(
        `拍賣開始：${card.animal}（主持人：${getPlayerById(game.$state, auctioneerId).name}）`
      );

      // 若沒有任何具備資金的競標者，直接進入結標階段
      const eligible = eligibleNonHostIdsForBidding(game.$state, auctioneerId);
      if (eligible.length === 0) {
        const a = this.auction;
        if (!a) return;
        a.closed = true;
        game.phase = 'auction.closing';
        game.appendLog('除主持人外無人具備資金，進入結標');
      }
    },

    /**
     * 出價：只保留最高；同額則以 ts 先到先贏（不覆蓋既有最高）
     */
    placeBid(playerId: string, moneyCardIds: string[], actionId: string): void {
      const game = useGameStore();
      const a = this.auction;
      if (game.phase !== 'auction.bidding' || !a) return;

      // 禁止已經宣告放棄者再出價
      if (a.passes.includes(playerId)) return;

      const bidder = getPlayerById(game.$state, playerId);
      const total = moneyTotalOf(bidder, moneyCardIds);

      const newBid: Bid = {
        playerId,
        moneyCardIds: uniq(moneyCardIds),
        total,
        ts: now(),
        actionId
      };

      const current = a.highest;
      const shouldReplace =
        !current ||
        newBid.total > current.total ||
        (newBid.total === current.total && newBid.ts < current.ts);

      if (shouldReplace) {
        a.highest = newBid;
        game.appendLog(`出價：${bidder.name} ＠ ${total}`);
        this.maybeEnterClosing();
      }
    },

    /**
     * 放棄出價：加入 passes；必要時進入結標
     */
    passBid(playerId: string): void {
      const game = useGameStore();
      const a = this.auction;
      if (!a || game.phase !== 'auction.bidding') return;

      if (playerId === a.auctioneerId) {
        // 主持人不可 pass
        return;
      }

      if (!a.passes.includes(playerId)) {
        a.passes.push(playerId);
        const p = getPlayerById(game.$state, playerId);
        game.appendLog(`放棄：${p.name}`);
      }

      this.maybeEnterClosing();
    },

    /**
     * 主持人結標（Phase 2 僅 award）
     */
    hostAward(): void {
      const game = useGameStore();
      const a = this.auction;
      if (!a || game.phase !== 'auction.closing') return;

      a.closed = true;
      this.settle('award');
    },

    // Phase 3 才實作
    hostBuyback(): void {
      // no-op in Phase 2
    },

    /**
     * 結算（Phase 2 僅 'award'）
     * - 一次性轉移資產（錢卡 / 動物卡），寫入 log
     * - phase='turn.end'，清空 auction 狀態
     */
    settle(mode: 'award' | 'buyback'): void {
      const game = useGameStore();
      const a = this.auction;
      if (!a) return;
      if (mode !== 'award') return;

      const { card, highest, auctioneerId } = a;
      if (!card || !auctioneerId) throw new Error('Invalid auction state');

      const seller = getPlayerById(game.$state, auctioneerId);

      if (highest) {
        const buyer = getPlayerById(game.$state, highest.playerId);

        // 轉移錢卡（buyer -> seller）
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

      game.phase = 'turn.end';
      this.auction = null;
    }
  }
});
