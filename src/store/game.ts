// src/store/game.ts
import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import type {
  Animal,
  Card,
  GameState,
  MoneyCard,
  MoneyDenom,
  Phase,
  Player,
} from '@/types/game';
import * as RULES from '@/services/rules';

/** 產生所有動物鍵且值為 0 的 Record */
function makeEmptyAnimals(): Record<Animal, number> {
  const animals = Object.keys(RULES.ANIMAL_SCORES) as Array<Animal>;
  const rec: Record<Animal, number> = {} as Record<Animal, number>;
  for (const a of animals) rec[a] = 0;
  return rec;
}

/** Fisher–Yates 洗牌（純函式） */
function shuffle<T>(input: readonly T[]): T[] {
  const arr = input.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** 依目前 players（僅取 id/name）建立起始資產（moneyCards / animals） */
function bootstrapPlayersFromNames(rawPlayers: readonly Player[]): Player[] {
  return rawPlayers.map((p) => {
    const moneyCards: MoneyCard[] = [];
    // 以 MONEY_DENOMS 為單一來源，避免 Object.keys() → string[] 型別問題
    for (const denom of RULES.MONEY_DENOMS) {
      const count = RULES.START_MONEY[denom] ?? 0;
      for (let i = 0; i < count; i++) {
        moneyCards.push({ id: nanoid(), value: denom });
      }
    }
    return { id: p.id, name: p.name, moneyCards, animals: makeEmptyAnimals() };
  });
}

/** 依規則產生整副牌（每動物 SET_SIZE 張） */
function buildDeckFromRules(): Card[] {
  const animals = Object.keys(RULES.ANIMAL_SCORES) as Array<Animal>;
  const size = RULES.SET_SIZE;
  const deck: Card[] = [];
  for (const animal of animals) {
    for (let i = 0; i < size; i++) {
      deck.push({ id: nanoid(), kind: 'animal', animal });
    }
  }
  return shuffle(deck);
}

/** 取 players 的最小字典序 id */
function minPlayerId(players: readonly Player[]): string | undefined {
  if (players.length === 0) return undefined;
  return players.map((p) => p.id).sort()[0];
}

/** Host-only 雙重防護（dispatcher 已保證，store 仍強制檢查） */
function assertHostGuard(state: GameState, actorId: string): void {
  if (state.hostId === undefined) {
    throw new Error('[game] Host is not locked yet');
  }
  if (state.hostId !== actorId) {
    throw new Error(`[game] Host-only action denied: actor=${actorId} host=${state.hostId}`);
  }
}

/** 型別縮小：驢子發錢僅允許 0|1|2|3 作為索引 */
function isDonkeyIndex(v: number): v is 0 | 1 | 2 | 3 {
  return v === 0 || v === 1 || v === 2 || v === 3;
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
    // hostId：optional，依 exactOptionalPropertyTypes 規範，不要顯式賦值 undefined
    stateVersion: 0,
  }),

  getters: {
    activePlayer(state): Player | undefined {
      return state.players.find((p) => p.id === state.turnOwnerId);
    },
    playerById:
      (state) =>
      (id: string): Player | undefined =>
        state.players.find((p) => p.id === id),
    remainingAuctionableAnimals(state): Record<Animal, number> {
      const counts = makeEmptyAnimals();
      for (const c of state.deck) {
        counts[c.animal] += 1;
      }
      return counts;
    },
    canChooseAuction(state): boolean {
      // 只需牌庫非空即可（是否第一回合由規則/UX 決定）
      return state.deck.length > 0;
    },
    canChooseCowTrade(state): boolean {
      const me = state.players.find((p) => p.id === state.turnOwnerId);
      return !!me && me.moneyCards.some((m) => m.value > 0);
    },
    isAnimalLocked:
      (state) =>
      (animal: Animal): boolean =>
        state.players.some((p) => p.animals[animal] >= RULES.SET_SIZE),
  },

  actions: {
    /**
     * 僅允許在 setup 期鎖定 Host；若已鎖或 phase 非 setup，直接拒絕。
     * 不檢查 actorId：最小 playerId 的判定由外部流程確保。
     */
    setHostAtSetup(hostId: string): void {
      if (this.phase !== 'setup') {
        throw new Error('[game] setHostAtSetup only allowed in phase=setup');
      }
      if (this.hostId !== undefined && this.hostId !== hostId) {
        throw new Error(`[game] host already locked as ${this.hostId}`);
      }
      this.hostId = hostId;
      this.appendLog(`Host locked: ${hostId}`);
      // stateVersion++ 交由 dispatcher
    },

    /**
     * 依目前 players 名單建立起始資產、牌庫、回合擁有者（預設 host；若未鎖則取最小 id）。
     * 不切 phase；通常 dispatcher 會在之後呼叫 startTurn()。
     * Host-only（身分驗證由 dispatcher 保證；此處不再接 actorId）。
     */
    setupGameFromCurrentPlayers(): void {
      // Host 驗證統一留在 dispatcher；此處不再驗 actorId。
      // assertHostGuard(this.$state, actorId);

      if (this.players.length === 0) {
        throw new Error('[game] cannot setup: no players');
      }

      // 你原本的初始化邏輯保持不變
      this.players = bootstrapPlayersFromNames(this.players);
      this.deck = buildDeckFromRules();
      this.discard = [];
      this.donkeyDrawCount = 0;

      // 確認起始玩家 id（窄化為 string）
      const candidate = this.hostId ?? minPlayerId(this.players);
      if (!candidate) {
        throw new Error('[game] cannot determine first player');
      }
      this.turnOwnerId = candidate;

      // reset 區塊
      this.auction = null;
      this.cow = null;

      this.appendLog('Game setup completed');
      // stateVersion++ 仍由 host-dispatcher 控制
    },

    /**
     * 從牌庫頂抽 1 張（供 Auction 使用），不處理驢子發錢（由外部決策呼叫 grantDonkeyPayout）。
     * Host-only。
     */
    drawCardForAuction(actorId: string): Card {
      assertHostGuard(this.$state, actorId);
      const card = this.deck.pop();
      if (!card) {
        throw new Error('[game] deck is empty');
      }
      return card;
    },

    /**
     * 驢子發錢：依第 1~4 次分別 +50/+100/+200/+500（每位玩家 1 張）。
     * Host-only。使用嚴格縮小避免 tuple 越界型別錯誤。
     */
    grantDonkeyPayout(actorId: string): void {
      assertHostGuard(this.$state, actorId);

      const idx = this.donkeyDrawCount; // 0-based，允許到 4 表示已發完
      if (!isDonkeyIndex(idx)) {
        // idx 為 4 時（已滿 4 次）不再發
        this.appendLog('Donkey payout ignored (already at max)');
        return;
      }

      const denom: MoneyDenom = RULES.DONKEY_PAYOUTS[idx];
      for (const p of this.players) {
        p.moneyCards.push({ id: nanoid(), value: denom });
      }
      // 將 0|1|2|3 遞增為 1|2|3|4（符合 GameState 的 union）
      this.donkeyDrawCount = ((idx + 1) as unknown) as GameState['donkeyDrawCount'];
      this.appendLog(`Donkey payout +${denom} to all players`);
    },

    /** 輪到下一位玩家（Host-only） */
    rotateTurn(actorId: string): void {
      assertHostGuard(this.$state, actorId);
      if (this.players.length === 0) return;
      const order = this.players.map((p) => p.id);
      const i = order.indexOf(this.turnOwnerId);
      const next = order[(i + 1) % order.length] ?? order[0]!;
      this.turnOwnerId = next;
      this.appendLog(`Turn owner → ${next}`);
    },

    /**
     * 計算最終分數：
     * 若玩家完成的動物集合 S，其分數為 Σ(score(a) for a∈S) * |S|
     */
    computeFinalScores(): Array<{ playerId: string; score: number }> {
      return this.players.map((p) => {
        const completed: Animal[] = [];
        for (const a of Object.keys(RULES.ANIMAL_SCORES) as Array<Animal>) {
          if (p.animals[a] >= RULES.SET_SIZE) completed.push(a);
        }
        const base = completed.reduce((sum, a) => sum + RULES.ANIMAL_SCORES[a], 0);
        const score = base * completed.length;
        return { playerId: p.id, score };
      });
    },

    /** 檢查終局條件（所有動物至少一位玩家集滿 4 張）→ 進入 game.end（Host-only） */
    checkEndAndMaybeFinish(actorId: string): void {
      assertHostGuard(this.$state, actorId);
      const animals = Object.keys(RULES.ANIMAL_SCORES) as Array<Animal>;
      const allKindsCompleted = animals.every((a) =>
        this.players.some((p) => p.animals[a] >= RULES.SET_SIZE),
      );
      if (allKindsCompleted) {
        this.phase = 'game.end';
        this.appendLog('Game ended');
      }
    },

    /** 附加一條文字紀錄（不觸發 version 遞增；交由 dispatcher 控制） */
    appendLog(msg: string): void {
      const ts = new Date().toISOString();
      this.log.push(`${ts} - ${msg}`);
    },

    /** 重置到 setup（保留玩家名單但清空資產；Host-only） */
    resetToSetup(actorId: string): void {
      assertHostGuard(this.$state, actorId);
      this.phase = 'setup';
      this.deck = [];
      this.discard = [];
      this.donkeyDrawCount = 0;
      this.auction = null;
      this.cow = null;
      this.players = this.players.map((p) => ({
        id: p.id,
        name: p.name,
        moneyCards: [],
        animals: makeEmptyAnimals(),
      }));
      this.appendLog('Reset to setup');
    },

    /**
     * 用完整快照覆蓋狀態（Client 收到可信 Host 的 state.update 後呼叫）
     * 不做 host 驗證。
     */
    applySnapshot(state: GameState): void {
      if (!state || typeof state !== 'object') {
        throw new Error('[game] invalid snapshot (not an object)');
      }
      if (!Array.isArray(state.players)) {
        throw new Error('[game] invalid snapshot (players missing)');
      }
      // 逐欄位覆寫以維持反應性
      this.phase = state.phase as Phase;
      this.players = state.players;
      this.deck = state.deck;
      this.discard = state.discard;
      this.turnOwnerId = state.turnOwnerId;
      this.donkeyDrawCount = state.donkeyDrawCount;
      this.auction = state.auction;
      this.cow = state.cow;
      this.log = state.log.slice();
      // hostId 可為 undefined：optional 屬性允許被「省略或直接指派值」
      if (state.hostId !== undefined) {
        this.hostId = state.hostId;
      } else {
        delete this.hostId;
      }
      this.stateVersion = state.stateVersion;
    },
  },
});
