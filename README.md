太好了！我把「Phase 2：網路與 Host Authority（Ably 介接）」完整納入，並統一所有介面、型別、流程，**不含任何 `any`**。這一版就是你的**唯一真相來源（SSoT）**：照本實作即可多人同步、Host 驗證、完整快照、重連恢復與 `actionId` 去重。

---

# 🐮🐷🐴 Multiplayer Auction + Cow Trade — Master README（最終版 / SSoT）

> 本文件是**唯一真相來源**。
> 型別、介面、協定、規則、設定檔與指令都以此為準；**禁止使用 `any`**（TypeScript 與 ESLint 皆強制）。

---

## 目錄

1. 專案架構（含每檔案職責）
2. 資料型態（Types）
3. 狀態管理（Pinia Stores）
4. 實時層（Phase 2：Ably／Host Authority／快照／去重）
5. 儲存（Persistence）
6. 元件 / Composables / Services 介面（Interfaces）
7. 通訊協定（Message Types & Envelope）
8. 邏輯邊界與 UX 規則（Business Rules）
9. 設定檔與套件（package.json / tsconfig / vite / eslint / prettier / env / JSON 資料）
10. 開發優先順序（Roadmap）
11. 驗收與測試（Acceptance & Tests）
12. 狀態機圖（Mermaid）
13. 疑難排解：Vitest 設定與常見錯誤

---

## 1) 專案架構（含職責）

```
my-vue-game/
├─ index.html                      # root #app + 載入 main.ts
├─ src/
│  ├─ main.ts                      # 建立 App、Pinia、載入樣式、啟動連線
│  ├─ App.vue                      # 根組件：依 phase/subphase 切頁，改走 dispatch()
│  ├─ assets/
│  │  └─ main.css
│  ├─ components/
│  │  ├─ Hud.vue                   # 玩家/錢/動物/牌庫/回合/Log
│  │  ├─ TurnChoice.vue            # 兩鍵：Auction / Cow Trade（主要玩家）
│  │  ├─ Auction/
│  │  │  ├─ AuctionBidderView.vue # 投標者：MoneyPad、確認出價/放棄
│  │  │  ├─ AuctionHostView.vue   # 主持人：得標 / 買回（可禁用）
│  │  │  ├─ MoneyPad.vue          # 錢卡按鈕群（多選、取消、合計）
│  │  │  └─ BidList.vue           # 只顯示目前最高價（可選歷史）
│  │  └─ CowTrade/
│  │     ├─ CowTargetPicker.vue   # 挑對手（僅列出有動物者）
│  │     ├─ CowAnimalPicker.vue   # 挑對手擁有的動物種類（未被鎖）
│  │     └─ CowConfirmBar.vue     # 秘密出錢提交（只傳 Host）
│  ├─ store/
│  │  ├─ game.ts                   # 回合、驢子發錢、計分、終局、快照 apply
│  │  ├─ auction.ts                # bidding/closing/settlement（Host 專用 reducers）
│  │  └─ cow.ts                    # select/commit/reveal/settlement（Host 專用 reducers）
│  ├─ services/
│  │  ├─ rules.ts                  # 常數：SET_SIZE/分數/驢子發錢/面額等
│  │  ├─ broadcast.ts              # IBroadcast 介面 + Ably Adapter
│  │  ├─ host-election.ts          # Host 選定/遷移（playerId 字典序最小）
│  │  └─ dedup-buffer.ts           # LRU 去重緩衝（N=500）
│  ├─ networking/
│  │  ├─ ablyClient.ts             # Ably 初始化、channel 工廠、presence
│  │  └─ protocol.ts               # Envelope/Msg 常數/型別對映/輔助函數
│  ├─ composables/
│  │  ├─ useRealtimeGame.ts        # **Phase2 核心**：connect/dispatch/isHost/訂閱/快照
│  │  ├─ usePhaseGuard.ts          # 依 phase 控制可用操作（含權限矩陣）
│  │  ├─ useAuctionViewRole.ts     # 是否主持人
│  │  ├─ useMoneySelection.ts      # MoneyPad 本地暫存（送出前不動真資產）
│  │  └─ useLog.ts                 # 記錄/格式化事件 Log
│  ├─ utils/
│  │  ├─ id.ts                     # uuid/nanoid newId()
│  │  └─ math.ts                   # 合計/比較輔助
│  └─ data/
│     └─ deck.json                 # （可選）定義每動物 4 張的來源資料
├─ tsconfig.json
├─ tsconfig.node.json
├─ package.json
├─ vite.config.ts                  # 或 + vitest.config.ts
├─ .eslintrc.cjs
├─ .prettierrc
├─ .env.example
└─ .gitignore
```

