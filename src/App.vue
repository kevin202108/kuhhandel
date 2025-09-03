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
      <p class="sub">Phase 2：多人同步（Ably + Host Authority）</p>

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
            @place-bid="(ids: string[]) => onPlaceBid(p.id, ids)"
            @pass="() => onPassBid(p.id)"
          />
        </div>
      </div>
    </section>

    <!-- Auction: Closing -->
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
          <!-- 註：此按鈕仍走本地 store 的流程（SSoT 尚無 NEXT_TURN 訊息類型）。
               若你想完全走 dispatch，可在協定新增 system.nextTurn。 -->
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
      <small>目前身分：{{ me.name }}（{{ me.playerId }}） <span v-if="isHost">｜Host</span></small>
      <div style="margin-top:8px">
        <button class="secondary" @click="endNowForDev">Dev：直接結束並計分</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, onMounted, onBeforeUnmount } from 'vue';
import Hud from '@/components/Hud.vue';
import TurnChoice from '@/components/TurnChoice.vue';
import AuctionBidderView from '@/components/Auction/AuctionBidderView.vue';
import AuctionHostView from '@/components/Auction/AuctionHostView.vue';

import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import type { Phase, Player } from '@/types/game';
import { newId } from '@/utils/id';

/** Phase 2：實時層 */
import { useRealtimeGame } from '@/composables/useRealtimeGame';
import { Msg } from '@/networking/protocol';
import { createAblyClient } from '@/networking/ablyClient';
import { createAblyBroadcast } from '@/services/broadcast';

const game = useGameStore();
const auction = useAuctionStore();

/** --------------------------
 * 連線與身分
 * -------------------------- */
const qs = new URLSearchParams(window.location.search);
const roomId = qs.get('room') ?? 'dev-room';
const storedId = localStorage.getItem('playerId') ?? `p-${newId()}`;
localStorage.setItem('playerId', storedId);
const storedName = localStorage.getItem('playerName') ?? 'Player';
localStorage.setItem('playerName', storedName);

const me = reactive<{ playerId: string; name: string }>({
  playerId: storedId,
  name: storedName
});

// Ably Client & IBroadcast factory（符合 README 的抽象）
const apiKey = (import.meta.env.VITE_ABLY_API_KEY ?? '') as string;
const appName = (import.meta.env.VITE_APP_NAME ?? 'MyVueGame') as string;
const ably = createAblyClient({ apiKey, appName }, me.playerId);
const busFactory = (rid: string) => createAblyBroadcast(ably.getChannel(`game-${rid}`));

const { connect, disconnect, dispatch, isHost } = useRealtimeGame(roomId, me, busFactory);

onMounted(async () => {
  await connect();
});
onBeforeUnmount(async () => {
  await disconnect();
});

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
  // 註：setupGame/startTurn 仍為本地 Host 初始化流程（協定無對應 action）
  const players = playerInputs.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name.trim() || `P${i + 1}`
  }));
  game.setupGame(players);
  game.startTurn();
}

/** --------------------------
 * 讀取狀態與衍生資料（來自 stores；快照由 Host 廣播）
 * -------------------------- */
const phase = computed<Phase>(() => game.phase);
const players = computed<Player[]>(() => game.players);
const deckCount = computed(() => game.deck.length);
const activePlayer = computed<Player | undefined>(() => game.activePlayer);
const isFirstRound = computed(() => {
  return players.value.every(p => {
    const counts = Object.values(p.animals || {});
    return counts.reduce((a, b) => a + (b ?? 0), 0) === 0;
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
 * 事件處理（改為 dispatch）
 * -------------------------- */
function onChooseAuction() {
  void dispatch(Msg.Action.ChooseAuction, { playerId: me.playerId });
}
function onChooseCowTrade() {
  // Phase 4 才有完整流程，這裡先把選擇同步出去（Host 可忽略或回 log）
  void dispatch(Msg.Action.ChooseCowTrade, { playerId: me.playerId });
}
function onPlaceBid(playerId: string, moneyCardIds: string[]) {
  void dispatch(Msg.Action.PlaceBid, { playerId, moneyCardIds });
}
function onPassBid(playerId: string) {
  void dispatch(Msg.Action.PassBid, { playerId });
}
function onHostAward() {
  void dispatch(Msg.Action.HostAward, { playerId: me.playerId });
}
function onHostBuyback() {
  // Phase 3 才會在 Host reducers 實作；先行派送不會出錯（Host 可忽略）
  void dispatch(Msg.Action.HostBuyback, { playerId: me.playerId });
}

/** 下一回合（仍走本地 reducers；如要 100% 網路化，需在協定新增 system.nextTurn） */
function nextTurn() {
  game.checkEndAndMaybeFinish();
  if (game.phase !== 'game.end') {
    game.rotateTurn();
    game.startTurn();
  }
}

function resetToSetup() {
  window.location.reload();
}

/** Dev：直接結束（避免 any，使用明確型別） */
function endNowForDev() {
  // 僅在本地快速查看結算畫面；不經過網路層
  game.computeFinalScores();
  game.$patch({ phase: 'game.end' as Phase });
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
