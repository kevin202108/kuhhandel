export type Animal =
  | 'chicken' | 'goose' | 'cat' | 'dog' | 'sheep'
  | 'snake' | 'donkey' | 'pig' | 'cow' | 'horse';

export type MoneyDenom = 0 | 10 | 50 | 100 | 200 | 500;

export interface MoneyCard { id: string; value: MoneyDenom; }

export interface Player {
  id: string;               // playerId 最小者為 Host（字典序）
  name: string;
  moneyCards: MoneyCard[];
  animals: Record<Animal, number>; // 每種動物持有數
}

export type CardKind = 'animal';
export interface Card { id: string; kind: CardKind; animal: Animal; }

export type Phase =
  | 'setup' | 'turn.choice'
  | 'auction.bidding' | 'auction.closing' | 'auction.buyback' | 'auction.settlement'
  | 'cow.selectTarget' | 'cow.selectAnimal' | 'cow.commit' | 'cow.choose' | 'cow.selectMoney' | 'cow.reveal' | 'cow.settlement'
  | 'turn.end' | 'game.end';

export interface Bid {
  playerId: string;
  moneyCardIds: string[];   // 出價錢卡 id 快照
  total: number;            // 合計
  ts: number;               // Host 接收時間（先到先贏）
  actionId: string;         // 去重
}

export interface AuctionState {
  auctioneerId?: string;
  card?: Card;
  highest?: Bid;            // 僅保留當前最高（同額比 ts）
  passes: string[];         // **JSON 可序列化**（由 Set 改為 string[]）
  closed: boolean;
}

export interface CowTradeState {
  initiatorId?: string;
  targetPlayerId?: string;
  targetAnimal?: Animal;
  initiatorSecret?: string[]; // moneyCardIds（僅 Host 記憶體，不持久化）
  targetSecret?: string[];
  initiatorCardCount?: number;
  targetCardCount?: number;
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
  // Phase 2: Host authority owner for this room. Determined via presence/election.
  hostId?: string;
  stateVersion: number;     // Host 每次更新 +1
  lastAwarded: { playerId: string; animal: Animal } | null; // 追蹤最近獲得的動物
}

// 由 services/rules.ts 輸出常數內容
export interface Rules {
  SET_SIZE: 4;
  MONEY_DENOMS: MoneyDenom[];
  START_MONEY: Record<MoneyDenom, number>; // {0:2, 10:4, 50:1}
  DONKEY_PAYOUTS: [50, 100, 200, 500];
  ANIMAL_SCORES: Record<Animal, number>;
}
