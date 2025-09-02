下面是**整合了我先前建議補強的「完整版 Master README」**。你之後只要把這份 README 給任何人，並指派檔名，他們就能直接實作出不互相衝突的完整程式碼。

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
6. 通訊協定（Ably / Host Authority）
7. 邏輯邊界與 UX 規則（Business Rules）
8. 設定檔與套件（package.json / tsconfig / vite / eslint / prettier / env / JSON 資料）
9. 開發優先順序（Roadmap）
10. 驗收與測試（Acceptance & Tests）
11. 狀態機圖（Mermaid）
12. 疑難排解：Vite `test` 設定錯誤修復

---

## 1) 專案架構（含職責）

```
my-vue-game/
├─ index.html                     # root #app + 載入 main.ts
├─ src/
│  ├─ main.ts                     # 建立 App、Pinia、載入樣式
│  ├─ App.vue                     # 根組件：依 phase/subphase 切頁
│  ├─ assets/
│  │  └─ main.css
│  ├─ components/
│  │  ├─ Hud.vue                  # 玩家/錢/動物/牌庫/回合/Log
│  │  ├─ TurnChoice.vue           # 兩鍵：Auction / Cow Trade（主要玩家）
│  │  ├─ Auction/
│  │  │  ├─ AuctionBidderView.vue# 投標者：MoneyPad、確認出價/放棄
│  │  │  ├─ AuctionHostView.vue  # 主持人：得標 / 買回（可禁用）
│  │  │  ├─ MoneyPad.vue         # 錢卡按鈕群（多選、取消、合計）
│  │  │  └─ BidList.vue          # 只顯示目前最高價（可選歷史）
│  │  └─ CowTrade/
│  │     ├─ CowTargetPicker.vue  # 挑對手（僅列出有動物者）
│  │     ├─ CowAnimalPicker.vue  # 挑對手擁有的動物種類（未被鎖）
│  │     └─ CowConfirmBar.vue    # 秘密出錢提交（只傳 Host）
│  ├─ store/
│  │  ├─ game.ts                  # 回合、驢子發錢、計分、終局
│  │  ├─ auction.ts               # bidding/closing/settlement
│  │  └─ cow.ts                   # select/commit/reveal/settlement
│  ├─ services/
│  │  ├─ rules.ts                 # 常數：SET_SIZE/分數/驢子發錢/面額等
│  │  ├─ broadcast.ts             # Ably 抽象 IBroadcast（publish/subscribe/presence）
│  │  └─ host-election.ts         # Host 選定/遷移（playerId 最小者）
│  ├─ networking/
│  │  ├─ ablyClient.ts            # Ably 初始化、channel 工廠、presence
│  │  └─ protocol.ts              # 封包 Envelope、type 常數、schemaVersion
│  ├─ types/
│  │  └─ game.ts                  # 全域 Type（見下節）
│  ├─ composables/
│  │  ├─ usePhaseGuard.ts         # 依 phase 控制可用操作（含權限矩陣）
│  │  ├─ useAuctionViewRole.ts    # 是否主持人
│  │  ├─ useMoneySelection.ts     # MoneyPad 本地暫存（送出前不動真資產）
│  │  └─ useLog.ts                # 記錄/格式化事件 Log
│  ├─ utils/
│  │  ├─ id.ts                    # uuid/nanoid
│  │  └─ math.ts                  # 合計/比較輔助
│  └─ data/
│     └─ deck.json                # （可選）定義每動物 4 張的來源資料
├─ tsconfig.json
├─ tsconfig.node.json
├─ package.json
├─ vite.config.ts                 # 或 + vitest.config.ts（見第12節）
├─ .eslintrc.cjs
├─ .prettierrc
├─ .env.example
└─ .gitignore
```

---

## 2) 資料型態（Types）— `src/types/game.ts`

> 不可擅自擴充未列於此的型別；必要變更需先更新本 README。

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

### `store/game.ts`

