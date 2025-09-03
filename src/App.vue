<template>
  <div class="app">
    <!-- Header / HUD -->
    <header class="app__header" v-if="phase !== 'setup'">
      <Hud
        :players="players"
        :turnOwnerId="game.turnOwnerId"
        :deckCount="deckCount"
        :phase="phase"
        :log="game.log"
      />
    </header>

    <!-- Setup Screen -->
    <section v-if="phase === 'setup'" class="view setup">
      <h1>Multiplayer Auction + Cow Trade</h1>
      <p class="sub">Phase 1：本地單機拍賣 MVP</p>

      <div class="players-setup">
        <h2>玩家名單</h2>
        <div class="player-row" v-for="(p, i) in playerInputs" :key="p.localId">
          <input
            v-model.trim="p.name"
            :placeholder="`玩家 ${i + 1} 名稱`"
            maxlength="16"
          />
          <button class="ghost" @click="removePlayer(i)" :disabled="playerInputs.length <= 2">刪除</button>
        </div>

        <div class="setup-actions">
          <button class="secondary" @click="addPlayer" :disabled="playerInputs.length >= 5">＋ 新增玩家</button>
          <button class="primary" @click="startGame" :disabled="!canStartGame">開始遊戲</button>
        </div>
        <p class="hint">* 2–5 位玩家。開始後可從畫面上方 HUD 查看回合玩家與牌庫剩餘。</p>
      </div>
    </section>

    <!-- Turn Choice -->
    <section v-else-if="phase === 'turn.choice'" class="view turn-choice">
      <div class="panel">
        <h2>回合選擇（{{ activePlayer?.name }}）</h2>
        <TurnChoice
          :canAuction="game.canChooseAuction"
          :canCowTrade="game.canChooseCowTrade"
          :isFirstRound="isFirstRound"
          @choose-auction="onChooseAuction"
          @choose-cow-trade="onChooseCowTrade"
        />
      </div>
    </section>

    <!-- Auction: Bidding -->
    <section v-else-if="phase === 'auction.bidding'" class="view auction">
      <h2>拍賣進行中</h2>
      <div class="auction-grid">
        <div
          v-for="p in players"
          :key="p.id"
          class="auction-col"
        >
          <!-- Host / Auctioneer -->
          <AuctionHostView
            v-if="p.id === auctioneerId"
            :highest="auction.auction?.highest"
            :canBuyback="canBuyback"
            @award="onHostAward"
            @buyback="onHostBuyback"
          />
          <!-- Bidders -->
          <AuctionBidderView
            v-else
            :self="p"
            :highest="auction.auction?.highest"
            @place-bid="(ids:string[]) => onPlaceBid(p.id, ids)"
            @pass="() => onPassBid(p.id)"
          />
        </div>
      </div>
    </section>

    <!-- Auction: Closing（所有人 Pass 後由主持人結標） -->
    <section v-else-if="phase === 'auction.closing'" class="view auction">
      <h2>拍賣結標</h2>
      <div class="panel">
        <AuctionHostView
          :highest="auction.auction?.highest"
          :canBuyback="canBuyback"
          @award="onHostAward"
          @buyback="onHostBuyback"
        />
      </div>
    </section>

    <!-- Turn End -->
    <section v-else-if="phase === 'turn.end'" class="view turn-end">
      <div class="panel">
        <h2>回合結束</h2>
        <p>下一位玩家：<strong>{{ nextPlayerName }}</strong></p>
        <div class="actions">
          <button class="primary" @click="nextTurn">開始下一回合</button>
        </div>
      </div>
    </section>

    <!-- Game End -->
    <section v-else-if="phase === 'game.end'" class="view game-end">
      <div class="panel">
        <h2>遊戲結束</h2>
        <ol class="scores">
          <li v-for="s in finalScores" :key="s.playerId">
            <strong>{{ nameOf(s.playerId) }}</strong>：{{ s.score }}
          </li>
        </ol>
        <div class="actions">
          <button class="secondary" @click="resetToSetup">重新開始</button>
        </div>
      </div>
    </section>

    <!-- Fallback -->
    <section v-else class="view">
      <p>未知的階段：{{ phase }}</p>
    </section>

    <div class="panel">
      <button class="secondary" @click="endNowForDev">Dev：直接結束並計分</button>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import Hud from '@/components/Hud.vue';
import TurnChoice from '@/components/TurnChoice.vue';
import AuctionBidderView from '@/components/Auction/AuctionBidderView.vue';
import AuctionHostView from '@/components/Auction/AuctionHostView.vue';

import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import type { Phase, Player } from '@/types/game';
import { newId } from '@/utils/id';

const game = useGameStore();
const auction = useAuctionStore();

/** --------------------------
 * Setup：建立玩家清單
 * -------------------------- */