---

## 2) 資料型態（Types）— `src/types/game.ts`

> 僅能使用此處列出的型別；**不得擴充**。如需調整，先改本 README。

```ts
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
  | 'auction.bidding' | 'auction.closing' | 'auction.settlement'
  | 'cow.selectTarget' | 'cow.selectAnimal' | 'cow.commit' | 'cow.reveal' | 'cow.settlement'
  | 'turn.end' | 'game.end';

export interface Bid {
  playerId: string;
  moneyCardIds: string[];
  total: number;
  ts: number;               // Host 接收時間（先到先贏）
  actionId: string;         // 去重
}

export interface AuctionState {
  auctioneerId?: string;
  card?: Card;
  highest?: Bid;            // 僅保留當前最高（同額比 ts）
  passes: string[];         // JSON 可序列化
  closed: boolean;
}

export interface CowTradeState {
  initiatorId?: string;
  targetPlayerId?: string;
  targetAnimal?: Animal;
  initiatorSecret?: string[]; // 僅 Host 記憶體（不持久化）
  targetSecret?: string[];
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

export interface Rules {
  SET_SIZE: 4;
  MONEY_DENOMS: MoneyDenom[];
  START_MONEY: Record<MoneyDenom, number>; // {0:2, 10:4, 50:1}
  DONKEY_PAYOUTS: [50, 100, 200, 500];
  ANIMAL_SCORES: Record<Animal, number>;
}
```

---

## 3) 狀態管理（Pinia Stores）

> **Stores 僅定義純 reducers 與查詢**。Phase 2 起，只有 **Host** 會呼叫 reducers；非 Host 只會 `dispatch()` 網路 action，由 Host 套用後廣播快照。

### `store/game.ts`

* **State**：`phase, players, deck, discard, turnOwnerId, donkeyDrawCount, log, stateVersion`
* **Getters**

  * `activePlayer()`
  * `playerById(id)`
  * `remainingAuctionableAnimals()`
  * `canChooseAuction()`
  * `canChooseCowTrade()`
  * `isAnimalLocked(animal)`
* **Actions (純 reducers)**

  * `setupGame(players: Array<{ id: string; name: string }>)`
    若 `src/data/deck.json` 不存在：Host 以 `Animal` 全列表與 `Rules.SET_SIZE` 生成「每種動物各 4 張」，使用 Fisher–Yates 洗牌；**洗後牌序以 Host 快照為準**。
  * `startTurn()` → `phase='turn.choice'`
  * `drawCardForAuction(): Card`
  * `grantDonkeyPayout()`
  * `rotateTurn()`
  * `computeFinalScores(): Array<{ playerId: string; score: number }>`
  * `checkEndAndMaybeFinish()`
  * `appendLog(msg: string)`
  * **快照 API（Phase 2 新增）**

    * `applySnapshot(s: GameState): void`（覆蓋整體狀態）
    * `serializeForPersist(): GameState`
    * `bumpVersion(): void`（Host 每次更動後 +1）

> **計分定義（去歧義）**：
> `自有動物分值總和 = Σ(玩家擁有數量 ≥ 1 的每種動物分值；每種動物只計一次)`
> `完成組數 = 玩家達成 4 張的動物種類數`
> **玩家總分 = 自有動物分值總和 × 完成組數**

### `store/auction.ts`

* **State**：`auction: AuctionState | null`
* **Getter**：`canAuctioneerBuyback()`
* **Actions (Host reducers)**：

  * `enterBidding()`
  * `placeBid(playerId: string, moneyCardIds: string[], actionId: string)`
  * `passBid(playerId: string)`
  * `hostAward()`
  * `hostBuyback()`（Phase 3 完成）
  * `settle(mode: 'award' | 'buyback')`

