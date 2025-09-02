// src/types/game.ts
export type Animal =
  | 'chicken' | 'goose' | 'cat' | 'dog' | 'sheep'
  | 'snake' | 'donkey' | 'pig' | 'cow' | 'horse';

export type MoneyDenom = 0 | 10 | 50 | 100 | 200 | 500;

export interface MoneyCard {
  id: string;               // 唯一卡 id
  value: MoneyDenom;
}

export interface Player {
  id: string;               // 用於 Host 選定（playerId 最小為 Host）
  name: string;
  moneyCards: MoneyCard[];
  animals: Record<Animal, number>; // 每種動物持有張數
}

export type CardKind = 'animal';
export interface Card {
  id: string;
  kind: CardKind;           // 目前只有 'animal'
  animal: Animal;           // 含 donkey
}

export type Phase =
  | 'setup'
  | 'turn.choice'
  | 'auction.bidding'
  | 'auction.closing'
  | 'auction.settlement'
  | 'cow.selectTarget'
  | 'cow.selectAnimal'
  | 'cow.commit'
  | 'cow.reveal'
  | 'cow.settlement'
  | 'turn.end'
  | 'game.end';

export interface Bid {
  playerId: string;
  moneyCardIds: string[];   // 出價採「錢卡 id 集合快照」
  total: number;            // 由錢卡合計
  ts: number;               // Host 接收時間戳（先送先贏）
  actionId: string;         // 去重
}

export interface AuctionState {
  auctioneerId?: string;    // 主持人=回合主要玩家
  card?: Card;              // 正在拍賣的卡（驢子也會拍）
  highest?: Bid;            // 僅保留最高價（平手比 ts，先到先贏）
  passes: Set<string>;      // 放棄出價玩家（不含主持人）
  closed: boolean;
}

export interface CowTradeState {
  initiatorId?: string;
  targetPlayerId?: string;
  targetAnimal?: Animal;
  initiatorSecret?: string[]; // moneyCardIds（只在 Host 儲存）
  targetSecret?: string[];    // moneyCardIds（只在 Host 儲存）
}

export interface GameState {
  phase: Phase;
  players: Player[];
  deck: Card[];
  discard: Card[];
  turnOwnerId: string;
  donkeyDrawCount: 0 | 1 | 2 | 3 | 4;
  auction: AuctionState | null;
  cow: CowTradeState | null;
  log: string[];
  stateVersion: number;     // Host 每次更新 +1
}

// 規則常數（由 services/rules.ts 提供）
export interface Rules {
  SET_SIZE: 4;
  MONEY_DENOMS: MoneyDenom[];
  START_MONEY: Record<MoneyDenom, number>; // {0:2,10:4,50:1}
  DONKEY_PAYOUTS: [50, 100, 200, 500];     // 順序對應第 1~4 張驢子
  ANIMAL_SCORES: Record<Animal, number>;   // 分數表
}
