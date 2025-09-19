// src/store/cow.ts
import { defineStore } from 'pinia';
import { useGameStore } from './game';
import type { Animal, CowTradeState, MoneyCard, Player } from '@/types/game';

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function getPlayerById(game: any, id: string): Player {
  const p = game.players.find((x: Player) => x.id === id);
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

export const useCowStore = defineStore('cow', {
  state: (): CowTradeState => ({
    initiatorId: undefined,
    targetPlayerId: undefined,
    targetAnimal: undefined,
    initiatorSecret: undefined,
    targetSecret: undefined,
  }),

  getters: {
    // 計算預期的交易動物數量
    tradeAmount(): number {
      const game = useGameStore();
      if (!this.targetPlayerId || !this.targetAnimal) return 0;

      const initiator = game.players.find(p => p.id === this.initiatorId);
      const target = game.players.find(p => p.id === this.targetPlayerId);

      if (!initiator || !target) return 0;

      const initiatorCount = initiator.animals[this.targetAnimal] || 0;
      const targetCount = target.animals[this.targetAnimal] || 0;

      return (initiatorCount >= 2 && targetCount >= 2) ? 2 : 1;
    },

    // 檢查是否可以發起牛交易
    canInitiateCowTrade(): boolean {
      const game = useGameStore();
      const me = game.activePlayer;
      if (!me || game.phase !== 'turn.choice') return false;

      // 第一回合不能牛交易
      if (game.players.every(p => Object.values(p.animals).reduce((a, b) => a + b, 0) === 0)) {
        return false;
      }

      // 必須有錢卡
      if (me.moneyCards.length === 0) return false;

      // 必須有其他玩家持有相同動物
      return game.players.some(otherPlayer => {
        if (otherPlayer.id === me.id) return false;
        return Object.keys(me.animals).some(animal =>
          (me.animals[animal as Animal] || 0) > 0 && (otherPlayer.animals[animal as Animal] || 0) > 0
        );
      });
    },

    // 獲取可交易的動物列表
    availableAnimals(): Animal[] {
      const game = useGameStore();
      if (!this.targetPlayerId) return [];

      const initiator = game.players.find(p => p.id === this.initiatorId);
      const target = game.players.find(p => p.id === this.targetPlayerId);

      if (!initiator || !target) return [];

      const initiatorAnimals = Object.keys(initiator.animals).filter(animal =>
        (initiator.animals[animal as Animal] || 0) > 0
      ) as Animal[];

      return initiatorAnimals.filter(animal =>
        (target.animals[animal] || 0) > 0
      );
    },

    // 獲取可交易的目標玩家列表
    availableTargets(): Player[] {
      const game = useGameStore();
      const me = game.activePlayer;
      if (!me) return [];

      return game.players.filter(otherPlayer => {
        if (otherPlayer.id === me.id) return false;

        // 檢查是否有共同動物
        return Object.keys(me.animals).some(animal =>
          (me.animals[animal as Animal] || 0) > 0 && (otherPlayer.animals[animal as Animal] || 0) > 0
        );
      });
    },
  },

  actions: {
    syncGameCow() {
      const game = useGameStore();
      // 同步到 game store
      (game as any).$state.cow = {
        initiatorId: this.initiatorId,
        targetPlayerId: this.targetPlayerId,
        targetAnimal: this.targetAnimal,
        // 注意：secret 不應該同步到所有玩家，只在 host 端記憶
      };
    },

    // 發起牛交易
    initiateCowTrade() {
      const game = useGameStore();
      if (!this.canInitiateCowTrade) return;

      this.reset();
      this.initiatorId = game.turnOwnerId;
      game.phase = 'cow.selectTarget';
      this.syncGameCow();
      game.appendLog(`${game.activePlayer?.name} 發起牛交易`);
    },

    // 選擇目標玩家
    selectTarget(targetPlayerId: string) {
      const game = useGameStore();
      this.targetPlayerId = targetPlayerId;
      game.phase = 'cow.selectAnimal';
      this.syncGameCow();
      game.appendLog(`選擇 ${game.players.find((p: Player) => p.id === targetPlayerId)?.name} 作為交易對象`);
    },

    // 選擇交易動物
    selectAnimal(animal: Animal) {
      const game = useGameStore();
      this.targetAnimal = animal;
      game.phase = 'cow.commit';
      this.syncGameCow();
    },

    // 發起者提交錢卡選擇
    commitInitiator(moneyCardIds: string[]) {
      this.initiatorSecret = moneyCardIds;
      this.syncGameCow();
      this.checkBothCommitted();
    },

    // 目標者提交錢卡選擇
    commitTarget(moneyCardIds: string[]) {
      this.targetSecret = moneyCardIds;
      this.syncGameCow();
      this.checkBothCommitted();
    },

    // 檢查雙方是否都已提交
    checkBothCommitted() {
      console.log('[DEBUG] checkBothCommitted', {
        initiatorSecret: this.initiatorSecret ? this.initiatorSecret.length : 'none',
        targetSecret: this.targetSecret ? this.targetSecret.length : 'none',
        canReveal: this.initiatorSecret && this.targetSecret
      });
      const game = useGameStore();
      if (this.initiatorSecret && this.targetSecret) {
        game.phase = 'cow.reveal';
        this.revealAndSettle();
      }
    },

    // 揭示並結算交易
    revealAndSettle() {
      const game = useGameStore();
      if (!this.initiatorId || !this.targetPlayerId || !this.targetAnimal ||
          !this.initiatorSecret || !this.targetSecret) return;

      const initiator = getPlayerById(game.$state, this.initiatorId);
      const target = getPlayerById(game.$state, this.targetPlayerId);

      const initiatorTotal = moneyTotalOf(initiator, this.initiatorSecret);
      const targetTotal = moneyTotalOf(target, this.targetSecret);

      const tradeAmount = this.tradeAmount;

      if (initiatorTotal > targetTotal) {
        // 發起者贏
        this.executeTrade(initiator, target, tradeAmount, this.initiatorSecret, this.targetSecret);
        game.lastAwarded = { playerId: initiator.id, animal: this.targetAnimal };
        game.appendLog(`${initiator.name} 贏得交易，獲得 ${tradeAmount} 隻 ${this.targetAnimal}`);
      } else if (targetTotal > initiatorTotal) {
        // 目標者贏
        this.executeTrade(target, initiator, tradeAmount, this.targetSecret, this.initiatorSecret);
        game.lastAwarded = { playerId: target.id, animal: this.targetAnimal };
        game.appendLog(`${target.name} 贏得交易，獲得 ${tradeAmount} 隻 ${this.targetAnimal}`);
      } else {
        // 平手
        game.appendLog('交易平手，沒有動物交換');
      }

      game.phase = 'turn.end';
      this.reset();
      this.syncGameCow();

      // 檢查遊戲結束
      game.checkEndAndMaybeFinish();
      if (game.phase === 'turn.end') {
        game.rotateTurn();
        game.startTurn();
      }
    },

    // 執行動物和錢卡交換
    executeTrade(winner: Player, loser: Player, amount: number, winnerCards: string[], loserCards: string[]) {
      const game = useGameStore();

      // 交換動物
      winner.animals[this.targetAnimal!] = (winner.animals[this.targetAnimal!] || 0) + amount;
      loser.animals[this.targetAnimal!] = (loser.animals[this.targetAnimal!] || 0) - amount;

      // 交換錢卡
      const winnerCardObjects: MoneyCard[] = [];
      winner.moneyCards = winner.moneyCards.filter(card => {
        if (winnerCards.includes(card.id)) {
          winnerCardObjects.push(card);
          return false;
        }
        return true;
      });

      const loserCardObjects: MoneyCard[] = [];
      loser.moneyCards = loser.moneyCards.filter(card => {
        if (loserCards.includes(card.id)) {
          loserCardObjects.push(card);
          return false;
        }
        return true;
      });

      winner.moneyCards.push(...loserCardObjects);
      loser.moneyCards.push(...winnerCardObjects);
    },

    // 取消牛交易
    cancelCowTrade() {
      const game = useGameStore();
      game.appendLog('牛交易已取消');
      game.phase = 'turn.end';
      this.reset();
      this.syncGameCow();

      game.checkEndAndMaybeFinish();
      if (game.phase === 'turn.end') {
        game.rotateTurn();
        game.startTurn();
      }
    },

    // 重置狀態
    reset() {
      this.initiatorId = undefined;
      this.targetPlayerId = undefined;
      this.targetAnimal = undefined;
      this.initiatorSecret = undefined;
      this.targetSecret = undefined;
    },
  },
});