### `store/cow.ts`

* **State**：`cow: CowTradeState | null`
* **Actions (Host reducers)**：

  * `selectTarget(targetPlayerId: string)`
  * `selectAnimal(animal: Animal)`
  * `commitSecret(playerId: string, moneyCardIds: string[])`（僅 Host 記憶體）
  * `revealAndResolve()`

---

## 4) 實時層（Phase 2：Ably／Host Authority／快照／去重）

### 檔案清單（Phase 2 新增與變更）

* **新增**

  * `networking/ablyClient.ts`
  * `services/broadcast.ts`（內含 `IBroadcast` 介面 + Ably Adapter）
  * `services/host-election.ts`
  * `services/dedup-buffer.ts`（固定 N=500）
  * `composables/useRealtimeGame.ts`
  * `networking/protocol.ts`（補完 Msg/Envelope/型別對映/輔助）
* **修改**

  * `main.ts`：初始化連線（或交由 `useRealtimeGame` 內建），注入 room & me
  * `App.vue`：由各元件 emits → `dispatch()`（不再直呼 store）
  * `store/game.ts`：加入快照 API 與 `stateVersion`
  * `store/auction.ts` / `store/cow.ts`：確認為純 reducers（只 Host 呼叫）

### `services/broadcast.ts`（IBroadcast 與成員型別）

```ts
export interface PresenceMeta { playerId: string; name: string; }
export interface PresenceMember { id: string; data: PresenceMeta; }

export interface IBroadcast {
  publish<TPayload>(topic: string, payload: TPayload): Promise<void>;
  subscribe<TPayload>(topic: string, handler: (payload: TPayload) => void): () => void;
  presence(): {
    enter(meta: PresenceMeta): Promise<void>;
    leave(): Promise<void>;
    getMembers(): Promise<PresenceMember[]>;
  };
}
```

> **規範**：presence 的 `id`（或底層 clientId）必須等於 `playerId`。若底層不可控，`data.playerId` 必須存在且等同 `playerId`；Host 選舉以**字典序最小的 playerId** 決定。

### `networking/ablyClient.ts`（Ably 包裝型別）

```ts
export interface AblyEnv { apiKey: string; appName: string; }
export interface AblyChannelLike {
  publish: (name: string, data: unknown) => Promise<void>;
  subscribe: (name: string, cb: (msg: { name: string; data: unknown }) => void) => () => void;
  presence: {
    enter: (meta: PresenceMeta) => Promise<void>;
    leave: () => Promise<void>;
    get: () => Promise<PresenceMember[]>;
  };
}
export interface AblyClient {
  getChannel: (roomId: string) => AblyChannelLike;
  close: () => Promise<void>;
}
export function createAblyClient(env: AblyEnv, clientId: string): AblyClient;
```

> 具體實作以 Ably Realtime 為基礎；此處對外只暴露 `AblyClient` 與 `AblyChannelLike` 抽象型別，避免耦合。

### `services/host-election.ts`

```ts
export function getHostId(members: Array<{ id: string }>): string;         // 字典序最小
export function shouldReelect(oldHostId: string, memberIds: string[]): boolean;
```

### `services/dedup-buffer.ts`（固定容量 LRU）

```ts
export interface DedupBuffer {
  add(id: string): boolean; // true = 新 actionId；false = 重覆（應丟棄）
  size(): number;
  clear(): void;
}
export function createDedupBuffer(capacity: number /* 建議 500 */): DedupBuffer;
```

### `composables/useRealtimeGame.ts`（核心資料流）

```ts
import type { Ref } from 'vue';
import type { MsgType, Envelope, PayloadByType } from '@/networking/protocol';
import type { IBroadcast } from '@/services/broadcast';

export interface RealtimeIdentity { playerId: string; name: string; }
export interface UseRealtimeGame {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  dispatch: <T extends MsgType>(type: T, payload: PayloadByType[T]) => Promise<void>;
  isHost: Ref<boolean>;
}

export function useRealtimeGame(
  roomId: string,
  me: RealtimeIdentity,
  busFactory: (roomId: string) => IBroadcast
): UseRealtimeGame;
```

