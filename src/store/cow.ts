// src/store/cow.ts
import { defineStore } from 'pinia';
import { useGameStore } from './game';
import type { Animal, CowTradeState, GameState, MoneyCard, Player } from '@/types/game';

/**
 * Cow Trade Store（Phase 2：Host-only mutation，Dispatcher 才會呼叫）
 *
 * - selectTarget(targetPlayerId): 建立/更新 cow 狀態，phase='cow.selectAnimal'
 * - selectAnimal(animal): 檢查未鎖，phase='cow.commit'
 * - commitSecret(playerId, moneyCardIds): 僅 Host 記憶體（不廣播、不持久化）
 * - revealAndResolve(): 平手不交換；否則勝者拿 1/2 張，互換提交錢卡；phase='turn.end'
 * - cancelOnHostMigration(): 若在 commit/reveal 發生 Host 遷移，取消本回合
 *
 * ✅ 本檔保證：
 *   1) Store state 只存 JSON 可序列化的 plain object / array / primitive。
 *   2) 寫入 this.cow 一律走 setCow()，用 JSON 深拷貝存「乾淨快照」。
 */

function clonePlain<T>(v: T): T {
  // 僅允許 JSON 結構；若含 Proxy/函式/不可序列化型別會在這裡被剔除或報錯。
  return JSON.parse(JSON.stringify(v)) as T;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function getPlayerById(game: GameState, id: string): Player {
  const p = game.players.find((x) => x.id === id);
  if (!p) throw new Error(`Player not found: ${id}`);
  return p;
}

function ensureOwnsMoneyCards(player: Player, moneyCardIds: string[]): void {
  const set = new Set(player.moneyCards.map((m) => m.id));
  for (const id of moneyCardIds) {
    if (!set.has(id)) {
      throw new Error(`Money card ${id} not owned by player ${player.id}`);
    }
  }
}

function totalOf(player: Player, moneyCardIds: string[]): number {
  const byId = new Map(player.moneyCards.map((m) => [m.id, m] as const));
  let total = 0;
  for (const id of moneyCardIds) {
    const card = byId.get(id);
    if (!card) throw new Error(`Money card ${id} not found in player ${player.id}`);
    total += card.value;
  }
  return total;
}

function moveMoneyCards(src: Player, dst: Player, ids: string[]): number {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);
  const moved: MoneyCard[] = [];
  src.moneyCards = src.moneyCards.filter((m) => {
    if (idSet.has(m.id)) {
      moved.push(m);
      return false;
    }
    return true;
  });
  dst.moneyCards.push(...moved);
  return moved.length;
}

