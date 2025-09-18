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
    canAuctioneerBuyback: () => false,
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

    settle(mode: 'award' | 'buyback') {
      const game = useGameStore();
      if (!this.auction) return;
      if (mode !== 'award') return;

      const a = this.auction;
      const { card, highest, auctioneerId } = a;
      if (!card || !auctioneerId) throw new Error('Invalid auction state');

      const seller = getPlayerById(game.$state, auctioneerId);

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
        seller.moneyCards.push(...moved);
        buyer.animals[card.animal] = (buyer.animals[card.animal] ?? 0) + 1;
        game.appendLog(`Award: ${buyer.name} pays ${highest.total} for ${card.animal}.`);
      } else {
        seller.animals[card.animal] = (seller.animals[card.animal] ?? 0) + 1;
        game.appendLog(`No bids: auctioneer ${seller.name} takes ${card.animal}.`);
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
