// src/store/game.ts
import { defineStore } from 'pinia';
import type {
  GameState,
  Phase,
  Player,
  Card,
  AuctionState,
  CowTradeState
} from '@/types/game';

export const useGameStore = defineStore('game', {
  // 依 README 的 GameState 結構初始化
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

  // 之後可加上 README 所列的 getters（activePlayer、isAnimalLocked 等）
  getters: {},

  actions: {
    /**
     * 初始化遊戲（之後依 README Phase 1 實作：生成/載入牌庫、洗牌、發起玩家等）
     */
    setupGame(_players: Array<{ id: string; name: string }>) {
      // TODO: 實作 deck 生成/洗牌、起始牌面與玩家起始錢卡等
      // 目前為空實作，僅保留介面
    },

    /**
     * 進入回合選擇（之後依 README 實作：phase 切換為 'turn.choice' 並做必要初始化）
     */
    startTurn() {
      // TODO: 將 phase 設為 'turn.choice' 並做回合開始前的初始化
      // 目前為空實作
    },

    /**
     * 加入一筆格式化的日誌（之後依 README 實作：push 到 log，並視需要限制長度）
     */
    appendLog(_msg: string) {
      // TODO: this.log.push(_msg)
      // 目前為空實作
    }
  }
});