**行為規範**

1. `connect()`

   * 進入 `game-{roomId}` 頻道；`presence.enter({ playerId, name })`。
   * 取得成員 → `getHostId()` → 設置 `isHost`。
   * 訂閱：`action.*`、`state.update`、`system.hostChanged`、（可選）`system.requestState`。
   * 非 Host 可送 `system.requestState` 向 Host 要快照。

2. `dispatch(type, payload)`

   * **Host**：直接執行對應 reducers（見「事件對應表」）→ `bumpVersion()` → 廣播 `state.update`（完整快照）。
   * **非 Host**：封包 `Envelope` 後 `publish(actionType, envelope)`。
   * 兩者皆需附 `actionId`（以 `newId()` 生成）做去重。

3. **Host 去重**

   * 維持 `DedupBuffer`（N=500）。收到 `action.*` 時，若 `add(actionId)` 回 `false`，直接丟棄。

4. **state.update 快照**

   * 收到時比對 `stateVersion`；若較舊則丟棄，否則 `applySnapshot()`。
   * Host 亦寫入 `localStorage['game:{roomId}']`。

5. **Host 遷移**

   * Presence 變更導致舊 Host 不在 → 以**字典序最小**接任 → 立即廣播最新 `state.update`。

---

## 5) 儲存（Persistence）

* **Host 端**：`localStorage['game:{roomId}'] = GameState`（含 `stateVersion`）。
  Cow Trade 的 `secret` **不可持久化**（僅記憶體）。
* **Client 端**：`localStorage['session:{roomId}:{playerId}'] = { stateVersion, playerId, name }`
* **重連恢復**：Client 加入後等待 Host 廣播 `state.update`；必要時送 `system.requestState`。
* **Schema 管理**：`networking/protocol.ts` 維護 `SCHEMA_VERSION`。必要時 Host 遷移或清除舊存檔。
* **Action 去重緩衝**：Host 維持最近 **N=500** `actionId`（記憶體）。如需抗 Host reload，可（選）同步到 `localStorage['dedup:{roomId}']`。

---

## 6) 元件 / Composables / Services 介面（Interfaces）

### 元件（與 Phase 1 相同，外層接線改呼叫 `dispatch()`）

* `TurnChoice.vue`

  * props：`canAuction: boolean`, `canCowTrade: boolean`, `isFirstRound: boolean`
  * emits：`choose-auction` | `choose-cow-trade`
* `AuctionBidderView.vue`

  * props：`self: Player`, `highest?: Bid`
  * emits：`place-bid(moneyCardIds: string[])`, `pass()`
* `AuctionHostView.vue`

  * props：`highest?: Bid`, `canBuyback: boolean`
  * emits：`award()`, `buyback()`
* `MoneyPad.vue`

  * props：`moneyCards: MoneyCard[]`, `selectedIds: string[]`
  * emits：`toggle(id)`, `clear()`, `confirm(moneyCardIds)`
* `BidList.vue`

  * props：`highest?: Bid`, `showHistory?: boolean`
  * emits：無
* `Hud.vue`

  * props：`players: Player[]`, `turnOwnerId: string`, `deckCount: number`, `phase: Phase`, `log: string[]`
  * emits：無
* `CowTargetPicker.vue`

  * props：`candidates: Player[]`
  * emits：`select-target(playerId: string)`
* `CowAnimalPicker.vue`

  * props：`target: Player`, `locked: Record<Animal, boolean>`
  * emits：`select-animal(animal: Animal)`
* `CowConfirmBar.vue`

  * emits：`commit-secret(moneyCardIds: string[])`

### Composables（補充）

* `usePhaseGuard.ts` → `isActionAllowed(action: string): boolean`（見權限矩陣）
* `useAuctionViewRole.ts` → `isHost(myId: string): boolean`
* `useRealtimeGame.ts` → 見上一節（**Phase 2 核心**）

### Services 常數

* `services/rules.ts`：見第 9 節

---

