# 🐮🐷🐴 Multiplayer Auction Game — Developer README

> 這份 README **是唯一的合約**。
> 任何檔案的負責人只要依本文件的**型別、介面與規則**實作，就不會與其他檔案衝突。
> 之後你只需把這份 README 傳給我，並指定要我完成哪個檔案，我就能獨立完成其完整程式碼。

---

## 目錄

1. 專案架構 (Project Structure)
2. 資料型態 (Types)
3. 狀態管理 (Pinia Stores)
4. 儲存 (Persistence)
5. 代碼間通信介面 (Component & Service Interfaces)
6. 通訊協定 (Networking Protocol via Ably)
7. 邏輯邊界 (Business Rules & UX Rules)
8. 開發優先順序 (Roadmap)
9. 驗收與測試 (Acceptance & Tests)
10. 狀態機圖 (Mermaid)

---

# 1) 專案架構 (Project Structure)

```text
my-vue-game/
├─ index.html                     # root #app + 載入 main.ts
├─ src/
│  ├─ main.ts                     # 建立 App、註冊 Pinia、樣式
│  ├─ App.vue                     # 根組件：依 phase 切畫面
│  ├─ assets/
│  │  └─ main.css
│  ├─ components/
│  │  ├─ Hud.vue
│  │  ├─ TurnChoice.vue
│  │  ├─ Auction/
│  │  │  ├─ AuctionBidderView.vue
│  │  │  ├─ AuctionHostView.vue
│  │  │  ├─ MoneyPad.vue
│  │  │  └─ BidList.vue
│  │  └─ CowTrade/
│  │     ├─ CowTargetPicker.vue
│  │     ├─ CowAnimalPicker.vue
│  │     └─ CowConfirmBar.vue
│  ├─ store/
│  │  ├─ game.ts                  # 回合、驢子發錢、計分、終局
│  │  ├─ auction.ts               # 拍賣 bidding/closing/settlement
│  │  └─ cow.ts                   # Cow Trade select/commit/reveal/settlement
│  ├─ services/
│  │  ├─ rules.ts                 # 常數、得分、驢子發錢表
│  │  ├─ broadcast.ts             # Ably 抽象 (IBroadcast)
│  │  └─ host-election.ts         # Host 選定與遷移
│  ├─ networking/
│  │  ├─ ablyClient.ts            # Ably 初始化 / presence
│  │  └─ protocol.ts              # 訊息封包與 schema 版本
│  ├─ types/
│  │  └─ game.ts                  # 全域 Type 定義（本 README 規格）
│  ├─ composables/
│  │  ├─ usePhaseGuard.ts
│  │  ├─ useAuctionViewRole.ts
│  │  ├─ useMoneySelection.ts
│  │  └─ useLog.ts
│  └─ utils/
│     ├─ id.ts
│     └─ math.ts
├─ tsconfig.json
├─ package.json
└─ vite.config.ts
```

**技術棧**：Vue 3、Vite、TypeScript、Pinia、Ably Realtime（≤5 人）

---

# 2) 資料型態 (Types)

> **所有檔案**請只依賴下列型別（位於 `src/types/game.ts`），嚴禁自行擴充不在本表之內容。必要變更請回到此 README 更新。

```ts
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
```

---

# 3) 狀態管理 (Pinia Stores)

> 所有 store **只暴露下列簽名**。實作者不得擴充新公開方法；若必要，請在此 README 更新。

## `store/game.ts`（全域）

**State**
`phase, players, deck, discard, turnOwnerId, donkeyDrawCount, log, stateVersion`

**Getters**

* `activePlayer(): Player`
* `playerById(id: string): Player | undefined`
* `remainingAuctionableAnimals(): number`  // 牌庫中可拍賣動物（含驢子）
* `canChooseAuction(): boolean`            // 第一回合/牌庫判斷
* `canChooseCowTrade(): boolean`           // 當前玩家是否有錢
* `isAnimalLocked(animal: Animal): boolean`// 任一玩家達到 4 張

**Actions**

* `setupGame(players: Array<{id: string; name: string}>): void`
* `startTurn(): void`                                      // phase='turn.choice'
* `drawCardForAuction(): Card`                             // 改動 deck，回傳 card
* `grantDonkeyPayout(): void`                              // 依 donkeyDrawCount 發錢並 +1
* `rotateTurn(): void`                                     // 切換 turnOwnerId
* `computeFinalScores(): Array<{playerId: string; score: number}>`
* `checkEndAndMaybeFinish(): void`                         // 若終局 → phase='game.end'
* `appendLog(msg: string): void`