type PlayerInput = { localId: string; name: string };
const playerInputs = reactive<PlayerInput[]>([
  { localId: newId(), name: 'Alice' },
  { localId: newId(), name: 'Bob' }
]);

const canStartGame = computed(() => {
  const names = playerInputs.map(p => p.name.trim()).filter(Boolean);
  // 不重名、2~5人
  const unique = new Set(names);
  return names.length >= 2 && names.length <= 5 && unique.size === names.length;
});

function addPlayer() {
  if (playerInputs.length >= 5) return;
  playerInputs.push({ localId: newId(), name: `P${playerInputs.length + 1}` });
}
function removePlayer(idx: number) {
  if (playerInputs.length <= 2) return;
  playerInputs.splice(idx, 1);
}
function startGame() {
  const players = playerInputs.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name.trim() || `P${i + 1}`
  }));
  game.setupGame(players);
  game.startTurn();
}

/** --------------------------
 * 讀取狀態與衍生資料
 * -------------------------- */
const phase = computed<Phase>(() => game.phase);
const players = computed<Player[]>(() => game.players);
const deckCount = computed(() => game.deck.length);
const activePlayer = computed<Player | undefined>(() => game.activePlayer);
const isFirstRound = computed(() => {
  // 全員動物數都為 0
  return players.value.every(p => {
    const counts = Object.values(p.animals || {});
    return counts.reduce((a, b) => a + (b || 0), 0) === 0;
  });
});
const auctioneerId = computed(() => auction.auction?.auctioneerId ?? game.turnOwnerId);
const canBuyback = computed(() => auction.canAuctioneerBuyback);
const nextPlayerName = computed(() => {
  const nowIdx = players.value.findIndex(p => p.id === game.turnOwnerId);
  const next = players.value[(nowIdx + 1) % players.value.length];
  return next?.name ?? '';
});
const finalScores = computed(() => game.computeFinalScores());

function nameOf(id: string) {
  return players.value.find(p => p.id === id)?.name ?? id;
}

/** --------------------------
 * 事件處理
 * -------------------------- */
function onChooseAuction() {
  // 由 auction store 自行抽牌與進入 bidding（或內部呼叫 game.drawCardForAuction）
  auction.enterBidding();
}

function onChooseCowTrade() {
  // Phase 1 尚未實作 Cow Trade：寫一則 Log 並保持在 turn.choice
  game.appendLog('Cow Trade 將在之後的 Phase 實作，目前僅支援 Auction。');
}

function onPlaceBid(playerId: string, moneyCardIds: string[]) {
  auction.placeBid(playerId, moneyCardIds, newId());
}

function onPassBid(playerId: string) {
  auction.passBid(playerId);
}

function onHostAward() {
  // 依 README：主持人結標 → 進入結算流程，由 store 轉 `phase='turn.end'`
  auction.hostAward();
}

function onHostBuyback() {
  // Phase 1 不實作買回；Phase 3 再接上 store action
  game.appendLog('（提示）買回功能將在 Phase 3 實作，目前僅支援得標流程。');
}

function nextTurn() {
  // 嘗試進入終局；否則輪轉回合並開始下一輪
  game.checkEndAndMaybeFinish();
  if (game.phase !== 'game.end') {
    game.rotateTurn();
    game.startTurn();
  }
}

function resetToSetup() {
  // 簡單作法：重新整個頁面或提供 game.reset()（若你有實作 reset 可改用）
  window.location.reload();
}

function endNowForDev() {
  // 僅開發用：不改規則，只是把結果顯示出來
  game.computeFinalScores(); // 若你的實作需要先計算可先存到 store
  game.phase = 'game.end' as any;
}

</script>

<style scoped>
.app {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
  background: #0b1020;
  color: #e7e9ee;
}
.app__header {
  padding: 12px 16px;
  border-bottom: 1px solid #24304a;
  background: #0d1326;
}
.view {
  padding: 16px;
  max-width: 1080px;
  margin: 0 auto;
}
h1, h2 { margin: 0 0 12px; }
.sub { opacity: 0.8; margin-bottom: 16px; }

.panel {
  background: #121a33;
  border: 1px solid #223055;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
}

.players-setup .player-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
}
.players-setup input {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #2a3b66;
  background: #0f1630;
  color: #e7e9ee;
}

.setup-actions, .actions {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

button {
  appearance: none;
  border: 1px solid #35508a;
  background: #1a2748;
  color: #e7e9ee;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
}
button.primary { background: #2a5ad1; border-color: #2a5ad1; }
button.secondary { background: #203258; }
button.ghost { background: transparent; }

button:disabled { opacity: .5; cursor: not-allowed; }

.auction-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.auction-col { min-width: 0; }

.scores {
  margin: 8px 0 0;
  padding: 0 0 0 18px;
}
.hint { opacity: .75; margin-top: 4px; font-size: 12px; }
</style>
