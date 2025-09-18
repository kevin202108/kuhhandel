好的，這份是依照我們前面所有共識「**整併後、零歧義**」的 **Master README（最新版）**。
已將先前的規格補完、Phase 2（單機→Ably，先不做 Cow Trade/買回）的決策、訊息用法、測試/除錯做法全部合併。
特別注意：本版把幾處容易踩雷的地方**釘死**（已用【規格補完】標示），並修正成 **MVP 版強制「嚴格大於」才算有效出價**（不再用 ts 搶先），`ts` 僅做稽核用；`tsconfig.json` 也改成 `exactOptionalPropertyTypes:false`，以利快照/初始化。

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
13. 開發模式 / Debug（DevPanel、Log、旗標）

---

## 1) 專案架構（含職責）

```
my-vue-game/
├─ index.html                      # root #app + 載入 main.ts
├─ src/
│  ├─ main.ts                      # 建立 App、Pinia、載入樣式、Ably 啟動、debug 旗標
│  ├─ App.vue                      # 根組件：依階段切頁（NameEntry/Lobby/Game）
│  ├─ assets/
│  │  └─ main.css
│  ├─ components/
│  │  ├─ Entry/
│  │  │  ├─ NameEntry.vue         # 只輸入名字；送出即 join
│  │  │  └─ Lobby.vue             # 大廳：玩家清單、Host 徽章、Host 才能「開始遊戲」
│  │  ├─ Hud.vue                  # 玩家/錢/動物/牌庫/回合/Log
│  │  ├─ TurnChoice.vue           # 兩鍵：Auction / Cow Trade（主要玩家）
│  │  ├─ Auction/
│  │  │  ├─ AuctionBidderView.vue # 投標者：MoneyPad、確認出價/放棄
│  │  │  ├─ AuctionHostView.vue   # 主持人：得標 / 買回（Phase 2 先禁用）
│  │  │  ├─ MoneyPad.vue          # 錢卡按鈕群（多選、取消、合計）
│  │  │  └─ BidList.vue           # 顯示目前最高價（可選歷史）
│  │  └─ CowTrade/
│  │     ├─ CowTargetPicker.vue   # ⏸ Phase 4 才開
│  │     ├─ CowAnimalPicker.vue   # ⏸ Phase 4 才開
│  │     └─ CowConfirmBar.vue     # ⏸ Phase 4 才開（只傳 Host）
│  ├─ store/
│  │  ├─ game.ts                   # 回合、驢子發錢、計分、終局、hostId
│  │  ├─ auction.ts                # bidding/closing/settlement
│  │  └─ cow.ts                    # ⏸ Phase 4 才開
│  ├─ services/
│  │  ├─ rules.ts                  # 常數：SET_SIZE/分數/驢子發錢/面額等
│  │  ├─ broadcast.ts              # IBroadcast（publish/subscribe/presence, Envelope）
│  │  └─ host-election.ts          # Host 選定/遷移（僅兩時機）
│  ├─ networking/
│  │  ├─ ablyClient.ts             # Ably 初始化、channel 工廠、presence
│  │  └─ protocol.ts               # Envelope、Msg 常數、PayloadByType、schemaVersion
│  ├─ types/
│  │  └─ game.ts                   # 全域 Type（見下節）
│  ├─ composables/
│  │  ├─ usePhaseGuard.ts          # 依 phase 控制可用操作（含權限矩陣）
│  │  ├─ useAuctionViewRole.ts     # 是否主持人
│  │  ├─ useMoneySelection.ts      # MoneyPad 本地暫存（送出前不動真資產）
│  │  └─ useLog.ts                 # 記錄/格式化事件 Log
│  ├─ utils/
│  │  ├─ id.ts                     # uuid/nanoid
│  │  └─ math.ts                   # 合計/比較輔助（忽略 0 面額）
│  └─ data/
│     └─ deck.json                 # （可選）每動物 4 張來源資料
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

> 不得使用 `any`；未知請用 `unknown`。不得擅自擴充未列型別（先改 README）。

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
  moneyCardIds: string[];   // 送出時的錢卡 id 快照（Host 端重算 total）
  total: number;            // 合計（Host 計算，忽略 0）
  ts: number;               // Host 接收時間（稽核用；Phase 2 不作裁定）
  actionId: string;         // 去重
}

export interface AuctionState {
  auctioneerId?: string;
  card?: Card;
  highest?: Bid;            // 【Phase 2】僅保留當前最高（嚴格大於才更新）
  passes: string[];         // 可序列化（Set→string[]）
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

> **不變式**：只有 Host 可觸發改變狀態的 action（store 內部先 `assertHost()`）。
> **快照**：Client 一律被動接受 Host 廣播的 `state.update` 覆蓋（`stateVersion` 嚴格遞增）。

### `store/game.ts`

State：`phase, players, deck, discard, turnOwnerId, donkeyDrawCount, log, hostId, stateVersion`
Getters：

* `activePlayer()`／`playerById(id)`
* `remainingAuctionableAnimals()`
* `canChooseAuction()` → `deck.length>0`
* `canChooseCowTrade()` → 【Phase 2 先關】固定 `false`；（未來規則：非首回合、回合玩家有錢、場上有對手有動物、存在未鎖動物）
* `isAnimalLocked(animal)` → 任一玩家該動物達 4 張

Host-only Actions：

* `setupGameFromCurrentPlayers()`

  * 若缺 `data/deck.json` 或驗證失敗 → 自動以 `Animal×SET_SIZE(=4)` 生成並 Fisher–Yates 洗牌。**洗後牌序以 Host 為準**（Client 不洗）。
* `setHostAtSetup(hostId)`（僅 `phase='setup'`）
* `startTurn()` → `phase='turn.choice'`
* `drawCardForAuction(): Card`（若驢則依 `donkeyDrawCount` 發錢後仍進拍賣）
* `grantDonkeyPayout()`
* `rotateTurn()`（playerId 升冪，跳過離線者）【規格補完】
* `computeFinalScores(): Array<{ playerId: string; score: number }>`
* `checkEndAndMaybeFinish()`
* `appendLog(msg: string)`

### `store/auction.ts`

State：`auction: AuctionState | null`
Getters：`canAuctioneerBuyback()`（精確等額，Phase 3 才用）
Host-only Actions：

* `enterBidding()`（抽牌→若驢先發錢→`phase='auction.bidding'`）
* `placeBid(playerId, moneyCardIds, actionId)`（**嚴格大於**當前最高；忽略 0 面額；將最高者那組卡標為「鎖」—Phase 2 可先用 UI 禁用）
* `passBid(playerId)`（該場不可再出價；當「除最高者外皆 PASS」→ `auction.closing`）
* `hostAward()`（頒給最高者；無人出價則主持人收下）
* `hostBuyback()`／`settle(mode)`（Phase 3 才開）

### `store/cow.ts`（Phase 4 才開）

Host-only Actions：`selectTarget`／`selectAnimal`／`commitSecret`／`revealAndResolve`

> **原則**：資產移轉只在 `auction.settlement`、`cow.revealAndResolve()`。

---

## 4) 儲存（Persistence）

**Phase 2 決策：不使用本地持久化**（Host/Client 皆無 `localStorage`）。

* **重連恢復**：Client 入場後等待 `state.update`；若 1s 未收到，送 `system.requestState`。
* **Action 去重**：Host 記憶體維持 **N=500、TTL=10m** 的 `(senderId|type|actionId)` 去重（不持久化）。
* **Cow Trade 秘密**：僅 Host 記憶體；不廣播、不持久化。
* **Schema**：`protocol.ts` 維護 `schemaVersion`；必要時升版改頻道前綴（`game-v1-…`）。

---

## 5) 元件 / Service 介面（Interfaces）

### 元件（props / emits 摘要）

* `Entry/NameEntry.vue` → emits：`confirm(name: string)`（presence.enter + `system.join`）
* `Entry/Lobby.vue` → emits：`start-game()`（**僅 Host**顯示）
* `TurnChoice.vue` → emits：`choose-auction` | `choose-cow-trade`（Phase 2：Cow Trade 長期 disabled）
* `AuctionBidderView.vue` → emits：`place-bid(moneyCardIds)`、`pass()`
* `AuctionHostView.vue` → emits：`award()`、`buyback()`（Phase 2 disabled）
* `MoneyPad.vue` → emits：`toggle(id)`、`clear()`、`confirm(moneyCardIds)`
* `BidList.vue` / `Hud.vue`：顯示用，無 emits
* `Cow*`：Phase 4 才開

### Composables

* `usePhaseGuard` → `isActionAllowed(action: string)`（見 §7 權限矩陣）
* `useAuctionViewRole` → `isHost(myId)`
* `useMoneySelection` → `selectedIds[]`、`toggle()`、`clear()`、`total()`（忽略 0）
* `useLog` → `push(msg)`（HUD 文字）

### Services

#### `services/rules.ts`

單一來源：`SET_SIZE=4`、`MONEY_DENOMS=[0,10,50,100,200,500]`、`START_MONEY={0:2,10:4,50:1}`、`DONKEY_PAYOUTS=[50,100,200,500]`、`ANIMAL_SCORES` 如 §8

#### `services/broadcast.ts`（抽象層，**Envelope 版**）

```ts
import type { MsgType, PayloadByType, Envelope } from '@/networking/protocol';