## 7) 通訊協定（Message Types & Envelope）

### Channel

* `game-{roomId}`（單一頻道，≤5 人）

### 訊息常數

```ts
export const Msg = {
  Action: {
    PlaceBid: 'action.placeBid',
    PassBid: 'action.passBid',
    ChooseAuction: 'action.chooseAuction',
    ChooseCowTrade: 'action.chooseCowTrade',
    SelectCowTarget: 'action.selectCowTarget',
    SelectCowAnimal: 'action.selectCowAnimal',
    CommitCowTrade: 'action.commitCowTrade',
    HostAward: 'action.hostAward',
    HostBuyback: 'action.hostBuyback'
  },
  State: { Update: 'state.update' },
  System: {
    Join: 'system.join',
    Leave: 'system.leave',
    HostChanged: 'system.hostChanged',
    RequestState: 'system.requestState'
  }
} as const;

export type MsgType =
  | typeof Msg.Action[keyof typeof Msg.Action]
  | typeof Msg.State[keyof typeof Msg.State]
  | typeof Msg.System[keyof typeof Msg.System];
```

### Payload 型別映射（**避免 `any`**）

```ts
import type { Animal, GameState } from '@/types/game';

export interface ActionPlaceBid       { playerId: string; moneyCardIds: string[]; }
export interface ActionPassBid        { playerId: string; }
export interface ActionChooseAuction  { playerId: string; }
export interface ActionChooseCowTrade { playerId: string; }
export interface ActionSelectCowTarget{ playerId: string; targetId: string; }
export interface ActionSelectCowAnimal{ playerId: string; animal: Animal; }
export interface ActionCommitCowTrade { playerId: string; moneyCardIds: string[]; }
export interface ActionHostAward      { playerId: string; }
export interface ActionHostBuyback    { playerId: string; }

export interface StateUpdate          { state: GameState; }

export interface SystemJoin           { playerId: string; name: string; }
export interface SystemLeave          { playerId: string; }
export interface SystemHostChanged    { newHostId: string; }
export interface SystemRequestState   { requesterId: string; }

// 各訊息對應 payload 型別
export type ActionPayloads = {
  [typeof Msg.Action.PlaceBid]:       ActionPlaceBid;
  [typeof Msg.Action.PassBid]:        ActionPassBid;
  [typeof Msg.Action.ChooseAuction]:  ActionChooseAuction;
  [typeof Msg.Action.ChooseCowTrade]: ActionChooseCowTrade;
  [typeof Msg.Action.SelectCowTarget]:ActionSelectCowTarget;
  [typeof Msg.Action.SelectCowAnimal]:ActionSelectCowAnimal;
  [typeof Msg.Action.CommitCowTrade]: ActionCommitCowTrade;
  [typeof Msg.Action.HostAward]:      ActionHostAward;
  [typeof Msg.Action.HostBuyback]:    ActionHostBuyback;
};

export type StatePayloads = {
  [typeof Msg.State.Update]:          StateUpdate;
};

export type SystemPayloads = {
  [typeof Msg.System.Join]:           SystemJoin;
  [typeof Msg.System.Leave]:          SystemLeave;
  [typeof Msg.System.HostChanged]:    SystemHostChanged;
  [typeof Msg.System.RequestState]:   SystemRequestState;
};

export type PayloadByType = ActionPayloads & StatePayloads & SystemPayloads;
```

### Envelope 與輔助（**無 `any`**）

```ts
export const SCHEMA_VERSION = 1;

export interface Envelope<T extends MsgType> {
  type: T;
  roomId: string;
  senderId: string;         // playerId
  actionId?: string;        // 僅 action.*
  stateVersion?: number;    // 僅 state.update
  ts: number;               // Host 接收/廣播時間（毫秒）
  payload: PayloadByType[T];
  schemaVersion: number;    // 例如 1
}

export function envelope<T extends MsgType>(
  type: T,
  roomId: string,
  senderId: string,
  payload: PayloadByType[T],
  options?: { actionId?: string; stateVersion?: number }
): Envelope<T> {
  return {
    type,
    roomId,
    senderId,
    actionId: options?.actionId,
    stateVersion: options?.stateVersion,
    ts: Date.now(),
    payload,
    schemaVersion: SCHEMA_VERSION
  };
}
```