* **State**：`phase, players, deck, discard, turnOwnerId, donkeyDrawCount, log, stateVersion`
* **Getters**

  * `activePlayer()`
  * `playerById(id)`
  * `remainingAuctionableAnimals()`
  * `canChooseAuction()`（第一回合 or 牌庫判斷）
  * `canChooseCowTrade()`（當前玩家是否有錢）
  * `isAnimalLocked(animal)`（任一玩家達成 4 張）
* **Actions**

  * `setupGame(players: Array<{id:string; name:string}>)`

    * 若 `src/data/deck.json` 不存在：Host 以 `Animal` 全列表與 `Rules.SET_SIZE` 生成「**每種動物各 4 張**」，使用 Fisher–Yates 洗牌；**洗後牌序以 Host 快照為準**（Client 不自行洗牌）。
  * `startTurn()` → `phase='turn.choice'`
  * `drawCardForAuction(): Card`
  * `grantDonkeyPayout()`
  * `rotateTurn()`
  * `computeFinalScores(): Array<{playerId:string; score:number}>`
  * `checkEndAndMaybeFinish()`
  * `appendLog(msg: string)`

### `store/auction.ts`

* **State**：`auction: AuctionState | null`
* **Getters**：`canAuctioneerBuyback()`
* **Actions**

  * `enterBidding()`
  * `placeBid(playerId, moneyCardIds, actionId)`
  * `passBid(playerId)`
  * `hostAward()`
  * `hostBuyback()`
  * `settle(mode: 'award'|'buyback')` → 轉移資產、`phase='turn.end'`

### `store/cow.ts`

* **State**：`cow: CowTradeState | null`
* **Actions**

  * `selectTarget(targetPlayerId)`
  * `selectAnimal(animal)`
  * `commitSecret(playerId, moneyCardIds)`（僅送 Host）
  * `revealAndResolve()`（平手不交換；否則勝者拿 1/2 張，互換提交錢卡）

> 原則：**資產真正移轉**只在 `auction.settlement`、`cow.revealAndResolve()` 執行。

---

## 4) 儲存（Persistence）

* **Host 端**：`localStorage['game:{roomId}'] = GameState`（含 `stateVersion`）。
  Cow Trade 的 `secret` **不可持久化**（僅記憶體）。
* **Client 端**：`localStorage['session:{roomId}:{playerId}'] = { stateVersion, playerId }`
* **重連恢復**：Client 加入後等待 Host 廣播 `state.update`；必要時可送 `system.requestState`（可選）
* **Schema 管理**：`networking/protocol.ts` 維護 `schemaVersion`，做必要向後相容或清除舊存檔。
* **Action 去重緩衝**：Host 端維持最近 **N=500** 筆 `actionId` 去重紀錄於記憶體；（選）可同步保留到 `localStorage['dedup:{roomId}']` 以抵抗 Host reload。

---

## 5) 元件 / Service 介面（Interfaces）

### 元件與事件

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

* `BidList.vue`（**補強**）

  * props：`highest?: Bid`, `showHistory?: boolean`（預設 false）
  * emits：無

* `Hud.vue`（**補強**）

  * props：`players: Player[]`, `turnOwnerId: string`, `deckCount: number`, `phase: Phase`, `log: string[]`
  * emits：無（或 `show-log-history()` 視需要）

* `CowTargetPicker.vue`

  * props：`candidates: Player[]`（僅有動物者）
  * emits：`select-target(playerId)`

* `CowAnimalPicker.vue`

  * props：`target: Player`, `locked: Record<Animal, boolean>`
  * emits：`select-animal(animal)`

* `CowConfirmBar.vue`

  * emits：`commit-secret(moneyCardIds: string[])`

### Composables（選要點）

* `usePhaseGuard` → `isActionAllowed(action: string): boolean`（**見第 7 節權限矩陣**）
* `useAuctionViewRole` → `isHost(myId: string): boolean`
* `useMoneySelection` → `selectedIds[]`, `toggle()`, `clear()`, `total()`
* `useLog` → `push(msg: string)`

### Services

* `services/rules.ts`：輸出常數（見第 8 節）