## `store/auction.ts`

**State**
`auction: AuctionState | null`

**Getters**

* `canAuctioneerBuyback(): boolean`    // 主持人是否能湊出等額錢卡

**Actions**

* `enterBidding(): void`               // 設定主持人、抽卡；驢子則先發錢後繼續
* `placeBid(playerId: string, moneyCardIds: string[], actionId: string): void`
* `passBid(playerId: string): void`    // passes 滿（非主持人人數）→ phase='auction.closing'
* `hostAward(): void`                  // → phase='auction.settlement'
* `hostBuyback(): void`                // guard 成功才可呼叫 → 'auction.settlement'
* `settle(mode: 'award'|'buyback'): void` // 移轉錢卡/動物卡，→ 'turn.end'

## `store/cow.ts`

**State**
`cow: CowTradeState | null`

**Actions**

* `selectTarget(targetPlayerId: string): void`      // → 'cow\.selectAnimal'
* `selectAnimal(animal: Animal): void`              // 檢查可選 → 'cow\.commit'
* `commitSecret(playerId: string, moneyCardIds: string[]): void` // 提交給 Host（本地僅標記）
* `revealAndResolve(): void`                        // 平手：不交換；否則勝者拿 1/2 張；雙方互換提交錢卡 → 'turn.end'

> **副作用原則**：資源真正移轉**只在** `auction.settlement` 與 `cow.revealAndResolve()` 內發生。出價/commit 只記快照。

---

# 4) 儲存 (Persistence)

* **Host 端**

  * `localStorage` key：`game:{roomId}` → `GameState` 完整快照（含 `stateVersion`）。
  * **不得**持久化 Cow Trade 的 secret（僅記憶體保存）。

* **Client 端（非 Host）**

  * `localStorage` key：`session:{roomId}:{playerId}` → 最近一次 `stateVersion` + `playerId`。

* **恢復流程**

  * Client 重新連線 → 等待 Host 廣播 `state.update`；或送 `system.requestState`（可選）。
  * Host 收到新成員/落後版本 → 主動推送 `state.update`。

* **版本**

  * `networking/protocol.ts` 需維護 `schemaVersion`。若 schema 變動，需處理舊快照相容或清除。

---

# 5) 代碼間通信介面 (Interfaces)

## 元件 ↔ store

> 元件**只能**透過下列 props / emits 或直接讀取 store getters/state（讀），呼叫公開 actions（寫）。

### `App.vue`

* 職責：依 `game.phase` 切畫面；不承擔業務邏輯。

### `Hud.vue`

* 讀：`players, turnOwnerId, donkeyDrawCount, deck.length, log`
* 不發事件（純顯示）。

### `TurnChoice.vue`

* props：`canAuction: boolean`, `canCowTrade: boolean`, `isFirstRound: boolean`
* emits：`choose-auction`, `choose-cow-trade`
* 行為：第一回合 `canCowTrade=false`。

### `Auction/AuctionBidderView.vue`

* props：`self: Player`, `highest?: Bid`
* emits：`place-bid`(moneyCardIds: string\[]), `pass`
* 使用 `useMoneySelection()` 管理本地選擇。

### `Auction/AuctionHostView.vue`

* props：`highest?: Bid`, `canBuyback: boolean`
* emits：`award`, `buyback`

### `Auction/MoneyPad.vue`

* props：`moneyCards: MoneyCard[]`, `selectedIds: string[]`
* emits：`toggle`(moneyCardId: string), `clear`, `confirm`(moneyCardIds: string\[])

### `Auction/BidList.vue`

* props：`highest?: Bid`
* 無 emits（純顯示）。

### `CowTrade/CowTargetPicker.vue`

* props：`candidates: Player[]`  // 僅列出「有動物」的玩家
* emits：`select-target`(playerId: string)

### `CowTrade/CowAnimalPicker.vue`

* props：`target: Player`, `locked: Record<Animal, boolean>` // true=不可選
* emits：`select-animal`(animal: Animal)

### `CowTrade/CowConfirmBar.vue`

* emits：`commit-secret`(moneyCardIds: string\[])

## Composables

### `usePhaseGuard.ts`