export interface IBroadcast {
  publish<T extends MsgType>(
    type: T,
    payload: PayloadByType[T],
    opts?: { actionId?: string; stateVersion?: number }
  ): Promise<void>;

  // 訂閱者收到「Envelope」，可用 senderId/stateVersion/actionId 做驗證與去重
  subscribe<T extends MsgType>(
    type: T,
    handler: (envelope: Envelope<PayloadByType[T]>) => void
  ): () => void;

  presence(): {
    enter(meta: { playerId: string; name: string }): Promise<void>;
    leave(): Promise<void>;
    getMembers(): Promise<Array<{ id: string; data: { playerId: string; name: string } }>>;
    // 說明：presence.id === clientId === playerId
  };
}
```

#### `services/host-election.ts`

```ts
export function getHostId(members: Array<{ id: string }>): string | undefined; // 字典序最小 id
export function shouldReelect(oldHostId: string, memberIds: string[]): boolean;
```

---

## 6) 通訊協定（Ably / Host Authority / Identity Contract）

### 6.1 Identity Contract（不變式）

1. `playerId ≡ Ably clientId ≡ Envelope.senderId`。
2. Presence 成員的 `id`（=clientId）才是身分；若 `data.playerId` 存在，必須等於 `id`。
3. 同一 `roomId` 下 `playerId` 唯一：偵測不同 `connectionId` 使用同 `clientId` → **後加入者拒絕**。
4. 【規格補完】`playerId` 取自 `?player=`，正規化：小寫、去空白、僅允許 `[a-z0-9_-]{1,24}`。

### 6.2 Host Authority（僅兩時機）

1. **開局鎖定**：`phase='setup'`，presence **同步完成** → 取最小 `playerId` 寫入 `hostId`，由其廣播首包 `state.update`（內含 `hostId`）。
2. **舊 Host 離線**：於剩餘成員取最小 `playerId` 重選，廣播 `system.hostChanged` + 最新 `state.update`。

> 其餘情況（新玩家加入、非 Host 離線）**不變更** `hostId`。

### 6.3 訊息信任與快照

* Client **只接受** `senderId===state.hostId` 的 `state.update`；`hostId` 未定時（setup 初期）暫信「當下最小 `playerId`」。
* Host 每處理成功一個 action → `stateVersion++` → 廣播**完整快照** `state.update`。
* Client 僅在 `incoming.stateVersion > local.stateVersion` 時套用（天然抵禦錯序/重播）。

### 6.4 Channel

* `game-v1-{roomId}`（≤5 人）；【規格補完】`roomId` 僅允許 `[a-z0-9_-]{1,24}`。

### 6.5 封包 Envelope — `networking/protocol.ts`

```ts
export interface Envelope<T = unknown> {
  type: MsgType;           // 見 Msg / PayloadByType
  roomId: string;
  senderId: string;        // = clientId = playerId
  actionId?: string;       // 僅 action.*
  stateVersion?: number;   // 僅 state.update
  ts: number;              // Host 接收/廣播時間（毫秒；稽核用）
  payload: T;
  schemaVersion: number;   // 例如 1
}
```

### 6.6 訊息常數與 Payload 型別

（保留 Cow/Buyback 以備後續；**Phase 2 僅用到：StartGame / ChooseAuction / PlaceBid / PassBid / HostAward / State.Update / System.\*(Join/RequestState/HostChanged)**）

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
  [Msg.Action.CommitCowTrade]: { playerId: string; moneyCardIds: string[] }; // Host-only
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
    type, roomId, senderId,
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

* **UI 流**：NameEntry 輸入名字（normalize 後即 join）→ 進 Lobby。只有 Host 看得到/能按「開始遊戲」。
* 棄牌堆不重洗；無回合上限。
* **有錢定義**：玩家**正面面額合計 > 0**（忽略 0 面額）【規格補完】。
* `playerId` 唯一；同 room 第二分頁若使用同 `playerId` → 後加入者自動離線。
* 【回合順序】首回合 `turnOwnerId = hostId`；之後按 `playerId` 升冪輪轉（跳過離線；回來再接）。

### 拍賣（Phase 2 版）

* 抽牌：若為驢 → 依 `donkeyDrawCount` 發錢（+50/+100/+200/+500），**該驢仍照常拍賣**。
* 出價：Host 以 `moneyCardIds` 計 `total`（忽略 0）；**total 必須嚴格大於**現最高價才成立（不以 `ts` 搶先）。
* PASS：送出後本場不可再出價。當「除最高者外皆 PASS」→ `auction.closing`。
* 結標（award）：

  * 有最高者：扣該組卡（付至 Bank：移出遊戲）、動物卡給最高者。
  * 無人出價：動物卡給主持人（= `turnOwnerId`）。
  * `turn.end` → 檢查終局 → 否則輪轉。
* 買回（buyback）：**Phase 2 禁用**；Phase 3 才啟並需**精確等額**（無找零）。

> （未來 Phase 3 如要改成「允許同額，以 `ts` 先到先贏」→ 屆時需調整本節與 `Bid` 註解）

### 驢子事件

* 全局共 4 張；每抽一張，全員獲得：第1隻 +50、第2隻 +100、第3隻 +200、第4隻 +500；該驢仍進拍賣。
* 鑄造新錢卡（`nanoid`），**id 唯一**。

### Cow Trade（Phase 4 才開）

* 這一版文檔保留完整規範，但在 Phase 2 **UI 長期 disabled**，協定亦不使用。

### 終局與計分

* 終局：**所有 10 種動物**至少有一位玩家集滿 4 張。
* 分數表：雞10、鵝40、貓90、狗160、羊250、蛇350、驢500、豬650、牛800、馬1000。
* 玩家總分 =（他完成 4 張的那些動物分值總和）×（完成 4 張的動物組數）。

### 權限矩陣（對 `usePhaseGuard` 與測試）

| Phase                | 允許的 Action                          | 限制條件                                                                    |
| -------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `setup`              | `START_GAME`（Host）                  | `senderId===hostId`、玩家數建議 2–5                                           |
| `turn.choice`        | `CHOOSE_AUCTION`、`CHOOSE_COW_TRADE` | `canChooseAuction()` / `canChooseCowTrade()`；Phase 2：Cow Trade 固定 false |
| `auction.bidding`    | `PLACE_BID`（可多次）、`PASS_BID`         | 沒錢禁用；Host 可出價但不可 `PASS_BID`                                             |
| `auction.closing`    | `HOST_AWARD`、`HOST_BUYBACK`         | Phase 2：只允許 `HOST_AWARD`；`HOST_BUYBACK` disabled                        |
| `auction.settlement` | （系統內部）                              | —                                                                       |
| `cow.*`              | 規則如前，但 Phase 2 全禁                   | —                                                                       |
| `turn.end`           | 系統判定終局→`game.end`；否則回 `turn.choice` | —                                                                       |
| `game.end`           | （結束）                                | —                                                                       |

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

### `tsconfig.json`（**依建議已改**）

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
    "exactOptionalPropertyTypes": false,
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

### `vite.config.ts`（單檔，同時當 Vitest 設定）

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
    'prettier'
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
/.vscode/*
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

---

## 9) 開發優先順序（Roadmap）

1. **Phase 0**：骨架、型別、rules、Hud/TurnChoice、Log
2. **Phase 1**：本地單機 MVP（game + auction: award 流、終局/計分）
3. **Phase 2**：Ably（Host Authority 兩時機、presence、完整快照 `state.update`、`actionId` 去重、`stateVersion`；UI：NameEntry/Lobby/StartGame；**無本地持久化**）
4. **Phase 3**：Auction 買回 + guard；（可選）若要支援「同額先到先贏（ts）」需同步修改本 README
5. **Phase 4**：Cow Trade（select/commit/reveal/settlement；秘密只給 Host）
6. **Phase 5**：韌性/UX（斷線恢復、禁用邏輯、log 強化、Host 快照鏡像）
7. **Phase 6**：測試加強（stores + 協定）、Host 遷移保底、行動版 UI

---

## 10) 驗收與測試（Acceptance & Tests）

**UI / 身分 / Host**

* 進站只填名字 → 送出即 join；Lobby 顯示玩家清單與 Host 徽章。
* 只有 Host 看得到/能按「開始遊戲」；人數不合法（建議 <2 或 >5）按鈕禁用。
* 同一 room 二登（相同 `playerId`）→ **後加入者**被拒絕（本地離線）。
* setup 期以 presence 最小 `playerId` 鎖定 `hostId`；**僅舊 Host 離線**才重選。

**協定 / 一致性**

* Client 只接受 `senderId===hostId` 的 `state.update`；`stateVersion` 單調遞增；錯序/重播無效。
* `AuctionState.passes` 為 `string[]`（可序列化），反序列化後一致。
* 任一 action 僅經 Host 驗證成功後才生效，隨後廣播快照。
* `actionId` 去重：同 `(sender|type|actionId)` 僅生效一次（N=500、TTL=10m）。

**遊戲規則（Phase 2）**

* 驢子連抽：依第 1\~4 張正確發錢，仍進拍賣。
* 拍賣無人出價：主持人拿牌。
* **出價必須嚴格大於**目前最高價；同額不成立（`ts` 僅稽核用）。
* 買回：按鈕禁用（Phase 3 再開）。
* 第一回合：Cow Trade 禁用（Phase 2 全關）。
* 終局與計分正確。

**Host 遷移**

* 舊 Host 離線 → 新 Host（最小 `playerId`）發 `system.hostChanged` + 最新 `state.update`。
* （Phase 4 才需）若在 `cow.commit/reveal` 階段發生遷移 → 取消當回合。

---

## 11) 狀態機圖（Mermaid）

```mermaid
stateDiagram-v2
  [*] --> setup
  setup --> turn_choice: START_GAME (Host only)

  state turn_choice as "turn.choice"
  turn_choice --> auction_bidding: CHOOSE_AUCTION / canChooseAuction
  turn_choice --> cow_selectTarget: CHOOSE_COW_TRADE / canChooseCowTrade (Phase 4)

  state auction_bidding as "auction.bidding"
  auction_bidding --> auction_bidding: PLACE_BID (strictly higher)
  auction_bidding --> auction_closing: ALL_OTHERS_PASS_EXCEPT_HIGHEST
  auction_closing --> auction_settlement: HOST_AWARD (Phase 2)
  %% Phase 3: HOST_BUYBACK
  auction_settlement --> turn_end

  %% Cow flow opens in Phase 4
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

