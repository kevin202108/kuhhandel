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
} from '@/types/game';
import {
  SET_SIZE,
  DONKEY_PAYOUTS,
  ANIMAL_SCORES,
  START_MONEY,
  MONEY_DENOMS,
} from '@/services/rules';
import { nanoid } from 'nanoid';

/**
 * 小工具：Fisher–Yates 洗牌（就地）
 */
function shuffleInPlace<T>(arr: T[], rng: () => number = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = temp;
  }
}

/**
 * 嘗試讀入 /src/data/deck.json（可選）。
 * 若不存在，回傳 null；呼叫端自行 fallback。
 * 使用 import.meta.glob 以避免檔案不存在時打包錯誤。
 */
function tryLoadDeckJson():
  | { animals: Animal[]; setSize: number }
  | null {
  // 注意：相對於本檔案位置的路徑（src/store -> src/data）
  const mods = import.meta.glob<{ default: { animals: Animal[]; setSize: number } }>(
    '../data/deck.json',
    { eager: true }
  );
  const mod = Object.values(mods)[0] as any | undefined;
  if (!mod || !mod.default) return null;
  return mod.default;
}

/**
 * 依規則（或 deck.json）產生全套牌庫（每動物各 setSize 張）
 */
function buildFullDeck(): Card[] {
  const fromJson = tryLoadDeckJson();
  const animals: Animal[] = fromJson?.animals ?? ([
    'chicken',
    'goose',
    'cat',
    'dog',
    'sheep',
    'snake',
    'donkey',
    'pig',
    'cow',
    'horse',
  ] as Animal[]);
  const setSize = fromJson?.setSize ?? SET_SIZE;

  const deck: Card[] = [];
  for (const a of animals) {
    for (let i = 0; i < setSize; i++) {
      deck.push({ id: `card-${a}-${i}-${nanoid(6)}`, kind: 'animal', animal: a });
    }
  }
  return deck;
}

/**
 * 產生起始錢卡（依 START_MONEY）
 */
function buildStartingMoney(): MoneyCard[] {
  const cards: MoneyCard[] = [];
  // 依 MONEY_DENOMS 的順序生成，確保測試可預測
  for (const denom of MONEY_DENOMS) {
    const count = (START_MONEY as Record<number, number>)[denom as number] ?? 0;
    for (let i = 0; i < count; i++) {
      cards.push({ id: `m-${denom}-${i}-${nanoid(6)}`, value: denom as MoneyDenom });
    }
  }
  return cards;
}

/**
 * 建立空的玩家動物表
 */
function emptyAnimals(): Record<Animal, number> {
  return {
    chicken: 0,
    goose: 0,
    cat: 0,
    dog: 0,
    sheep: 0,
    snake: 0,
    donkey: 0,
    pig: 0,
    cow: 0,
    horse: 0,
  };
}

/**
 * 計算某玩家完成的 4 張組數
 */
function completeSetCount(p: Player): number {
  let c = 0;
  for (const a of Object.keys(p.animals) as Animal[]) {
    if (p.animals[a] >= SET_SIZE) c++;
  }
  return c;
}

/**
 * 計算某玩家的「自有動物分值總和」
 * 規則：玩家對每一種「自己至少持有 1 張」的動物，獲得該動物的基礎分值（取自 ANIMAL_SCORES）
 */
function animalBaseSum(p: Player): number {
  let sum = 0;
  for (const a of Object.keys(p.animals) as Animal[]) {
    if (p.animals[a] > 0) sum += ANIMAL_SCORES[a];
  }
  return sum;
}

/**
 * 終局判定：
 * 「所有動物種類至少有一位玩家集滿 SET_SIZE=4」
 */