export const useCowStore = defineStore('cow', {
  state: () => ({
    // 只放 JSON 可序列化的資料結構；不放 Set/Map/Ref/函式
    cow: null as CowTradeState | null
  }),

  actions: {
    // 統一寫入入口：存乾淨快照，避免把 reactive 代理或非 JSON 值寫入 state
    setCow(next: CowTradeState | null): void {
      this.cow = next === null ? null : clonePlain(next);
    },

    /**
     * 選擇目標玩家（必須有動物）
     * - 建立 cow 狀態（只放必要鍵，避免在 exactOptionalPropertyTypes 下給 undefined）
     * - 進入 'cow.selectAnimal'
     */
    selectTarget(targetPlayerId: string): void {
      const game = useGameStore();
      if (game.phase !== 'cow.selectTarget' && game.phase !== 'turn.choice') return;

      const initiatorId = game.turnOwnerId;
      const target = getPlayerById(game.$state, targetPlayerId);
      const targetHasAnimals = Object.values(target.animals).some((n) => (n ?? 0) > 0);
      if (!targetHasAnimals) throw new Error('Target player has no animals');

      const next: CowTradeState = {
        initiatorId,
        targetPlayerId
        // 注意：不要把 undefined 欄位寫進去（exactOptionalPropertyTypes）
      };
      this.setCow(next);

      game.phase = 'cow.selectAnimal';
      game.appendLog(
        `Cow Trade 發起：${getPlayerById(game.$state, initiatorId).name} → 目標 ${target.name}`
      );
    },

    /**
     * 指定動物（目標玩家持有 & 未被鎖），進入 'cow.commit'
     */
    selectAnimal(animal: Animal): void {
      const game = useGameStore();
      const c = this.cow;
      if (!c || game.phase !== 'cow.selectAnimal') return;

      const target = getPlayerById(game.$state, c.targetPlayerId!);
      const count = target.animals[animal] ?? 0;
      if (count <= 0) throw new Error('Target does not own this animal');
      if (game.isAnimalLocked(animal)) throw new Error('Selected animal is locked');

      const next: CowTradeState = { ...c, targetAnimal: animal };
      this.setCow(next);

      game.phase = 'cow.commit';
      game.appendLog(`Cow Trade 指定動物：${animal}`);
    },

    /**
     * 秘密出錢（只存 Host 記憶體）
     * - 僅 initiator/target 可提交
     * - 兩邊都提交後 → 'cow.reveal'
     */
    commitSecret(playerId: string, moneyCardIds: string[]): void {
      const game = useGameStore();
      const c = this.cow;
      if (!c || game.phase !== 'cow.commit') return;

      const { initiatorId, targetPlayerId } = c;
      if (playerId !== initiatorId && playerId !== targetPlayerId) {
        throw new Error('Only initiator or target can commit secret');
      }

      const player = getPlayerById(game.$state, playerId);
      const cleanIds = uniq(moneyCardIds); // 不存重複
      ensureOwnsMoneyCards(player, cleanIds);

      let next: CowTradeState;
      if (playerId === initiatorId) {
        next = { ...c, initiatorSecret: clonePlain(cleanIds) };
      } else {
        next = { ...c, targetSecret: clonePlain(cleanIds) };
      }
      this.setCow(next);

      const bothCommitted = Boolean(next.initiatorSecret && next.targetSecret);
      if (bothCommitted) {
        game.phase = 'cow.reveal';
        game.appendLog('Cow Trade 雙方已提交秘密出價，進入揭示');
      }
    },

    /**
     * 揭示與結算：
     * - 平手：不交換動物與錢卡
     * - 否則：勝者拿 1/2 張對應動物（雙方各 ≥2 → 2；否則 1），雙方互換提交錢卡
     */
    revealAndResolve(): void {
      const game = useGameStore();
      const c = this.cow;
      if (!c || (game.phase !== 'cow.reveal' && game.phase !== 'cow.commit')) return;
      if (!c.initiatorId || !c.targetPlayerId || !c.targetAnimal) {
        throw new Error('Invalid cow state');
      }
      if (!c.initiatorSecret || !c.targetSecret) {
        return; // 還未雙方都提交
      }

      const initiator = getPlayerById(game.$state, c.initiatorId);
      const target = getPlayerById(game.$state, c.targetPlayerId);
      const animal = c.targetAnimal;

      // 驗證與計算（以 Host 的玩家持有為準）
      ensureOwnsMoneyCards(initiator, c.initiatorSecret);
      ensureOwnsMoneyCards(target, c.targetSecret);
      const initiatorTotal = totalOf(initiator, c.initiatorSecret);
      const targetTotal = totalOf(target, c.targetSecret);

      if (initiatorTotal === targetTotal) {
        game.appendLog('Cow Trade 平手：不交換動物與錢卡');
        game.phase = 'turn.end';
        this.setCow(null);
        return;
      }

      const winner = initiatorTotal > targetTotal ? initiator : target;
      const loser = winner === initiator ? target : initiator;

      const winnerCount = winner.animals[animal] ?? 0;
      const loserCount = loser.animals[animal] ?? 0;
      const transferCount = winnerCount >= 2 && loserCount >= 2 ? 2 : 1;

      if ((loser.animals[animal] ?? 0) <= 0) {
        throw new Error('Loser does not have the animal to transfer');
      }
      const actualTransfer = Math.min(transferCount, loser.animals[animal] ?? 0);
      loser.animals[animal] = (loser.animals[animal] ?? 0) - actualTransfer;
      winner.animals[animal] = (winner.animals[animal] ?? 0) + actualTransfer;

      const movedToTarget = moveMoneyCards(initiator, target, c.initiatorSecret);
      const movedToInitiator = moveMoneyCards(target, initiator, c.targetSecret);

      game.appendLog(
        `Cow Trade 結果：${
          winner.id === initiator.id ? '發起者' : '目標者'
        }勝出，移轉 ${animal} ×${actualTransfer}；錢卡互換（→目標 ${movedToTarget} 張，→發起 ${movedToInitiator} 張）`
      );

      game.phase = 'turn.end';
      this.setCow(null);
    },

    /**
     * Phase 2 特例：Host 遷移若發生於 cow.commit / cow.reveal → 取消本回合
     */
    cancelOnHostMigration(): void {
      const game = useGameStore();
      if (!this.cow) return;
      if (game.phase === 'cow.commit' || game.phase === 'cow.reveal') {
        game.appendLog('Host 遷移發生於 Cow Trade，已取消本回合並回到選擇階段');
        this.setCow(null);
        game.phase = 'turn.choice';
      }
    }
  }
});