* 測試設定放在**單一 `vite.config.ts`**（匯入 `defineConfig` 自 `vitest/config`），不建立 `vitest.config.ts`。

**B. Presence 重複 `playerId`**

* 確認 **clientId=playerId** 建立連線；若偵測同 `roomId` 有異連線同 `clientId` → **本地視自己為後加入者**並 `leave()`。
* Host 選舉以 `member.id`（=clientId）排序，**不要**用 `data.playerId`。

**C. 快照信任**

* 僅接受 `senderId===hostId` 的 `state.update`；未定 host 期暫信當下最小 `playerId`。
* `stateVersion` 非遞增一律忽略。

**D. Cow Trade 秘密**（Phase 4 才會用）

* 僅 Host 記憶體，不廣播、不持久化；Host 遷移中處於 commit/reveal → 取消當回合。

**E. Proxy/序列化**

* 廣播快照前以 `structuredClone(plainGameState)`，避免 Pinia/Vue Proxy 造成序列化異常。
* `MoneyCard.id`/`Card.id` 全域唯一；刪除後不可重用。

---

## 13) 開發模式 / Debug（DevPanel、Log、旗標）

**URL 旗標（在 `main.ts` 讀取）**

```ts
const url = new URL(location.href);
(window as any).__DEBUG__ = url.searchParams.get('debug') === '1';
(window as any).__ROOM__  = url.searchParams.get('room') ?? 'dev';
(window as any).__PLAYER__= url.searchParams.get('player') ?? '';
(window as any).__SEED__  = url.searchParams.get('seed'); // 可選：固定洗牌種子
```