* `services/broadcast.ts`

  ```ts
  export interface IBroadcast {
    publish<T>(topic: string, payload: T): Promise<void>;
    subscribe<T>(topic: string, handler: (payload: T) => void): () => void;
    presence(): {
      // **規範：presence 的 clientId 必須等於 playerId**
      // 若底層（如 Ably）clientId 與我們的 playerId 不同，則 data.playerId 必須存在且等同 playerId。
      enter(meta: { playerId: string; name: string }): Promise<void>;
      leave(): Promise<void>;
      getMembers(): Promise<Array<{ id: string; data: { playerId: string; name: string } }>>;
    };
  }
  ```

* `services/host-election.ts`

  * `getHostId(members: Array<{id: string}>): string` // 取 **字典序最小** playerId
  * `shouldReelect(oldHostId: string, members: string[]): boolean`

---

## 6) 通訊協定（Ably / Host Authority）

* **Host Authority**：`playerId` 字典序最小者為 Host；掉線即依序移轉。
* **每次事件** → Host 驗證 → **廣播完整快照** `state.update`（含 `stateVersion`）。
* **同時出價**：以 Host 接收 `ts` 排序；同額先到先贏。
* **去重**：所有 `action.*` 必帶 `actionId`（uuid）。

### Channel

* `game-{roomId}`（單一頻道，≤5 人）

### 封包 Envelope — `networking/protocol.ts`

```ts
export interface Envelope<T = any> {
  type: string;             // 參見 Msg 常數（下方）
  roomId: string;
  senderId: string;         // playerId
  actionId?: string;        // 僅 action.*
  stateVersion?: number;    // 僅 state.update
  ts: number;               // Host 接收/廣播時間（毫秒）
  payload: T;
  schemaVersion: number;    // 例如 1
}
```

### **訊息 type 常數（**避免手滑字串**）**

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

### Actions（Client → Host）

```ts
type ActionPlaceBid       = { playerId: string; moneyCardIds: string[] };
type ActionPassBid        = { playerId: string };
type ActionChooseAuction  = { playerId: string };
type ActionChooseCowTrade = { playerId: string };
type ActionSelectCowTarget= { playerId: string; targetId: string };
type ActionSelectCowAnimal= { playerId: string; animal: Animal };
type ActionCommitCowTrade = { playerId: string; moneyCardIds: string[] }; // 僅 Host 可見
type ActionHostAward      = { playerId: string }; // 主持人
type ActionHostBuyback    = { playerId: string }; // 主持人
```

### State（Host → All）

```ts
type StateUpdate = { state: GameState }; // 每次完整快照
```

### System / Presence

```ts
type SystemJoin         = { playerId: string; name: string };
type SystemLeave        = { playerId: string };
type SystemHostChanged  = { newHostId: string };
type SystemRequestState = { requesterId: string }; // 可選
```

### Host 遷移

1. Presence 偵測舊 Host 離線
2. 以剩餘玩家 **playerId 字典序最小者** 接任
3. 廣播 `system.hostChanged` → 新 Host 立即廣播最新 `state.update`

### Cow Trade 秘密

* `action.commitCowTrade` 僅送 Host；Reveal 後由 Host 廣播結果。

---

## 7) 邏輯邊界與 UX 規則（Business Rules）

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

**Cow Trade**

* 每回合僅能發起一次；完成即結束回合
* 只能挑「有動物」的玩家（不論是否有錢）
* 只能選對手持有且未被鎖（已有玩家集滿 4 張即鎖）的動物
* 秘密出錢：雙方提交錢卡，不可撤回，僅 Host 知
* 平手：不交換動物、不交換錢卡 → 直接結束回合
* 結算：雙方該動物各 ≥2 → 勝者拿 2 張；否則拿 1 張；雙方互換提交錢卡

**終局與計分**

* 終局：所有動物種類至少有一位玩家集滿 4 張
* 分數表：雞10、鵝40、貓90、狗160、羊250、蛇350、驢500、豬650、牛800、馬1000
* 玩家總分 =（自有動物分值總和）×（完成的 4 張組數總和）

### **權限矩陣（供 `usePhaseGuard` 與測試對照）**

