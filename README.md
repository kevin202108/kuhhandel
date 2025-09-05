下面是**依照我們全部討論後修訂的《Master README（完整版）》**。
本版已落實：**單一身分來源（playerId≡clientId≡senderId）**、**Host 僅兩時機決定/變更**、**全量快照 + stateVersion**、**UI 流（NameEntry→Lobby→Host Start）**、**Phase 2 不使用本地持久化**、**協定型別不用 `any`（可用 `unknown`）**、**`vite.config.ts` 單檔（含 Vitest 設定，無 `vitest.config.ts`）**、以及**設定檔加強**。你可以把本檔作為唯一真相來源（SSoT），交給任何人實作都不會互踩。

---

# 🐮🐷🐴 Multiplayer Auction + Cow Trade — Master README（完整版）

> 本文件是**唯一真相來源**（Single Source of Truth）。
> 型別、介面、協定、規則、設定檔與指令都以此為準。

---

## 目錄

1. 專案架構（含每檔案職責）
2. 資料型態（Types）
3. 狀態管理（Pinia Stores）
4. 儲存（Persistence）
5. 元件 / Service 介面（Interfaces）
6. 通訊協定（Ably / Host Authority / Identity Contract）
7. 邏輯邊界與 UX 規則（Business Rules）
8. 設定檔與套件（package.json / tsconfig / vite / eslint / prettier / env / JSON 資料）
9. 開發優先順序（Roadmap）
10. 驗收與測試（Acceptance & Tests）
11. 狀態機圖（Mermaid）
12. 疑難排解與常見陷阱

---

## 1) 專案架構（含職責）

```
my-vue-game/
├─ index.html                      # root #app + 載入 main.ts
├─ src/
│  ├─ main.ts                      # 建立 App、Pinia、載入樣式、Ably 啟動
│  ├─ App.vue                      # 根組件：依階段切頁（NameEntry/Lobby/Game）
│  ├─ assets/
│  │  └─ main.css
│  ├─ components/
│  │  ├─ Entry/
│  │  │  ├─ NameEntry.vue         # 只輸入自己的名字，送出即 join
│  │  │  └─ Lobby.vue             # 大廳：玩家清單、Host 徽章、Host 才能「開始遊戲」
│  │  ├─ Hud.vue                  # 玩家/錢/動物/牌庫/回合/Log
│  │  ├─ TurnChoice.vue           # 兩鍵：Auction / Cow Trade（主要玩家）
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
│  │  ├─ game.ts                   # 回合、驢子發錢、計分、終局、hostId
│  │  ├─ auction.ts                # bidding/closing/settlement
│  │  └─ cow.ts                    # select/commit/reveal/settlement
│  ├─ services/
│  │  ├─ rules.ts                  # 常數：SET_SIZE/分數/驢子發錢/面額等
│  │  ├─ broadcast.ts              # Ably 抽象 IBroadcast（publish/subscribe/presence）
│  │  └─ host-election.ts          # Host 選定/遷移（僅兩時機）
│  ├─ networking/
│  │  ├─ ablyClient.ts             # Ably 初始化、channel 工廠、presence
│  │  └─ protocol.ts               # 封包 Envelope、Msg 常數、PayloadByType、schemaVersion
│  ├─ types/
│  │  └─ game.ts                   # 全域 Type（見下節）
│  ├─ composables/
│  │  ├─ usePhaseGuard.ts          # 依 phase 控制可用操作（含權限矩陣）
│  │  ├─ useAuctionViewRole.ts     # 是否主持人
│  │  ├─ useMoneySelection.ts      # MoneyPad 本地暫存（送出前不動真資產）
│  │  └─ useLog.ts                 # 記錄/格式化事件 Log
│  ├─ utils/
│  │  ├─ id.ts                     # uuid/nanoid
│  │  └─ math.ts                   # 合計/比較輔助
│  └─ data/
│     └─ deck.json                 # （可選）定義每動物 4 張的來源資料
├─ tsconfig.json
├─ tsconfig.node.json
├─ package.json
├─ vite.config.ts                  # ★ 單檔，內含 Vitest 設定（無 vitest.config.ts）
├─ .eslintrc.cjs
├─ .prettierrc
├─ .prettierignore
├─ .env.example
└─ .gitignore
```