**DevPanel.vue（僅 `debug=1` 顯示）**

* 「➕ 假玩家三人」：建立 Alice/Bob/Carol 並分發 `START_MONEY`。
* 「🃏 指定頂牌」：把 deck 頂牌改成指定動物（便於重現劇本）。
* 「💰 發錢(100) 給某人」：直接補錢卡（測流程）。
* 「📸 Snapshot / ⏪ Restore」：把 `GameState` 存/讀 `sessionStorage`。

**Log（雙軌）**

* HUD：人話一行，如：`[BID] alice total=160`、`[AWARD] horse->carol`、`[DONKEY] +50 all`。
* Console（結構化）：

  ```ts
  export function logAction(type: string, detail: unknown) {
    if (!(window as any).__DEBUG__) return;
    console.groupCollapsed(`[Action] ${type}`); console.log(detail); console.groupEnd();
  }
  export function logState(label: string, state: unknown) {
    if (!(window as any).__DEBUG__) return;
    console.groupCollapsed(`[State] ${label}`); console.dir(state, { depth: null }); console.groupEnd();
  }
  ```
* Adapter 內攔截：`console.debug('[PUB]', type, payload, opts)`、接收端 `console.debug('[RECV]', envelope)`。
* **未實作分支**：`console.warn('[UNIMPL] hostBuyback disabled in Phase 2')`。

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

* 想要**直接完成某個檔案的完整程式碼**：把「檔名＋本 README」丟給實作者即可。
* 如需調整規則或介面：**先更新本 README** 再實作，避免歧義與回退。

---

**本版整合要點（相對上一版差異）**

* `tsconfig.json` 改為 `exactOptionalPropertyTypes: false`（快照/初始化更順手）。
* **Phase 2 出價規則改為「嚴格大於」**，不再以 `ts` 搶先；`ts` 僅用於稽核。
* `IBroadcast.subscribe` handler 接 **Envelope**，以便驗證 `senderId/stateVersion/actionId`。
* Host 選舉/重連/去重/快照信任與 `roomId`/`playerId` 正規化全面明確。
* DevPanel＋Log 方案納入正式 README，可直接 UI 手測覆蓋 MVP。
