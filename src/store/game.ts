// src/store/game.ts
import { defineStore } from 'pinia';
import type {
  Animal,
  Card,
  GameState,
  MoneyCard,
  MoneyDenom,
  Phase,
  Player,
} from '../types/game';
import {
  SET_SIZE,
  MONEY_DENOMS,
  START_MONEY,
  DONKEY_PAYOUTS,
  ANIMAL_SCORES,
} from '../services/rules';

// ---------- 小工具 ----------

// 簡單唯一 ID（避免額外依賴；專案可之後改成 utils/id.ts）
const genId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const sum = (nums: number[]) => nums.reduce((acc, n) => acc + n, 0);

// 由分數表推得「遊戲內所有動物清單」；型別斷言為已知字面量聯集
const ANIMALS = Object.keys(ANIMAL_SCORES) as Animal[];

// ---------- Store ----------
export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    phase: 'setup',
    players: [],
    deck: [],
    discard: [],
    turnOwnerId: '',
    donkeyDrawCount: 0,
    auction: null, // 讓其他模組能安全讀到（此檔不實作拍賣邏輯）
    cow: null, // 同上
    log: [],
    stateVersion: 0,
  }),

  getters: {
    activePlayer(state): Player {
      const p = state.players.find((x) => x.id === state.turnOwnerId);
      if (!p) {
        // 若未設置 turnOwnerId，回傳第一位（setup 後尚未 startTurn）
        return state.players[0] as Player;
      }
      return p;
    },

    playerById: (state) => (id: string) =>
      state.players.find((p) => p.id === id),

    remainingAuctionableAnimals(state): number {
      // 目前牌庫僅有動物牌（含驢子）；保留 kind 判斷以利未來擴充
      return state.deck.filter((c) => c.kind === 'animal').length;
    },

    canChooseAuction(): boolean {
      // 只要牌庫仍有可拍賣動物即可；「第一回合」限制交由 CowTrade 的候選目標為空來自然禁用
      return (this as any).remainingAuctionableAnimals > 0;
    },

    canChooseCowTrade(): boolean {
      // 規格：當前玩家是否有錢（是否能發起；實際是否有可挑戰目標，由 Cow store/畫面再判定）
      const self = (this as any).activePlayer as Player;
      const total = sum(self.moneyCards.map((m) => m.value));
      return total > 0;
    },

    isAnimalLocked: (state) => (animal: Animal): boolean =>
      state.players.some((p) => (p.animals[animal] ?? 0) >= SET_SIZE),
  },

  actions: {
    // ====== 狀態版本與日誌 ======
    bumpVersion() {
      this.stateVersion += 1;
    },
    appendLog(msg: string) {
      this.log.push(msg);
      this.bumpVersion();
    },

    // ====== 初始化 / 建局 ======
    setupGame(playersInput: Array<{ id: string; name: string }>) {
      // 1) 建立玩家並發起始錢
      this.players = playersInput.map(({ id, name }) => {
        const moneyCards: MoneyCard[] = [];
        const pushMoney = (value: MoneyDenom, count: number) => {
          for (let i = 0; i < count; i++) {
            moneyCards.push({ id: genId(), value });
          }
        };
        // 發起始錢：2×0、4×10、1×50
        (Object.keys(START_MONEY) as unknown as MoneyDenom[]).forEach(
          (denom) => {
            const count = START_MONEY[denom] ?? 0;
            pushMoney(denom, count);
          },
        );

        // 動物起始牌：0
        const animals = Object.fromEntries(
          ANIMALS.map((a) => [a, 0]),
        ) as Player['animals'];

        return { id, name, moneyCards, animals };
      });

      // 2) 建立牌庫：每種動物固定 4 張（含驢子）
      const deck: Card[] = [];
      for (const animal of ANIMALS) {
        for (let i = 0; i < SET_SIZE; i++) {
          deck.push({ id: genId(), kind: 'animal', animal });
        }
      }
      this.deck = shuffle(deck);
      this.discard = [];

      // 3) 其他欄位
      this.turnOwnerId = this.players[0]?.id ?? '';
      this.donkeyDrawCount = 0;
      this.auction = null;
      this.cow = null;
      this.log = [];
      this.phase = 'setup';
      this.bumpVersion();

      this.appendLog(
        `🎲 遊戲建立：玩家 ${this.players
          .map((p) => p.name)
          .join('、')}，牌庫 ${this.deck.length} 張`,
      );
    },

    // ====== 回合流轉 ======
    startTurn() {
      this.phase = 'turn.choice';
      this.bumpVersion();
      this.appendLog(`👉 輪到 ${this.activePlayer.name}`);
    },

    rotateTurn() {
      if (this.players.length === 0) return;
      const idx = this.players.findIndex((p) => p.id === this.turnOwnerId);
      const nextIdx = (idx + 1) % this.players.length;
      this.turnOwnerId = this.players[nextIdx].id;
      this.bumpVersion();
    },

    // ====== 拍賣用的抽牌（MVP：僅提供方法，實際邏輯在 auction store） ======
    drawCardForAuction(): Card {
      if (this.deck.length === 0) {
        throw new Error('[game] drawCardForAuction: deck is empty');
      }
      const card = this.deck.shift() as Card;
      this.bumpVersion();
      return card;
    },

    // ====== 驢子發錢（事件效果；拍賣流程在別的 store 觸發此方法） ======
    // store/game.ts 中的 grantDonkeyPayout()
    grantDonkeyPayout() {
    const index = this.donkeyDrawCount; // 0|1|2|3|4

    if (index >= DONKEY_PAYOUTS.length) {
        this.appendLog('🫏 驢子發錢略過（已達 4 次上限）');
        return;
    }

    // ※ 型別窄化（守門後保證 0..3）
    const amount = DONKEY_PAYOUTS[index as import('../services/rules').DonkeyPayoutIndex];

    this.players.forEach((p) => {
        let remain = amount;
        const sorted = [...MONEY_DENOMS].sort((a, b) => b - a);
        for (const d of sorted) {
        while (remain >= d && d !== 0) {
            p.moneyCards.push({ id: genId(), value: d });
            remain -= d;
        }
        }
    });

    this.donkeyDrawCount = (this.donkeyDrawCount + 1) as 0 | 1 | 2 | 3 | 4;
    this.bumpVersion();
    this.appendLog(`🫏 驢子事件：所有玩家各獲得 $${amount}`);
    },

    // ====== 終局判定與計分 ======
    checkEndAndMaybeFinish() {
      // 終局條件：所有動物種類「至少一位玩家」達到 4 張
      const allKindsResolved = ANIMALS.every((animal) =>
        this.players.some((p) => (p.animals[animal] ?? 0) >= SET_SIZE),
      );

      if (allKindsResolved) {
        this.phase = 'game.end';
        this.bumpVersion();

        const results = this.computeFinalScores();
        const ranking = [...results].sort((a, b) => b.score - a.score);
        const names = ranking
          .map(
            (r, i) =>
              `${i + 1}. ${this.playerById(r.playerId)?.name ?? r.playerId}（${r.score}）`,
          )
          .join('、');
        this.appendLog(`🏁 遊戲結束！名次：${names}`);
      }
    },

    computeFinalScores(): Array<{ playerId: string; score: number }> {
      // 規則：玩家總分 = （自有動物分值總和） × （完成的 4 張組數總和）
      return this.players.map((p) => {
        const animalPoints = ANIMALS.map(
          (a) => (p.animals[a] ?? 0) * ANIMAL_SCORES[a],
        );
        const sumPoints = sum(animalPoints);

        const setCount = ANIMALS.map((a) =>
          Math.floor((p.animals[a] ?? 0) / SET_SIZE),
        ).reduce((acc, n) => acc + n, 0);

        const score = sumPoints * setCount;
        return { playerId: p.id, score };
      });
    },
  },
});