function isGameEnd(players: Player[]): boolean {
  const animals = Object.keys(players[0]?.animals ?? emptyAnimals()) as Animal[];
  return animals.every((a) => players.some((p) => p.animals[a] >= SET_SIZE));
}

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
    hostId: '',
    stateVersion: 0,
    lastAwarded: null,
  }),

  getters: {
    activePlayer(state): Player | undefined {
      return state.players.find((p) => p.id === state.turnOwnerId);
    },
    playerById: (state) => (id: string) => state.players.find((p) => p.id === id),
    /**
     * 仍可拍賣的動物（目前牌庫中還有的，且未被鎖）
     * 方便 UI 做提示；若不需要可忽略。
     */
    remainingAuctionableAnimals(state): Animal[] {
      const counts: Record<Animal, number> = {
        chicken: 0,
        goose: 0,
        cat: 0,
        dog: 0,
        sheep: 0,
        snake: 0,
        donkey: 0,
        pig: 0,
        cow: 0,
        horse: 0,
      };
      for (const c of state.deck) counts[c.animal]++;
      return (Object.keys(counts) as Animal[]).filter(
        (a) => counts[a] > 0 && !this.isAnimalLocked(a)
      );
    },
    /**
     * 第一回合或牌庫判斷：這裡簡化為「牌庫還有牌就能拍賣」
     */
    canChooseAuction(state): boolean {
      return state.deck.length > 0;
    },
    /**
     * 當前玩家是否可以發起牛交易（完整的規則檢查）
     */
    canChooseCowTrade(): boolean {
      const me = this.activePlayer;
      if (!me || this.phase !== 'turn.choice') return false;

      // 第一回合不能牛交易
      if (this.players.every(p => Object.values(p.animals).reduce((a, b) => a + b, 0) === 0)) {
        return false;
      }

      // 必須有錢卡
      if (me.moneyCards.length === 0) return false;

      // 必須有其他玩家持有相同動物
      return this.players.some(otherPlayer => {
        if (otherPlayer.id === me.id) return false;
        return Object.keys(me.animals).some(animal =>
          (me.animals[animal as Animal] || 0) > 0 && (otherPlayer.animals[animal as Animal] || 0) > 0
        );
      });
    },
    /**
     * 是否已被鎖（任一玩家達成 4 張）
     */
    isAnimalLocked: (state) => (animal: Animal): boolean =>
      state.players.some((p) => p.animals[animal] >= SET_SIZE),
  },

  actions: {
    bumpVersion() {
      this.stateVersion++;
    },

    appendLog(msg: string) {
      this.log.push(msg);
      this.bumpVersion();
    },

    /**
     * Phase 2: 設定/更新 Host Id（presence/election 後由網路層設定）
     */
    setHostId(id: string) {
      this.hostId = id;
      this.bumpVersion();
    },

    /**
     * Phase 2: 由 Host 下發的完整快照覆蓋本地狀態。
     * 注意：為避免 Proxy 汙染，請確保傳入為可序列化的 plain object。
     */
    applySnapshot(next: GameState) {
      // 直接覆蓋整個 $state（Pinia 支援）
      // 保留函式與 getter 邏輯不變。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$state = next as unknown as GameState;
    },

    /**
     * 初始化遊戲：
     * - 建立 players（起始錢卡、空動物）
     * - 產生或讀入 deck，並 Fisher–Yates 洗牌
     * - 指定回合擁有者為 players[0]
     * - phase → 'turn.choice' 交給 startTurn() 處理
     */
    setupGame(players: Array<{ id: string; name: string }>) {
      // players
      const startingMoney = buildStartingMoney();
      this.players = players.map((u) => ({
        id: u.id,
        name: u.name,
        moneyCards: startingMoney.map((m) => ({ ...m, id: `p-${u.id}-${m.id}` })), // 每位玩家拷貝一份起始錢卡
        animals: emptyAnimals(),
      }));

      // deck
      this.deck = buildFullDeck();
      shuffleInPlace(this.deck);

      this.discard = [];
      this.turnOwnerId = this.players[0]?.id ?? '';
      this.donkeyDrawCount = 0;
      this.auction = null;
      this.cow = null;
      this.log = [];
      this.stateVersion = 0;

      this.appendLog('Game setup complete.');
    },

    /**
     * 進入選擇回合（Phase 0 已做過；保留方法便於外部一致呼叫）
     */
    startTurn() {
      this.phase = 'turn.choice';
      this.bumpVersion();
    },

    /**
     * 從牌庫頂抽一張進入拍賣；若為驢子，立即發放對應獎勵
     * 回傳抽到的 Card（供 auction store 使用）
     */
    drawCardForAuction(): Card {
      if (this.deck.length === 0) {
        throw new Error('Deck is empty.');
      }
      const card = this.deck.shift() as Card; // 一定存在
      this.appendLog(`Drawn card for auction: ${card.animal}.`);

      if (card.animal === 'donkey') {
        this.grantDonkeyPayout();
      }
      return card;
    },

    /**
     * 驢子發錢（第 1~4 張依序 +50/+100/+200/+500）
     * - 只在抽到驢子時呼叫
     * - 上限 4 次（多於 4 次也不再發）
     */
    grantDonkeyPayout() {
      const idx = this.donkeyDrawCount; // 0-based
      if (idx >= DONKEY_PAYOUTS.length) {
        this.appendLog('Donkey payout already completed (4/4).');
        return;
      }
      const value = DONKEY_PAYOUTS[idx as 0|1|2|3] as MoneyDenom;
      for (const p of this.players) {
        p.moneyCards.push({ id: `donkey-${value}-${nanoid(6)}`, value });
      }
      this.donkeyDrawCount = (this.donkeyDrawCount + 1) as 0 | 1 | 2 | 3 | 4;
      this.appendLog(`Donkey payout #${idx + 1}: +${value} to everyone.`);
      this.bumpVersion();
    },

    /**
     * 輪轉回合擁有者（循環）
     */
    rotateTurn() {
      if (this.players.length === 0) return;
      const idx = this.players.findIndex((p) => p.id === this.turnOwnerId);
      const nextIdx = idx < 0 ? 0 : (idx + 1) % this.players.length;
      const next = this.players[nextIdx]!; // <- 非空斷言
      this.turnOwnerId = next.id;
      this.appendLog(`Turn rotates to: ${next.name}.`);
      this.bumpVersion();
      this.startTurn();
    },

    /**
     * 計分：
     * 玩家總分 =（完成 4 張的那些動物的分值總和）×（完成 4 張的動物組數）
     * - 自有動物分值總和：該玩家擁有數量 > 0 的所有動物分值相加
     * - 完成組數：該玩家動物種類中，數量 >= SET_SIZE 的種類數
     */
    computeFinalScores(): Array<{ playerId: string; score: number }> {
      const setSize = SET_SIZE;

      const scoreOf = (animal: Animal) => ANIMAL_SCORES[animal];

      const results = this.players.map(p => {
        // 1) 找出完成 4 張的動物種類
        const completedAnimals: Animal[] = (Object.keys(p.animals) as Animal[])
          .filter(a => (p.animals[a] ?? 0) >= setSize);

        // 2) 底和＝只對「完成組」的動物加總分值
        const baseSum = completedAnimals.reduce((sum, a) => sum + scoreOf(a), 0);

        // 3) 組數＝完成組的種類數
        const completedSets = completedAnimals.length;

        // 4) 最終分數
        const total = baseSum * completedSets;

        return { playerId: p.id, score: total };
      });

      // 高分在前（可選）
      results.sort((a, b) => b.score - a.score);
      return results;
    },

    /**
     * 回合結束後檢查終局；若終局則切到 'game.end'
     * （不做其他副作用，外部可視需要先呼叫 rotateTurn 再呼叫本函式）
     */
    checkEndAndMaybeFinish() {
      if (this.players.length === 0) return;
      if (isGameEnd(this.players)) {
        this.phase = 'game.end';
        this.appendLog('Game finished.');
        this.bumpVersion();
      } else {
        // 若尚未結束，保持目前 phase（通常會在外部 rotateTurn → startTurn）
        this.appendLog('Game continues.');
      }
    },
  },
});