| Phase                | 允許的 Action                                     | 限制條件                                         |
| -------------------- | ---------------------------------------------- | -------------------------------------------- |
| `turn.choice`        | `CHOOSE_AUCTION`、`CHOOSE_COW_TRADE`            | `canChooseAuction()` / `canChooseCowTrade()` |
| `auction.bidding`    | `PLACE_BID`（可多次）、`PASS_BID`                    | 沒錢禁用；主持人可出價但不可 `PASS_BID`                    |
| `auction.closing`    | `HOST_AWARD`、`HOST_BUYBACK`                    | `canAuctioneerBuyback()` 為 true 才能買回         |
| `auction.settlement` | （系統內部結算）                                       | 無                                            |
| `cow.selectTarget`   | `SELECT_TARGET`                                | 目標玩家必須「有動物」                                  |
| `cow.selectAnimal`   | `SELECT_ANIMAL`                                | 該動物未被鎖（有人已集滿 4 張即鎖）                          |
| `cow.commit`         | `COMMIT_COW_TRADE`（雙方各一次、不可撤）                  | 僅發起者與目標可提交                                   |
| `cow.reveal`         | `REVEAL_AND_RESOLVE`（Host 觸發）                  | 雙方皆已提交                                       |
| `cow.settlement`     | （系統內部結算）                                       | 無                                            |
| `turn.end`           | （系統）`isEndGame` → `game.end`；否則回 `turn.choice` | 無                                            |
| `game.end`           | （結束）                                           | 無                                            |

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

### Vite

**單檔**：`vite.config.ts` 用 `vitest/config` 的 `defineConfig`，可含 `test`

#### `vite.config.ts`

```ts
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

### ESLint / Prettier

`.eslintrc.cjs`

```js
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', extraFileExtensions: ['.vue'] },
  extends: ['plugin:vue/vue3-recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  },
  ignorePatterns: ['dist', 'node_modules']
};
```

`.prettierrc`

```json
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
3. **Phase 2**：Ably（Host Authority、presence、完整快照 state.update、actionId 去重、stateVersion）
4. **Phase 3**：Auction 買回 + guard；平手先到先贏（ts）
5. **Phase 4**：Cow Trade（select/commit/reveal/settlement；秘密只給 Host）
6. **Phase 5**：韌性/UX（斷線恢復、禁用邏輯、log 強化）
7. **Phase 6**：測試加強（stores + 協定）、Host 遷移保底、行動版 UI

---

## 10) 驗收與測試（Acceptance & Tests）

* 驢子連抽：按第 1\~4 張正確發錢，仍進拍賣
* 拍賣無人出價：主持人直接拿牌
* 出價平手：先到先贏（不覆蓋既有最高）
* 買回資金不足：按鈕禁用
* 第一回合：Cow Trade 禁用
* Cow Trade：對手需有動物；被鎖動物不可選
* Cow Trade 平手：不交換動物與錢卡
* Cow Trade 結算：雙方各 ≥2 → 2 張；否則 1 張；互換提交錢卡
* 終局與計分正確
* Ably：action.\* → Host 驗證 → state.update（完整快照）；重連拿到最新快照
* Host 遷移：舊 Host 離線 → 最小 playerId 接任並廣播
* **序列化**：`AuctionState.passes` 為 `string[]`，在 Host 與 Client 的持久化與快照中保持一致
* **去重緩衝**：連續重送相同 `actionId` 不應造成副作用

---

## 11) 狀態機圖（Mermaid）

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

## 12) 疑難排解：Vite `test` 設定錯誤修復

> 把 `vitest` 的 `test` 設定放在 `vite.config.ts`，務必 `import { defineConfig } from 'vitest/config'`；

---

**到此為止，這份 README 已整合：**

* `AuctionState.passes` 可序列化化（`string[]`）
* 訊息 `type` 常數表（`Msg`）
* Presence 與 Host 選舉的 ID 對齊規範
* `usePhaseGuard` 權限矩陣
* `Hud.vue`、`BidList.vue` 明確介面
* 牌庫生成與 Host 快照為準的規範
* `actionId` 去重緩衝策略

準備好之後，直接丟我檔名，我就能照這份 README 產出完整程式碼。