### 事件對應表（Host 路徑）

| Action type                     | Host reducers（順序）                                              |
| ------------------------------- | -------------------------------------------------------------- |
| `action.chooseAuction`          | `game.drawCardForAuction()` → `auction.enterBidding()`         |
| `action.placeBid`               | `auction.placeBid(playerId, moneyCardIds, actionId)`           |
| `action.passBid`                | `auction.passBid(playerId)`                                    |
| `action.hostAward`              | `auction.settle('award')`（或 `hostAward()` → `settle('award')`） |
| `action.chooseCowTrade`         | （Phase 4）`cow.selectTarget` 等流程開始                              |
| `action.selectCowTarget/Animal` | （Phase 4）`cow.selectTarget()`／`cow.selectAnimal()`             |
| `action.commitCowTrade`         | （Phase 4）`cow.commitSecret()`                                  |
| `system.requestState`           | 直接回送 `state.update`（最新快照）                                      |

---

## 8) 邏輯邊界與 UX 規則（Business Rules）

**全局**

* 第一回合：無人有動物 → 只能拍賣（Cow Trade 禁用）
* 棄牌堆不重洗；無回合上限
* 沒錢玩家：禁用出價、禁用發起 Cow Trade（仍可被挑戰）

**拍賣**

* 主持人必須參與結標
* 無人出價 → 主持人直接拿牌
* 出價可多次加碼；只保留當前**最高價**並廣播
* 平手：先出價者優先（以 Host `ts`）
* 買回：主持人需能湊等額錢卡，不足則禁用
* 結算：在 `auction.settlement` 一次性轉移錢卡/動物卡並寫 log

**驢子事件**

* 共 4 張；每抽一張，全員獲得：第1隻 +50、第2隻 +100、第3隻 +200、第4隻 +500
* 該驢子仍照常拍賣

**Cow Trade（Phase 4 完成）**

* 每回合僅能發起一次；完成即結束回合
* 只能挑「有動物」的玩家
* 只能選對手持有且未被鎖的動物（任一玩家集滿 4 張即鎖）
* 雙方秘密出錢（僅 Host 知）；平手不交換動物與錢卡
* 結算：雙方該動物各 ≥2 → 勝者拿 2 張；否則 1 張；雙方互換提交錢卡

**終局與計分**

* 終局：**所有動物種類**至少有一位玩家集滿 4 張
* 分數表：雞10、鵝40、貓90、狗160、羊250、蛇350、驢500、豬650、牛800、馬1000
* 計分公式：見 `store/game.ts` 小節（去歧義定義）

### 權限矩陣（供 `usePhaseGuard` 與測試對照）

| Phase                | 允許的 Action                                    | 限制條件                                         |
| -------------------- | --------------------------------------------- | -------------------------------------------- |
| `turn.choice`        | `CHOOSE_AUCTION`、`CHOOSE_COW_TRADE`           | `canChooseAuction()` / `canChooseCowTrade()` |
| `auction.bidding`    | `PLACE_BID`（可多次）、`PASS_BID`                   | 沒錢禁用；主持人可出價但不可 `PASS_BID`                    |
| `auction.closing`    | `HOST_AWARD`、`HOST_BUYBACK`                   | `canAuctioneerBuyback()` 為 true              |
| `auction.settlement` | （系統內部結算）                                      | —                                            |
| `cow.selectTarget`   | `SELECT_TARGET`                               | 目標玩家必須「有動物」                                  |
| `cow.selectAnimal`   | `SELECT_ANIMAL`                               | 該動物未被鎖                                       |
| `cow.commit`         | `COMMIT_COW_TRADE`（雙方各一次、不可撤）                 | 僅發起者與目標可提交                                   |
| `cow.reveal`         | `REVEAL_AND_RESOLVE`（Host 觸發）                 | 雙方皆已提交                                       |
| `cow.settlement`     | （系統內部結算）                                      | —                                            |
| `turn.end`           | 系統：`isEndGame` → `game.end`；否則回 `turn.choice` | —                                            |
| `game.end`           | （結束）                                          | —                                            |

