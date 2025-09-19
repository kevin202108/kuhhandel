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
      if (!state.auction?.highest) {
        console.log('[DEBUG] canAuctioneerBuyback: No highest bid');
        return false;
      }
      const game = useGameStore();
      const auctioneer = game.players.find(p => p.id === state.auction!.auctioneerId);
      if (!auctioneer) {
        console.log('[DEBUG] canAuctioneerBuyback: Auctioneer not found');
        return false;
      }

      const totalMoney = auctioneer.moneyCards.reduce((sum, card) => sum + card.value, 0);
      const canBuyback = totalMoney >= state.auction.highest.total;
      console.log('[DEBUG] canAuctioneerBuyback:', {
        auctioneerId: state.auction.auctioneerId,
        auctioneerMoney: totalMoney,
        highestBid: state.auction.highest.total,
        canBuyback
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

      game.lastAwarded = null; // 清除上次的獎勵記錄

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

    hostBuyback() {
      const game = useGameStore();
      if (!this.auction || game.phase !== 'auction.closing') {
        console.log('[DEBUG] hostBuyback: Invalid state', {
          hasAuction: !!this.auction,
          phase: game.phase,
          expectedPhase: 'auction.closing'
        });
        return;
      }

      console.log('[DEBUG] hostBuyback: Starting buyback process', {
        auctioneerId: this.auction.auctioneerId,
        animal: this.auction.card?.animal,
        highestBid: this.auction.highest?.total
      });

      game.phase = 'auction.buyback';
      game.appendLog('Auctioneer initiated buyback process.');
      this.syncGameAuction();
    },

    confirmBuyback(moneyCardIds: string[]) {
      const game = useGameStore();
      if (!this.auction || game.phase !== 'auction.buyback') {
        console.log('[DEBUG] confirmBuyback: Invalid state', {
          hasAuction: !!this.auction,
          phase: game.phase,
          expectedPhase: 'auction.buyback'
        });
        return;
      }

      const auctioneer = game.players.find(p => p.id === this.auction!.auctioneerId);
      if (!auctioneer || !this.auction.highest) {
        console.log('[DEBUG] confirmBuyback: Missing auctioneer or highest bid', {
          hasAuctioneer: !!auctioneer,
          hasHighestBid: !!this.auction.highest,
          auctioneerId: this.auction.auctioneerId,
          highestPlayerId: this.auction.highest?.playerId
        });
        return;
      }

      // 驗證選擇的金錢總額
      const selectedTotal = moneyCardIds.reduce((sum, id) => {
        const card = auctioneer.moneyCards.find(c => c.id === id);
        return sum + (card?.value || 0);
      }, 0);

      console.log('[DEBUG] confirmBuyback: Money validation', {
        selectedCardIds: moneyCardIds,
        selectedTotal,
        requiredTotal: this.auction.highest.total,
        isSufficient: selectedTotal >= this.auction.highest.total
      });

      if (selectedTotal < this.auction.highest.total) {
        game.appendLog('Selected money is insufficient for buyback.');
        return;
      }

      console.log('[DEBUG] confirmBuyback: Executing buyback transaction');
      // 執行買回邏輯
      this.settle('buyback', moneyCardIds);
    },

    settle(mode: 'award' | 'buyback', moneyCardIds?: string[]) {
      const game = useGameStore();
      if (!this.auction) return;

      const a = this.auction;
      const { card, highest, auctioneerId } = a;
      if (!card || !auctioneerId) throw new Error('Invalid auction state');

      const auctioneer = getPlayerById(game.$state, auctioneerId);

      if (mode === 'buyback' && highest && moneyCardIds) {
        // 買回邏輯：拍賣者支付錢卡給最高出價者，動物卡回到拍賣者手中

        // 從拍賣者移除選擇的錢卡
        const selectedCards: MoneyCard[] = [];
        auctioneer.moneyCards = auctioneer.moneyCards.filter(card => {
          if (moneyCardIds.includes(card.id)) {
            selectedCards.push(card);
            return false;
          }
          return true;
        });

        // 給最高出價者錢卡
        const winner = game.players.find(p => p.id === highest.playerId);
        if (winner) {
          winner.moneyCards.push(...selectedCards);
        }

        // 動物卡回到拍賣者手中
        auctioneer.animals[card.animal] = (auctioneer.animals[card.animal] || 0) + 1;

        game.lastAwarded = { playerId: auctioneer.id, animal: card.animal };
        game.appendLog(`Buyback: ${auctioneer.name} paid ${highest.total} to keep ${card.animal}.`);

      } else if (mode === 'award') {
        if (highest) {
          const buyer = game.players.find(p => p.id === highest.playerId);
          if (buyer) {
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
            buyer.animals[card.animal] = (buyer.animals[card.animal] || 0) + 1;
            game.lastAwarded = { playerId: buyer.id, animal: card.animal };
            game.appendLog(`Award: ${buyer.name} pays ${highest.total} for ${card.animal}.`);
          }
        } else {
          auctioneer.animals[card.animal] = (auctioneer.animals[card.animal] || 0) + 1;
          game.lastAwarded = { playerId: auctioneer.id, animal: card.animal };
          game.appendLog(`No bids: auctioneer ${auctioneer.name} takes ${card.animal}.`);
        }
      }

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