---

## 2) 資料型態（Types）— `src/types/game.ts`

> 不可擅自擴充未列於此的型別；必要變更需先更新本 README。不得使用 `any`，如需未知型別請用 `unknown`。

```ts
export type Animal =
  | 'chicken' | 'goose' | 'cat' | 'dog' | 'sheep'
  | 'snake' | 'donkey' | 'pig' | 'cow' | 'horse';

export type MoneyDenom = 0 | 10 | 50 | 100 | 200 | 500;

export interface MoneyCard { id: string; value: MoneyDenom; }

export interface Player {
  id: string;               // = clientId = playerId（字典序最小者可成為 Host）
  name: string;
  moneyCards: MoneyCard[];
  animals: Record<Animal, number>;
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
  moneyCardIds: string[];   // 出價錢卡 id 快照（Host 端重算 total）
  total: number;            // 合計（Host 計算）
  ts: number;               // Host 接收時間（先到先贏）
  actionId: string;         // 去重
}

export interface AuctionState {
  auctioneerId?: string;
  card?: Card;
  highest?: Bid;            // 僅保留當前最高（同額比 ts）
  passes: string[];         // **JSON 可序列化**（Set→string[]）
  closed: boolean;
}

export interface CowTradeState {
  initiatorId?: string;
  targetPlayerId?: string;
  targetAnimal?: Animal;
  initiatorSecret?: string[]; // moneyCardIds（僅 Host 記憶體，不持久化/不廣播）
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
  hostId?: string;          // ★ 只在 setup 鎖定與舊 Host 離線時變更
  stateVersion: number;     // Host 每次更新 +1
}

// 由 services/rules.ts 輸出常數內容
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

> **不變式**：只有 Host 可觸發會改變狀態的 action（store 內部先 `assertHost()`）。
> **全量快照**：Client 一律被動接受 Host 廣播的 `state.update` 覆蓋（版本號遞增）。

### `store/game.ts`

* **State**：`phase, players, deck, discard, turnOwnerId, donkeyDrawCount, log, hostId, stateVersion`
* **Getters**

  * `activePlayer()`
  * `playerById(id)`
  * `remainingAuctionableAnimals()`
  * `canChooseAuction()`（第一回合 or 牌庫判斷）
  * `canChooseCowTrade()`（當前玩家是否有錢）
  * `isAnimalLocked(animal)`（任一玩家達成 4 張）
* **Actions（Host-only）**

  * `setupGameFromCurrentPlayers()`

    * 若 `src/data/deck.json` 不存在：以 `Animal` 全列表與 `Rules.SET_SIZE` 生成「每種動物各 4 張」，Fisher–Yates 洗牌；**洗後牌序以 Host 快照為準**（Client 不自行洗牌）。
  * `setHostAtSetup(hostId: string)`（僅 `phase='setup'` 可鎖）
  * `startTurn()` → `phase='turn.choice'`
  * `drawCardForAuction(): Card`
  * `grantDonkeyPayout()`
  * `rotateTurn()`
  * `computeFinalScores(): Array<{ playerId: string; score: number }>`
  * `checkEndAndMaybeFinish()`
  * `appendLog(msg: string)`

### `store/auction.ts`

* **State**：`auction: AuctionState | null`
* **Getters**：`canAuctioneerBuyback()`
* **Actions（Host-only）**

  * `enterBidding()`
  * `placeBid(playerId: string, moneyCardIds: string[], actionId: string)`
  * `passBid(playerId: string)`
  * `hostAward()`
  * `hostBuyback()`
  * `settle(mode: 'award' | 'buyback')` → 轉移資產、`phase='turn.end'`

### `store/cow.ts`

* **State**：`cow: CowTradeState | null`
* **Actions（Host-only）**

  * `selectTarget(targetPlayerId: string)`
  * `selectAnimal(animal: Animal)`
  * `commitSecret(playerId: string, moneyCardIds: string[])`（僅 Host 記憶體）
  * `revealAndResolve()`（平手不交換；否則勝者拿 1/2 張，互換提交錢卡）

> 原則：**資產真正移轉**只在 `auction.settlement`、`cow.revealAndResolve()`。

---

## 4) 儲存（Persistence）

**Phase 2 決策：不使用本地持久化**（Host/Client 皆無 `localStorage`）。

* **重連恢復**：Client 加入後等待 Host 廣播 `state.update`；若 1 秒未收到，送 `system.requestState` 向 Host 索取。
* **Dedup**：Host 端於記憶體維持最近 **N=500、TTL=10m** 的 `actionId` 去重（**不持久化**）。
* **Cow Trade 秘密**：只在 Host 記憶體，不廣播、不持久化。
* **Schema**：`networking/protocol.ts` 維護 `schemaVersion`；必要時升版改頻道前綴（如 `game-v1-`）。

---

## 5) 元件 / Service 介面（Interfaces）

### 元件與事件

* `Entry/NameEntry.vue`

  * props：`initialName?: string`
  * emits：`confirm(name: string)` → 直接 join（presence.enter + system.join）
* `Entry/Lobby.vue`

  * props：`players: Player[]`, `hostId?: string`, `selfId: string`
  * emits：`start-game()`（只有 Host 會看到按鈕）
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
  * emits：`toggle(id: string)`, `clear()`, `confirm(moneyCardIds: string[])`
* `BidList.vue`

  * props：`highest?: Bid`, `showHistory?: boolean`（預設 false）
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

### Composables（要點）

* `usePhaseGuard` → `isActionAllowed(action: string): boolean`（**見第 7 節權限矩陣**）
* `useAuctionViewRole` → `isHost(myId: string): boolean`
* `useMoneySelection` → `selectedIds[]`, `toggle()`, `clear()`, `total()`
* `useLog` → `push(msg: string)`

### Services

* `services/rules.ts`：輸出常數（見第 8 節）

* `services/broadcast.ts`（抽象層）

  ```ts
  import type { MsgType, PayloadByType, Envelope } from '@/networking/protocol';

  export interface IBroadcast {
    /**
    * 上層只需提供 payload；adapter 會自動包成 Envelope 再送出。
    * 可選 opts 讓 Host 廣播時帶上 actionId/stateVersion。
    */
    publish<T extends MsgType>(
      type: T,
      payload: PayloadByType[T],
      opts?: { actionId?: string; stateVersion?: number }
    ): Promise<void>;

    /**
    * 訂閱時 handler 一律接收 Envelope（非 payload-only）。
    * Envelope 內含 senderId/ts/stateVersion 等，供驗證與去重。
    */
    subscribe<T extends MsgType>(
      type: T,
      handler: (envelope: Envelope<PayloadByType[T]>) => void
    ): () => void;

    /**
    * Presence：id === clientId === playerId（Identity Contract）
    */
    presence(): {
      enter(meta: { playerId: string; name: string }): Promise<void>;
      leave(): Promise<void>;
      getMembers(): Promise<Array<{ id: string; data: { playerId: string; name: string } }>>;
    };
  }

  ```

* `services/host-election.ts`

  getHostId(members: Array<{ id: string }>): string | undefined; // 取 **字典序最小** playerId（無成員則 undefined）
  shouldReelect(oldHostId: string, memberIds: string[]): boolean;

---

## 6) 通訊協定（Ably / Host Authority / Identity Contract）

### 6.1 Identity Contract（**關鍵不變式**）

1. `playerId ≡ Ably clientId ≡ Envelope.senderId`。
2. Presence 成員的 `id`（=clientId）才是身分；`data.playerId` 若存在，必須等於 `id`。
3. 同一 `roomId` 下，`playerId` 唯一：若偵測另一條不同 `connectionId` 使用同一 `clientId`，**拒絕加入**。
4. `playerId` 取自 `?player=`，正規化：小寫、去空白、只允許 `[a-z0-9_-]{1,24}`。

### 6.2 Host Authority（僅兩時機）

1. **開局鎖定**：`phase='setup'`、presence 已可得 → 取最小 `playerId` 寫入 `hostId`，由其廣播帶 `hostId` 的首包 `state.update`。
2. **舊 Host 離線**：於剩餘成員中取最小 `playerId` 重選，廣播 `system.hostChanged` + 最新 `state.update`。

> 其餘情況（新玩家加入、非 Host 離線）**不變更** `hostId`。

### 6.3 訊息信任與快照

* **只接受** `senderId === state.hostId` 的 `state.update`；`hostId` 未定時（setup 初期）暫信「當下最小 `playerId`」。
* Host 每處理成功一個 action → `stateVersion++` → 廣播 **完整快照** `state.update`。
* Client 僅在 `incoming.stateVersion > local.stateVersion` 時套用（自然抵禦錯序/重播）。
事件處理統一規則：

publish()：上層傳 payload，adapter 自動包成 Envelope。

subscribe()：handler 一律接收 Envelope<Payload>；請用 envelope.senderId / envelope.actionId / envelope.stateVersion 做驗證與去重，只在需要時讀取 envelope.payload。

// 訂閱快照（Envelope 版）
broadcast.subscribe(Msg.State.Update, (env) => {
  // 只信任 Host 的快照
  if (env.senderId !== game.hostId) return;

  const incoming = env.payload.state;
  if (incoming.stateVersion <= game.stateVersion) return;

  // 套用全量快照（確保是 plain object）
  game.applySnapshot(incoming); // or: (game as any).$state = structuredClone(incoming)
});


### 6.4 Channel

* `game-v1-{roomId}`（≤5 人）

### 6.5 封包 Envelope — `networking/protocol.ts`

> 不得使用 `any`，若必要請用 `unknown`。

```ts
export interface Envelope<T = unknown> {
  type: MsgType;           // 見下方 Msg 與 PayloadByType
  roomId: string;
  senderId: string;        // = clientId = playerId
  actionId?: string;       // 僅 action.*
  stateVersion?: number;   // 僅 state.update
  ts: number;              // Host 接收/廣播時間（毫秒）
  payload: T;
  schemaVersion: number;   // 例如 1
}
```

### 6.6 訊息常數與 Payload 型別對映（**避免手滑字串**）

```ts
export const Msg = {
  Action: {
    StartGame: 'action.startGame',
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

export interface PayloadByType {
  [Msg.Action.StartGame]: { playerId: string };
  [Msg.Action.PlaceBid]: { playerId: string; moneyCardIds: string[] };
  [Msg.Action.PassBid]: { playerId: string };
  [Msg.Action.ChooseAuction]: { playerId: string };
  [Msg.Action.ChooseCowTrade]: { playerId: string };
  [Msg.Action.SelectCowTarget]: { playerId: string; targetId: string };
  [Msg.Action.SelectCowAnimal]: { playerId: string; animal: Animal };
  [Msg.Action.CommitCowTrade]: { playerId: string; moneyCardIds: string[] }; // 只給 Host
  [Msg.Action.HostAward]: { playerId: string };
  [Msg.Action.HostBuyback]: { playerId: string };

  [Msg.State.Update]: { state: GameState };

  [Msg.System.Join]: { playerId: string; name: string };
  [Msg.System.Leave]: { playerId: string };
  [Msg.System.HostChanged]: { newHostId: string };
  [Msg.System.RequestState]: { requesterId: string };
}

export function makeEnvelope<T extends MsgType>(
  type: T,
  roomId: string,
  senderId: string,
  payload: PayloadByType[T],
  opts?: { actionId?: string; stateVersion?: number }
): Envelope<PayloadByType[T]> {
  return {
    type,
    roomId,
    senderId,
    actionId: opts?.actionId,
    stateVersion: opts?.stateVersion,
    ts: Date.now(),
    payload,
    schemaVersion: 1
  };
}
```

---

## 7) 邏輯邊界與 UX 規則（Business Rules）

### 全局

* **UI 流**：進站只輸入自己的名字（NameEntry）→ 送出即 join（=Ready）→ 進 Lobby。只有 Host 看得到/能按「開始遊戲」。
* 棄牌堆不重洗；無回合上限。
* 沒錢玩家：禁用出價、禁用發起 Cow Trade（仍可被挑戰）。
* `playerId` 唯一；同 room 第二分頁若使用同 `playerId` 必須被拒絕加入。

### 拍賣

* 主持人必須參與結標。
* 無人出價 → 主持人直接拿牌。
* 出價可多次加碼；只保留當前**最高價**並廣播。
* 平手：先出價者優先（以 Host `ts`）。
* 買回：主持人需能湊等額錢卡，不足則禁用。
* 結算：在 `auction.settlement` 一次性轉移錢卡/動物卡並寫 log。

### 驢子事件

* 共 4 張；每抽一張，全員獲得：第1隻 +50、第2隻 +100、第3隻 +200、第4隻 +500。
* 該驢子仍照常拍賣。

### Cow Trade

* 每回合僅能發起一次；完成即結束回合。
* 只能挑「有動物」的玩家；只能選未被鎖的動物（有人完成 4 張即鎖）。
* 秘密出錢：雙方提交錢卡，不可撤回，僅 Host 知。
* 平手：不交換動物、不交換錢卡 → 直接結束回合。
* 結算：雙方該動物各 ≥2 → 勝者拿 2 張；否則 1 張；雙方互換提交錢卡。
* **Host 遷移保守處理（Phase 2）**：若在 `cow.commit`/`cow.reveal` 階段舊 Host 離線 → 取消本回合 Cow Trade，回到 `turn.choice`。

### 終局與計分

* 終局：所有動物種類至少有一位玩家集滿 4 張。
* 分數表：雞10、鵝40、貓90、狗160、羊250、蛇350、驢500、豬650、牛800、馬1000。
* 玩家總分 =（完成 4 張的那些動物的分值總和）×（完成 4 張的動物組數）。

### **權限矩陣（供 `usePhaseGuard` 與測試對照）**

| Phase                | 允許的 Action                                     | 限制條件                                              |
| -------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `setup`              | `START_GAME`（Host 專屬）                          | `players.length` 合法（建議 2–5 人）、`senderId===hostId` |
| `turn.choice`        | `CHOOSE_AUCTION`、`CHOOSE_COW_TRADE`            | `canChooseAuction()` / `canChooseCowTrade()`      |
| `auction.bidding`    | `PLACE_BID`（可多次）、`PASS_BID`                    | 沒錢禁用；主持人可出價但不可 `PASS_BID`                         |
| `auction.closing`    | `HOST_AWARD`、`HOST_BUYBACK`                    | `canAuctioneerBuyback()` 為 true 才能買回              |
| `auction.settlement` | （系統內部結算）                                       | 無                                                 |
| `cow.selectTarget`   | `SELECT_TARGET`                                | 目標玩家必須「有動物」                                       |
| `cow.selectAnimal`   | `SELECT_ANIMAL`                                | 該動物未被鎖                                            |
| `cow.commit`         | `COMMIT_COW_TRADE`（雙方各一次、不可撤）                  | 僅發起者與目標可提交                                        |
| `cow.reveal`         | `REVEAL_AND_RESOLVE`（Host 觸發）                  | 雙方皆已提交                                            |
| `cow.settlement`     | （系統內部結算）                                       | 無                                                 |
| `turn.end`           | （系統）`isEndGame` → `game.end`；否則回 `turn.choice` | 無                                                 |
| `game.end`           | （結束）                                           | 無                                                 |

---

## 8) 設定檔與套件

### `package.json`

```json
{
  "name": "my-vue-game",
  "version": "0.1.0",
  "private": true,
  "description": "Multiplayer Auction + Cow Trade (Vue 3 + Pinia + Ably)",
  "type": "module",
  "packageManager": "npm@10",
  "engines": { "node": ">=18.17.0" },
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview --strictPort --port 5173",
    "type-check": "vue-tsc --noEmit",
    "test": "vitest run",
    "test:ui": "vitest --ui",
    "lint": "eslint --ext .ts,.vue src",
    "lint:fix": "eslint --ext .ts,.vue src --fix",
    "format": "prettier --write .",
    "check": "npm run type-check && npm run lint && npm run test"
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
    "eslint-plugin-import": "^2.29.1",
    "eslint-plugin-promise": "^6.1.1",
    "eslint-plugin-vue": "^9.26.0",
    "eslint-config-prettier": "^9.1.0",
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
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useDefineForClassFields": true
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

### Vite（**單檔：`vite.config.ts`**）

> 使用單一 `vite.config.ts`，內含 Vitest 設定；不建立 `vitest.config.ts`。

```ts
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import pkg from './package.json' assert { type: 'json' };

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  server: { port: 5173, strictPort: true, hmr: { overlay: true } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  build: { sourcemap: true, target: 'es2020' },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: { reporter: ['text', 'html', 'lcov'] },
    environmentOptions: { happyDOM: { url: 'http://localhost:5173' } }
  }
});
```

### ESLint / Prettier

`.eslintrc.cjs`

```js
/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', extraFileExtensions: ['.vue'] },
  extends: [
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:promise/recommended',
    'prettier' // 關閉與 Prettier 衝突規則
  ],
  settings: { 'import/resolver': { typescript: true } },
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    'import/no-unresolved': 'error',
    'import/order': ['warn', { 'newlines-between': 'always', groups: [['builtin','external','internal'], ['parent','sibling','index']] }]
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '.vitest']
};
```

`.prettierrc`

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "es5", "vueIndentScriptAndStyle": true }
```

`.prettierignore`

```
node_modules
dist
coverage
.vitest
```

### `.env.example`

```
# 前端可用的環境變數需以 VITE_ 開頭
VITE_ABLY_API_KEY=YOUR-ABLY-API-KEY
VITE_APP_NAME=MyVueGame
```

### `.gitignore`

```
/node_modules/
/dist/
coverage/
.vitest/
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/
.DS_Store
*.local
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*
/node_modules/.cache/
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

## 9) 開發優先順序（Roadmap）

1. **Phase 0**：骨架、型別、rules、Hud/TurnChoice、Log
2. **Phase 1**：本地單機 MVP（game + auction: award 流、終局/計分）
3. **Phase 2**：Ably（Host Authority 兩時機、presence、完整快照 `state.update`、`actionId` 去重、`stateVersion`；UI：NameEntry/Lobby/StartGame；**無本地持久化**）
4. **Phase 3**：Auction 買回 + guard；平手先到先贏（ts）
5. **Phase 4**：Cow Trade（select/commit/reveal/settlement；秘密只給 Host）
6. **Phase 5**：韌性/UX（斷線恢復、禁用邏輯、log 強化、Host 快照鏡像）
7. **Phase 6**：測試加強（stores + 協定）、Host 遷移保底、行動版 UI

---

## 10) 驗收與測試（Acceptance & Tests）

**UI/身分/Host**

* 進站只填名字 → 送出即 join；Lobby 顯示玩家清單與 Host 徽章。
* 只有 Host 看得到/能按「開始遊戲」；人數不合法（建議 <2 或 >5）按鈕禁用。
* 同一 room 二登（相同 `playerId`）→ 新分頁被拒絕加入。
* setup 期以 presence 最小 `playerId` 鎖定 `hostId`；非 Host 離線不改 `hostId`；**舊 Host 離線**才重選。

**協定/一致性**

* Client 只接受 `senderId===hostId` 的 `state.update`；`stateVersion` 必單調遞增；錯序/重播不生效。
* `AuctionState.passes` 為 `string[]`，快照/反序列化一致。
* 任一 action 透過 Host 驗證後才生效並廣播快照。
* `actionId` 去重：連續重送同 `actionId` 僅生效一次。

**遊戲規則**

* 驢子連抽：依第 1\~4 張正確發錢，仍進拍賣。
* 拍賣無人出價：主持人拿牌。
* 出價平手：先到先贏（以 Host `ts`）。
* 買回資金不足：按鈕禁用。
* 第一回合：Cow Trade 禁用。
* Cow Trade：對手需有動物；被鎖動物不可選。
* Cow Trade 平手：不交換動物與錢卡。
* Cow Trade 結算：雙方各 ≥2 → 勝者拿 2 張；否則 1 張；互換提交錢卡。
* 終局與計分正確。
* **Host 遷移中斷**：若在 `cow.commit`/`cow.reveal` 階段舊 Host 離線 → 新 Host 取消該回合，回 `turn.choice`。

---

## 11) 狀態機圖（Mermaid）

```mermaid
stateDiagram-v2
  [*] --> setup
  setup --> turn_choice: START_GAME (Host only)

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

## 12) 疑難排解與常見陷阱

**A. Vitest 設定**

* 將測試設定放在 **單一 `vite.config.ts`**（見第 8 節），`import { defineConfig } from 'vitest/config'`。不建立 `vitest.config.ts`。

**B. Presence 出現重複 playerId**

* 確認 **clientId=playerId** 建立連線；拒絕同 room 相同 `playerId` 的第二條連線。
* Presence 只信 `member.id`；若 `data.playerId` 存在，必等於 `id`。
* Host 選舉以 `id`（=clientId）排序；**不要**用 `data.playerId`。

**C. 快照信任**

* 僅接受 `senderId===hostId` 的 `state.update`；未定 host 期只暫信最小 `playerId` 的快照。
* `stateVersion` 必單調，否則忽略。

**D. Cow Trade 秘密**

* Phase 2 不持久化/不廣播；Host 遷移時若在 `commit/reveal` → 直接取消本回合。

**E. Proxy/序列化**

* 廣播快照前建議 `structuredClone(gameState)`，避免 Vue/Pinia proxy 造成序列化異常。
若使用 Pinia/Vue store，建議由 store 提供 toSnapshot(): GameState 取得 plain object；或在廣播前對 plain object 執行 structuredClone()，避免將 Proxy/循環參照丟入導致 DataCloneError。
---

## 快速啟動

```bash
npm i
cp .env.example .env   # 填入 VITE_ABLY_API_KEY
npm run dev

# 檢查/測試/建置
npm run type-check
npm test
npm run build && npm run preview
```

---

### 使用說明

* 想要我**直接完成某個檔案的完整程式碼**：只需把「檔名＋本 README」給我即可。
* 若要修改規則或介面：先更新本 README，再實作，避免互相踩到。

---

**本版整合要點**

* `AuctionState.passes` 使用 `string[]` 可序列化。
* Identity & Host 規範：`playerId≡clientId≡senderId`、Host 僅兩時機決定/變更。
* `Msg` 常數與 `PayloadByType` 映射，`Envelope<T=unknown>`（不使用 `any`）。
* UI：NameEntry/Lobby，Host-only Start；Phase 2 **無本地持久化**。
* `state.update` 全量快照 + `stateVersion` 單調遞增；`actionId` 去重策略。
