// src/store/game.ts
import { defineStore } from 'pinia';
import type {
  Animal,
  Card,
  GameState,
  MoneyCard,
  MoneyDenom,
  Player,
  Rules
} from '@/types/game';
import { rules } from '@/services/rules';
import { newId } from '@/utils/id';

// ---- helpers (嚴格型別、零 any) ----
function animalsListFromRules(rules: Rules): Animal[] {
  return Object.keys(rules.ANIMAL_SCORES) as Animal[];
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function clampDonkeyDrawCount(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  if (n >= 4) return 4;
  return n as 0 | 1 | 2 | 3;
}

function isDonkeyPayoutIndex(n: number): n is 0 | 1 | 2 | 3 {
  return n >= 0 && n <= 3;
}

function makeMoneyCardsForStart(rules: Rules): MoneyCard[] {
  const cards: MoneyCard[] = [];
  for (const denom of rules.MONEY_DENOMS) {
    const count = rules.START_MONEY[denom];
    for (let i = 0; i < count; i++) {
      cards.push({ id: newId(), value: denom });
    }
  }
  return cards;
}

function emptyAnimalsRecord(rules: Rules): Record<Animal, number> {
  const rec = {} as Record<Animal, number>;
  for (const a of animalsListFromRules(rules)) rec[a] = 0;
  return rec;
}

function totalAnimalsOf(player: Player): number {
  let total = 0;
  for (const a of Object.keys(player.animals) as Animal[]) {
    total += player.animals[a] ?? 0;
  }
  return total;
}

// ---- store ----
export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    phase: 'setup',
    players: [],
    deck: [],
    discard: [],
    turnOwnerId: '',
    donkeyDrawCount: 0,
    auction: null,
    cow: null,
    log: [],
    stateVersion: 0
  }),

  getters: {
    activePlayer(state): Player | undefined {
      return state.players.find(p => p.id === state.turnOwnerId);
    },
    playerById: (state) => (id: string): Player | undefined =>
      state.players.find(p => p.id === id),
    remainingAuctionableAnimals(state): Animal[] {
      const set = new Set<Animal>();
      for (const c of state.deck) set.add(c.animal);
      return Array.from(set.values());
    },
    canChooseAuction(state): boolean {
      return state.deck.length > 0;
    },
    canChooseCowTrade(state): boolean {
      const me = state.players.find(p => p.id === state.turnOwnerId);
      if (!me) return false;
      const firstRound = state.players.every(p => totalAnimalsOf(p) === 0);
      return me.moneyCards.length > 0 && !firstRound;
    },
    isAnimalLocked: (state) => (animal: Animal): boolean =>
      state.players.some(p => (p.animals[animal] ?? 0) >= rules.SET_SIZE)
  },

  actions: {
    /** 初始化遊戲（僅 Host 呼叫）。 */
    setupGame(playersInput: Array<{ id: string; name: string }>): void {
      const sorted = [...playersInput].sort((a, b) => a.id.localeCompare(b.id));
      const players: Player[] = sorted.map(p => ({
        id: p.id,
        name: p.name,
        moneyCards: makeMoneyCardsForStart(rules),
        animals: emptyAnimalsRecord(rules)
      }));

      const deck: Card[] = [];
      for (const a of animalsListFromRules(rules)) {
        for (let i = 0; i < rules.SET_SIZE; i++) {
          deck.push({ id: newId(), kind: 'animal', animal: a });
        }
      }
      shuffleInPlace(deck);

      this.phase = 'setup';
      this.players = players;
      this.deck = deck;
      this.discard = [];
      this.turnOwnerId = players[0]?.id ?? '';
      this.donkeyDrawCount = 0;
      this.auction = null;
      this.cow = null;
      this.log = [];
      this.stateVersion = 0;
    },

    /** 進入選擇階段。 */
    startTurn(): void {
      this.phase = 'turn.choice';
    },

    /**
     * 抽拍賣卡；若是驢子，先依目前驢子數發錢（該驢子仍照常拍賣）。
     * 僅 Host 在 chooseAuction 時呼叫。
     */
    drawCardForAuction(): Card {
      const card = this.deck.pop();
      if (!card) throw new Error('[game.drawCardForAuction] Deck is empty.');

      if (card.animal === 'donkey') {
        this.grantDonkeyPayout();
        this.appendLog('Donkey drawn: all players received payout.');
      }
      return card;
    },

    /** 依驢子累計次數（第1~4次：50/100/200/500）發錢給所有玩家。 */
    grantDonkeyPayout(): void {
      const idx = this.donkeyDrawCount; // 0..4
      if (!isDonkeyPayoutIndex(idx)) return; // 僅 0..3 可發放

      const amount = rules.DONKEY_PAYOUTS[idx];
      for (const p of this.players) {
        const denom = amount as MoneyDenom; // 50/100/200/500 皆屬於 MoneyDenom
        const card: MoneyCard = { id: newId(), value: denom };
        p.moneyCards.push(card);
      }
      this.donkeyDrawCount = clampDonkeyDrawCount(this.donkeyDrawCount + 1);
    },

    /** 將回合輪到下一位玩家。 */
    rotateTurn(): void {
      if (this.players.length === 0) {
        this.turnOwnerId = '';
        return;
      }
      const idx = this.players.findIndex(p => p.id === this.turnOwnerId);
      const nextIndex = idx >= 0 ? (idx + 1) % this.players.length : 0;
      const next = this.players[nextIndex];
      if (!next) {
        // 理論上不會發生，但保底避免 TS 警告與 runtime 例外
        this.turnOwnerId = this.players[0]?.id ?? '';
        return;
      }
      this.turnOwnerId = next.id;
    },

    /**
     * 計分：
     * - 自有動物分值總和 = Σ(擁有數量 ≥ 1 的每種動物分值；每種動物只計一次)
     * - 完成組數 = 擁有該動物數量 ≥ 4 的種類數
     * - 總分 = 自有動物分值總和 × 完成組數（若完成組數為 0，則總分為 0）
     */
    computeFinalScores(): Array<{ playerId: string; score: number }> {
      const animals = Object.keys(rules.ANIMAL_SCORES) as Animal[];
      return this.players.map(p => {
        let ownSum = 0;
        let completeSets = 0;
        for (const a of animals) {
          const have = p.animals[a] ?? 0;
          if (have > 0) ownSum += rules.ANIMAL_SCORES[a];
          if (have >= rules.SET_SIZE) completeSets += 1;
        }
        const score = completeSets > 0 ? ownSum * completeSets : 0;
        return { playerId: p.id, score };
      });
    },

    /** 若達終局條件則結束遊戲。 */
    checkEndAndMaybeFinish(): void {
      const animals = animalsListFromRules(rules);
      const allKindsCompleted = animals.every(a =>
        this.players.some(p => (p.animals[a] ?? 0) >= rules.SET_SIZE)
      );
      if (allKindsCompleted) this.phase = 'game.end';
    },

    appendLog(msg: string): void {
      this.log.push(msg);
    },

    /** Host 每次變更狀態後呼叫，stateVersion +1。 */
    bumpVersion(): void {
      this.stateVersion += 1;
    },

    /** 套用 Host 的完整快照。 */
    applySnapshot(s: GameState): void {
      this.phase = s.phase;
      this.players = s.players;
      this.deck = s.deck;
      this.discard = s.discard;
      this.turnOwnerId = s.turnOwnerId;
      this.donkeyDrawCount = s.donkeyDrawCount;
      this.auction = s.auction;
      this.cow = s.cow;
      this.log = s.log;
      this.stateVersion = s.stateVersion;
    },

    /**
     * 產生可持久化至 localStorage 的快照。
     * Cow 的 secret 僅 Host 記憶體，不得持久化。
     */
    serializeForPersist(): GameState {
      const cowSanitized =
        this.cow == null
          ? null
          : {
              ...this.cow,
              initiatorSecret: undefined,
              targetSecret: undefined
            };

      return {
        phase: this.phase,
        players: this.players.map(p => ({
          id: p.id,
          name: p.name,
          moneyCards: p.moneyCards.map(mc => ({ id: mc.id, value: mc.value })),
          animals: { ...p.animals }
        })),
        deck: this.deck.map(c => ({ id: c.id, kind: c.kind, animal: c.animal })),
        discard: this.discard.map(c => ({ id: c.id, kind: c.kind, animal: c.animal })),
        turnOwnerId: this.turnOwnerId,
        donkeyDrawCount: this.donkeyDrawCount,
        auction: this.auction
          ? {
              auctioneerId: this.auction.auctioneerId,
              card: this.auction.card
                ? { id: this.auction.card.id, kind: this.auction.card.kind, animal: this.auction.card.animal }
                : undefined,
              highest: this.auction.highest
                ? {
                    playerId: this.auction.highest.playerId,
                    moneyCardIds: [...this.auction.highest.moneyCardIds],
                    total: this.auction.highest.total,
                    ts: this.auction.highest.ts,
                    actionId: this.auction.highest.actionId
                  }
                : undefined,
              passes: [...this.auction.passes],
              closed: this.auction.closed
            }
          : null,
        cow: cowSanitized,
        log: [...this.log],
        stateVersion: this.stateVersion
      };
    }
  }
});

export type GameStore = ReturnType<typeof useGameStore>;