* `isActionAllowed(action: string): boolean` // 用於控制按鈕禁用

### `useAuctionViewRole.ts`

* `isHost(selfId: string): boolean`         // 是否為主持人

### `useMoneySelection.ts`

* `selectedIds: string[]`
* `toggle(id: string): void`
* `clear(): void`
* `total(): number`

### `useLog.ts`

* `push(msg: string): void`                 // 包裝 `game.appendLog`

## Services

### `services/rules.ts`（僅輸出常數）

* `SET_SIZE = 4`
* `MONEY_DENOMS: MoneyDenom[] = [0,10,50,100,200,500]`
* `START_MONEY: Record<MoneyDenom, number> = {0:2, 10:4, 50:1}`
* `DONKEY_PAYOUTS: [50,100,200,500]`
* `ANIMAL_SCORES: Record<Animal, number> = { chicken:10, goose:40, cat:90, dog:160, sheep:250, snake:350, donkey:500, pig:650, cow:800, horse:1000 }`

### `services/broadcast.ts`

```ts
export interface IBroadcast {
  publish<T>(topic: string, payload: T): Promise<void>;
  subscribe<T>(topic: string, handler: (payload: T) => void): () => void;
  presence(): {
    enter(meta: { playerId: string; name: string }): Promise<void>;
    leave(): Promise<void>;
    getMembers(): Promise<Array<{ id: string; data: any }>>;
  };
}
```

### `services/host-election.ts`

* `getHostId(members: Array<{id: string}>): string` // 取最小 playerId
* `shouldReelect(oldHostId: string, members: string[]): boolean`

---

# 6) 通訊協定 (Networking Protocol via Ably)

**通則**

* **Host Authority**：playerId **最小者**為 Host；Host 離線 → 依序轉移。
* **每次事件**由 Host 驗證並**廣播完整快照** `state.update`（攜帶 `stateVersion`）。
* **同時出價**：以 Host 接收時間 `ts` 排序；同額先到先贏。
* **去重**：所有 `action.*` 必帶 `actionId`（uuid）。

## Channel 命名

* `game-{roomId}`（單一頻道、最多 5 人）

## Envelope（外層封包）

```ts
export interface Envelope<T = any> {
  type: string;             // 'action.placeBid' | 'state.update' | 'system.join' | ...
  roomId: string;
  senderId: string;         // playerId
  actionId?: string;        // 僅 action.*
  stateVersion?: number;    // 僅 state.update
  ts: number;               // Host 接收或廣播時間
  payload: T;
  schemaVersion: number;    // networking/protocol.ts 維護
}
```

## Actions（Client → Host）

```ts
type ActionPlaceBid       = { playerId: string; moneyCardIds: string[] };
type ActionPassBid        = { playerId: string };
type ActionChooseAuction  = { playerId: string };
type ActionChooseCowTrade = { playerId: string };
type ActionSelectCowTarget= { playerId: string; targetId: string };
type ActionSelectCowAnimal= { playerId: string; animal: Animal };
type ActionCommitCowTrade = { playerId: string; moneyCardIds: string[] }; // 僅 Host 可見
type ActionHostAward      = { playerId: string };    // 只有主持人可發
type ActionHostBuyback    = { playerId: string };    // 只有主持人可發
```

## State（Host → All）

```ts
type StateUpdate = { state: GameState }; // Host 每更新一次 stateVersion+1
```

## System / Presence

```ts
type SystemJoin        = { playerId: string; name: string };
type SystemLeave       = { playerId: string };
type SystemHostChanged = { newHostId: string };
type SystemRequestState= { requesterId: string }; // 可選
```

## Host 遷移流程

1. Presence 偵測舊 Host 離線。
2. 選剩餘成員中 **最小 playerId** 為新 Host。
3. 廣播 `system.hostChanged`。
4. 新 Host 立即廣播 `state.update` 快照。

## Cow Trade 秘密傳輸

* `action.commitCowTrade` 只送 **Host**（不在公共頻道明文廣播）。
* 收齊雙方提交後由 Host `cow.reveal` → 廣播 `state.update`。

---

# 7) 邏輯邊界 (Business Rules & UX Rules)

## 核心規則

* **第一回合**：無人有動物 → 只能拍賣，Cow Trade 禁用。
* **棄牌堆不重洗**；無回合上限。
* **沒錢玩家**：禁用出價、禁用發起 Cow Trade（仍可被挑戰）。