---

## 9) 設定檔與套件

### `package.json`

```json
{
  "name": "my-vue-game",
  "version": "0.1.0",
  "private": true,
  "description": "Multiplayer Auction + Cow Trade (Vue 3 + Pinia + Ably)",
  "type": "module",
  "engines": { "node": ">=18.17.0" },
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview --strictPort --port 5173",
    "type-check": "vue-tsc --noEmit",
    "test": "vitest run",
    "test:ui": "vitest --ui",
    "lint": "eslint --ext .ts,.vue src",
    "format": "prettier --write ."
  },
  "dependencies": {
    "ably": "^1.2.38",
    "mitt": "^3.0.1",
    "nanoid": "^5.0.7",
    "pinia": "^2.1.7",
    "vue": "^3.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@vitejs/plugin-vue": "^5.0.0",
    "@typescript-eslint/eslint-plugin": "^7.8.0",
    "@typescript-eslint/parser": "^7.8.0",
    "eslint": "^8.57.0",
    "eslint-plugin-vue": "^9.26.0",
    "happy-dom": "^14.10.0",
    "prettier": "^3.3.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0",
    "vue-tsc": "^2.0.21"
  }
}
```

### `tsconfig.json`

```json
{
  "extends": "./tsconfig.node.json",
  "compilerOptions": {
    "composite": true,
    "tsBuildInfoFile": "./node_modules/.cache/tsbuildinfo",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "jsx": "preserve",
    "types": ["vite/client", "vitest", "node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "useDefineForClassFields": true,
    "noImplicitAny": true
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "env.d.ts"]
}
```

### `tsconfig.node.json`

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "allowJs": false,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

### Vite（單檔或分檔皆可；此示例為單檔）

```ts
// vite.config.ts
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: { reporter: ['text', 'html'] }
  }
});
```

### ESLint / Prettier（**禁止 `any`**）

```js
// .eslintrc.cjs
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.vue']
  },
  extends: ['plugin:vue/vue3-recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error' // <—— 明確禁止 any
  },
  ignorePatterns: ['dist', 'node_modules']
};
```

```json
// .prettierrc
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "es5" }
```

### `.env.example`

```
VITE_ABLY_API_KEY=YOUR-ABLY-API-KEY
VITE_APP_NAME=MyVueGame
```

### `.gitignore`

```
/node_modules/
/dist/
.vscode/
.idea/
/node_modules/.cache/
.DS_Store
*.local
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*
```

### `src/data/deck.json`（可選）

```json
{
  "animals": ["chicken","goose","cat","dog","sheep","snake","donkey","pig","cow","horse"],
  "setSize": 4
}
```

### `services/rules.ts`（常數單一來源）

* `SET_SIZE = 4`
* `MONEY_DENOMS = [0,10,50,100,200,500]`
* `START_MONEY = {0:2, 10:4, 50:1}`
* `DONKEY_PAYOUTS = [50,100,200,500]`
* `ANIMAL_SCORES = { chicken:10, goose:40, cat:90, dog:160, sheep:250, snake:350, donkey:500, pig:650, cow:800, horse:1000 }`

---

## 10) 開發優先順序（Roadmap）

1. **Phase 0**：骨架、型別、rules、Hud/TurnChoice、Log
2. **Phase 1**：本地單機 MVP（game + auction: award 流、終局/計分）
3. **Phase 2**：Ably（Host Authority、presence、完整快照 `state.update`、`actionId` 去重、`stateVersion`）
4. **Phase 3**：Auction 買回 + guard；平手先到先贏（ts）
5. **Phase 4**：Cow Trade（select/commit/reveal/settlement；秘密只給 Host）
6. **Phase 5**：韌性/UX（斷線恢復、禁用邏輯、log 強化）
7. **Phase 6**：測試加強（stores + 協定）、Host 遷移保底、行動版 UI

---

## 11) 驗收與測試（Acceptance & Tests）

