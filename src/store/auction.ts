// src/store/auction.ts
import { defineStore } from 'pinia';
import { useGameStore } from './game';
import type { AuctionState, Bid, GameState, MoneyCard, Player } from '@/types/game';

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
function eligibleNonHostIdsForBidding(game: GameState, auctioneerId: string): string[] {
  return game.players
    .filter((p) => p.id !== auctioneerId && p.moneyCards.length > 0)
    .map((p) => p.id);
}

export const useAuctionStore = defineStore('auction', {
  state: () => ({
    auction: null as AuctionState | null,
  }),

  getters: {
    canAuctioneerBuyback: (state) => {
      const game = useGameStore();
      if (!state.auction?.highest) {
        console.log('🔒 無法買回: 沒有最高出價', { highest: state.auction?.highest });
        return false;
      }
      const auctioneer = game.players.find(p => p.id === state.auction!.auctioneerId);
      if (!auctioneer) {
        console.log('🔒 無法買回: 找不到主持人', { auctioneerId: state.auction.auctioneerId });
        return false;
      }
      const totalMoney = auctioneer.moneyCards.reduce((sum, card) => sum + card.value, 0);
      const canBuyback = totalMoney >= state.auction.highest.total;
      console.log('💰 買回條件檢查:', {
        主持人ID: state.auction.auctioneerId,
        主持人名稱: auctioneer.name,
        主持人總金額: totalMoney,
        最高出價: state.auction.highest.total,
        可以買回: canBuyback
      });
      return canBuyback;
    },
  },

  actions: {
    syncGameAuction() {
      const game = useGameStore();
      // Replace reference to trigger Pinia change detection; clone to avoid proxies in snapshots
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (game as any).$state.auction = this.auction
        ? JSON.parse(JSON.stringify(this.auction))
        : null;
    },

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
        this.syncGameAuction();
        game.phase = 'auction.closing';
        game.appendLog(
          highestId
            ? 'All other bidders have passed; moving to closing.'
            : 'No eligible bidders; moving to closing.'
        );
      }
    },

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
        closed: false,
      };
      this.syncGameAuction();

      game.phase = 'auction.bidding';
      game.appendLog(
        `Auction opened for ${card.animal} (auctioneer ${getPlayerById(game.$state, auctioneerId).name}).`
      );

      const eligible = eligibleNonHostIdsForBidding(game.$state, auctioneerId);
      if (eligible.length === 0) {
        this.auction.closed = true;
        this.syncGameAuction();
        game.phase = 'auction.closing';
        game.appendLog('No eligible bidders; proceed to closing.');
      }
    },

    placeBid(playerId: string, moneyCardIds: string[], actionId: string) {
      const game = useGameStore();
      if (game.phase !== 'auction.bidding' || !this.auction) return;

      if (this.auction.passes.includes(playerId)) return;

      const bidder = getPlayerById(game.$state, playerId);
      const total = moneyTotalOf(bidder, moneyCardIds);

      const newBid: Bid = {
        playerId,
        moneyCardIds: uniq(moneyCardIds),
        total,
        ts: now(),
        actionId,
      };

      const current = this.auction.highest;
      const shouldReplace =
        !current ||
        newBid.total > current.total ||
        (newBid.total === current.total && newBid.ts < current.ts);

      if (shouldReplace) {
        this.auction.highest = newBid;
        this.syncGameAuction();
        game.appendLog(`Bid: ${bidder.name} -> ${total}`);
        this.maybeEnterClosing();
      }
    },

    passBid(playerId: string) {
      const game = useGameStore();
      if (!this.auction || game.phase !== 'auction.bidding') return;

      const { auctioneerId } = this.auction;
      if (playerId === auctioneerId) return; // auctioneer cannot pass

      if (!this.auction.passes.includes(playerId)) {
        this.auction.passes.push(playerId);
        this.syncGameAuction();
        const p = getPlayerById(game.$state, playerId);
        game.appendLog(`Pass: ${p.name}`);
      }

      this.maybeEnterClosing();
    },

    hostAward() {
      const game = useGameStore();
      if (!this.auction || game.phase !== 'auction.closing') return;
      this.auction.closed = true;
      this.syncGameAuction();
      this.settle('award');
    },

    hostBuyback(moneyCardIds: string[], actionId: string) {
      const game = useGameStore();
      if (!this.auction || game.phase !== 'auction.closing') {
        console.log('❌ 買回失敗: 狀態不正確', { auction: !!this.auction, phase: game.phase });
        return;
      }

      // 驗證是主持人操作
      const myId = game.hostId || '';
      if (myId !== this.auction.auctioneerId) {
        console.log('❌ 買回失敗: 不是主持人', { myId, auctioneerId: this.auction.auctioneerId });
        return;
      }

      // 驗證金額充足
      const auctioneer = getPlayerById(game.$state, this.auction.auctioneerId);
      const payAmount = moneyTotalOf(auctioneer, moneyCardIds);
      if (payAmount < this.auction.highest!.total) {
        console.log('❌ 買回失敗: 金額不足', { payAmount, required: this.auction.highest!.total });
        return;
      }

      console.log('💸 執行買回操作:', {
        主持人: auctioneer.name,
        支付金額: payAmount,
        買回的卡: this.auction.card?.animal,
        賣家: getPlayerById(game.$state, this.auction.highest!.playerId).name
      });

      this.auction.closed = true;
      this.syncGameAuction();
      this.settle('buyback', moneyCardIds);
    },

    settle(mode: 'award' | 'buyback', moneyCardIds?: string[]) {
      const game = useGameStore();
      if (!this.auction) return;

      const a = this.auction;
      const { card, highest, auctioneerId } = a;
      if (!card || !auctioneerId) throw new Error('Invalid auction state');

      const auctioneer = getPlayerById(game.$state, auctioneerId);

      if (mode === 'award') {
        if (highest) {
          const buyer = getPlayerById(game.$state, highest.playerId);
          const idSet = new Set(highest.moneyCardIds);
          const moved: MoneyCard[] = [];
          buyer.moneyCards = buyer.moneyCards.filter((m) => {
            if (idSet.has(m.id)) {
              moved.push(m);
              return false;
            }
            return true;
          });
          auctioneer.moneyCards.push(...moved);
          buyer.animals[card.animal] = (buyer.animals[card.animal] ?? 0) + 1;
          game.appendLog(`Award: ${buyer.name} pays ${highest.total} for ${card.animal}.`);
        } else {
          auctioneer.animals[card.animal] = (auctioneer.animals[card.animal] ?? 0) + 1;
          game.appendLog(`No bids: auctioneer ${auctioneer.name} takes ${card.animal}.`);
        }
      } else if (mode === 'buyback' && highest && moneyCardIds) {
        // 買回邏輯：主持人支付錢給最高出價者，主持人獲得動物卡
        const buyer = getPlayerById(game.$state, highest.playerId);
        const payAmount = moneyTotalOf(auctioneer, moneyCardIds);

        console.log('🔄 買回結算開始:', {
          買家: buyer.name,
          賣家: auctioneer.name,
          交易金額: payAmount,
          動物卡: card.animal,
          錢卡數量: moneyCardIds.length
        });

        // 移動錢卡從主持人到最高出價者
        const idSet = new Set(moneyCardIds);
        const moved: MoneyCard[] = [];
        auctioneer.moneyCards = auctioneer.moneyCards.filter((m) => {
          if (idSet.has(m.id)) {
            moved.push(m);
            return false;
          }
          return true;
        });
        buyer.moneyCards.push(...moved);

        // 主持人獲得動物卡
        auctioneer.animals[card.animal] = (auctioneer.animals[card.animal] ?? 0) + 1;

        console.log('✅ 買回結算完成:', {
          主持人獲得動物: `${auctioneer.name} -> +1 ${card.animal}`,
          買家獲得金錢: `${buyer.name} -> +${payAmount}`,
          動物卡分配後: auctioneer.animals,
          金錢轉移: `${moneyCardIds.length}張錢卡`
        });

        game.appendLog(`Buyback: ${auctioneer.name} buys back ${card.animal} for ${payAmount}.`);
      }

      // 結束拍賣並進入下一輪
      game.phase = 'turn.end';
      this.auction = null;
      this.syncGameAuction();

      // Auto-advance to next turn without requiring a UI button
      game.checkEndAndMaybeFinish();
      if (game.phase === 'turn.end') {
        game.rotateTurn();
        game.startTurn();
      }
    },
  },
});