## 拍賣 (Auction)

* 主持人**必須**參與結標（不能放棄）。
* **無人出價** → 主持人直接拿牌。
* **出價**：允許多次加碼/覆蓋；僅保留**目前最高價**並廣播。
* **平手**：先出價者優先（以 Host 接收 `ts`）。
* **買回**：主持人可買回；需能湊出**等額錢卡**（不足則按鈕禁用）。
* **結算**：在 `auction.settlement` 一次性移轉錢卡/動物卡，寫 log。

## 驢子事件

* 共有 4 張；每抽一張，全員獲得：

  * 第1隻 +50、第2隻 +100、第3隻 +200、第4隻 +500
* 驢子牌**仍需拍賣**（同拍賣流程）。

## Cow Trade

* 一回合僅能**發起一次**；完成後立刻結束回合。
* **選對手**：限定「有動物」的玩家（不論是否有錢）。
* **選動物**：限定對手持有且**未被鎖**（有人已集滿 4 張即鎖）。
* **秘密出錢**：雙方提交錢卡（不可撤回），只傳 Host。
* **平手**：不交換動物，不交換錢卡，直接結束回合。
* **結算**：

  * 若雙方該動物各 ≥2 → 勝者拿 **2 張**；
  * 否則拿 **1 張**；
  * 雙方互換各自提交的錢卡。

## 終局與計分

* **終局**：所有動物種類至少有一名玩家湊齊 **4 張**（SET\_SIZE）。
* **分數**：

  * 動物分值：雞10、鵝40、貓90、狗160、羊250、蛇350、驢500、豬650、牛800、馬1000
  * 玩家總分 = （持有動物分值總和） × （完成的 4 張組數總和）
  * 不考慮額外加成。

## UX 規則

* 出價確認前可取消；**送出後不可撤回**。
* 進入 Auction / Cow Trade 後**不可返回** `turn.choice`。
* 不自動 pass（需手動）。
* MoneyPad：每張錢卡即一顆按鈕；點選加入/取消，底部顯示合計與確認。

---

# 8) 開發優先順序 (Roadmap)

1. **Phase 0 – 基礎骨架**
   型別、rules、Hud、TurnChoice、log。

2. **Phase 1 – 單機 MVP**
   game（回合/驢子/終局/計分）、auction（得標），測試出價/無人出價/驢子。

3. **Phase 2 – Ably 整合（Host Authority）**
   broadcast、ablyClient、presence、完整快照 `state.update`、actionId 去重、stateVersion。

4. **Phase 3 – 拍賣強化**
   buyback + guard、平手先到先贏（ts）。

5. **Phase 4 – Cow Trade**
   selectTarget/selectAnimal/commit/reveal/settlement（秘密只給 Host）。

6. **Phase 5 – 韌性與 UX**
   斷線恢復、禁用邏輯（第一回合/沒錢/動物鎖）、log 豐富化。

7. **Phase 6 – 測試與打磨**
   單元/整合測試（stores + protocol）、Host 遷移與快照保底、行動裝置 UI。

---

# 9) 驗收與測試 (Acceptance & Tests)

**關鍵案例**

* 驢子連抽：按第 1\~4 張正確發錢，且仍進拍賣。
* 拍賣無人出價：主持人直接拿牌。
* 出價平手：先到先贏，不覆蓋既有最高價。
* 買回資金不足：按鈕禁用。
* 第一回合：Cow Trade 禁用。
* Cow Trade：對手需有動物；動物若被鎖（已有人湊滿 4 張）不可選。
* Cow Trade 平手：不交換動物、不交換錢卡。
* Cow Trade 結算：雙方各≥2 → 2 張；否則 1 張；交換提交的錢卡。
* 終局判定與計分正確。
* Ably：action.\* → Host 驗證 → state.update（完整快照）；重新連線能同步最新狀態。
* Host 遷移：舊 Host 離線 → 依 playerId 最小者接任並廣播。

---

# 10) 狀態機圖 (Mermaid)

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

## 最後說明

* 本 README 為**唯一真相來源**（Single Source of Truth）。
* 任何檔案的實作者**只需遵循本文件**的型別、介面、事件與規則即可，不必讀取其他檔案內容。
* 之後若你要我**實作某個檔案**，請只把「檔名」與本 README 給我即可。