* **驢子連抽**：按第 1\~4 張正確發錢，仍進拍賣
* **拍賣無人出價**：主持人直接拿牌
* **出價平手**：先到先贏（不覆蓋既有最高）
* **買回資金不足**：按鈕禁用
* **第一回合**：Cow Trade 禁用
* **Cow Trade**：對手需有動物；被鎖動物不可選；平手不交換；1/2 規則正確
* **終局與計分**：與公式一致
* **Ably/實時**：`action.*` → Host 驗證 → `state.update` 完整快照；重連可拿到最新快照
* **Host 遷移**：舊 Host 離線 → 字典序最小者接任並廣播
* **序列化**：`AuctionState.passes` 為 `string[]`（快照／持久化一致）
* **去重緩衝**：相同 `actionId` 重送不產生副作用
* **版本秩序**：舊 `stateVersion` 被丟棄

> 測試建議：協定／網路整合測試使用記憶體版 `IBroadcast`（在測試夾具提供），不依賴真 Ably；元件測試可選。

---

## 12) 狀態機圖（Mermaid）

```mermaid
stateDiagram-v2
  [*] --> setup
  setup --> turn_choice: START_GAME

  state turn_choice as "turn.choice"
  turn_choice --> auction_bidding: CHOOSE_AUCTION / canChooseAuction
  turn_choice --> cow_selectTarget: CHOOSE_COW_TRADE / canChooseCowTrade

  state auction_bidding as "auction.bidding"
  auction_bidding --> auction_closing: ALL_OTHERS_PASS
  auction_bidding --> auction_bidding: PLACE_BID (highest replaces)
  auction_closing --> auction_settlement: HOST_AWARD | HOST_BUYBACK(canBuyback)
  auction_settlement --> turn_end

  state cow_selectTarget as "cow.selectTarget"
  cow_selectTarget --> cow_selectAnimal: SELECT_TARGET (target has animals)
  state cow_selectAnimal as "cow.selectAnimal"
  cow_selectAnimal --> cow_commit: SELECT_ANIMAL (!locked)
  state cow_commit as "cow.commit"
  cow_commit --> cow_reveal: BOTH_COMMITTED
  state cow_reveal as "cow.reveal"
  cow_reveal --> turn_end: TIE (no exchange)
  cow_reveal --> cow_settlement: WINNER (1 or 2 cards)
  cow_settlement --> turn_end

  state turn_end as "turn.end"
  turn_end --> game_end: isEndGame
  turn_end --> turn_choice: else

  state game_end as "game.end"
  game_end --> [*]
```

---

## 13) 疑難排解：Vitest 設定與常見錯誤

* **Vitest 設定放錯**

  * 單檔方案：`vite.config.ts` 以 `vitest/config` 的 `defineConfig` 匯入 `test` 欄位。
  * 分檔方案：`vite.config.ts` 不含 `test`；改放 `vitest.config.ts`。
* **拍賣 `passes` 使用 Set** → JSON 失敗

  * 型別已定為 `string[]`；嚴禁使用 Set 存快照。
* **`ts`/平手順序混亂**

  * Host 收到 action 時以 `Date.now()` 記錄；測試用 `vi.useFakeTimers()` 控時。
* **Cow Secret 被持久化**

  * 違規：`CowTradeState.*Secret` 僅 Host 記憶體；序列化時需排除。
* **發現 `any`**

  * 已由 `tsconfig.json` 的 `noImplicitAny: true` 與 ESLint 的 `@typescript-eslint/no-explicit-any: error` 強制禁止；出現即修。

---

### 使用說明（如何接線到實時）

1. `main.ts` 產生 `roomId`、`me{playerId,name}`，交由 `useRealtimeGame(roomId, me, busFactory)`。
2. `App.vue` 在 `onMounted` 呼叫 `connect()`；在各元件 emits handler 改呼 `dispatch(Msg.Action.Xxx, payload)`。
3. Host-only reducers 僅由 `useRealtimeGame` 在 Host 端路徑呼叫，並在每次修改後 `bumpVersion()` → 廣播 `state.update`。

---

這份 README 現在已完整包含 **Phase 0\~2** 所需的一切契約、介面與流程，且全檔**零 `any`**。告訴我檔名就能直接輸出對應的**完整可跑程式碼**。
