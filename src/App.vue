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
        :lastAwarded="game.lastAwarded"
      />
    </header>
    <div v-if="hostChangedMsg" class="banner">{{ hostChangedMsg }}</div>

    <!-- Setup Screen (NameEntry / Lobby) -->
    <section v-if="phase === 'setup'" class="view setup">
      <h1>幕後交易 KUHHANDEL</h1>

      <!-- NameEntry when displayName is not set -->
      <div v-if="!hasDisplayName" class="panel">
        <h2>Enter Your Display Name</h2>
        <div class="players-setup">
          <SetupForm @confirm="onNameConfirm" />
          <p class="hint">Display name is for UI only (max 12 chars).</p>
        </div>
      </div>

      <!-- Lobby when already joined -->
      <div v-else class="panel">
        <h2>Lobby (room: {{ roomId }})</h2>
        <p class="hint">Host: <code>{{ hostIdLabel }}</code></p>
        <ul class="plist">
          <li v-for="m in members" :key="m.id">
            <strong>{{ m.data?.name || m.id }}</strong> <code>({{ m.id }})</code>
            <span v-if="m.id === hostIdLabel" class="badge">Host</span>
            <span v-if="m.id === myId" class="badge">You</span>
          </li>
        </ul>
        <div class="setup-actions">
          <button class="secondary" @click="refreshPresence">Refresh</button>
          <button class="primary" :disabled="!canStartOnline" @click="startGame">Start Game (Host)</button>
        </div>
        <p class="hint">Requires at least 2 members; only Host can start.</p>
      </div>
    </section>

    <!-- Turn Choice -->
    <section v-else-if="phase === 'turn.choice'" class="view turn-choice">
      <div class="panel">
        <h2>Choose Action ({{ activePlayer?.name }})</h2>
        <div v-if="myId === game.turnOwnerId">
          <TurnChoice
            :canAuction="game.canChooseAuction"
            :canCowTrade="game.canChooseCowTrade"
            :isFirstRound="isFirstRound"
            :isMyTurn="myId === game.turnOwnerId"
            @choose-auction="onChooseAuction"
            @choose-cow-trade="onChooseCowTrade"
          />
        </div>
        <div v-else class="muted">
          Waiting for {{ activePlayer?.name }} to choose…
        </div>
      </div>
    </section>

    <!-- Auction: Bidding -->
    <section v-else-if="phase === 'auction.bidding'" class="view auction">
      <h2>Auction: Bidding</h2>

      <!-- Auctioneer: Fixed prominent display at top -->
      <div class="panel auctioneer-info">
        <div class="auctioneer-header">
          <strong>{{ nameOf(auctioneerId) }}</strong> <span class="auctioneer-badge">拍賣者</span>
        </div>
        <div class="auction-details">
          <div class="animal-display">
            <span class="label">拍賣動物：</span>
            <strong class="animal-name">{{ auctionAnimalName }} <span class="animal-points">{{ auctionAnimalScore }}</span></strong>
          </div>
          <div class="highest-bid">
            <span class="label">目前最高：</span>
            <strong class="highest-amount">{{ game.auction?.highest?.total ?? 0 }}</strong>
            <span v-if="game.auction?.highest" :key="bidderHighlightKey" class="highest-bidder-highlight">
              🚀 <strong>{{ nameOf(game.auction.highest.playerId) }}</strong> 領先中!
            </span>
            <span v-else class="no-bid">無人出價</span>
          </div>
        </div>
      </div>

      <div class="auction-grid">
        <div
          v-for="p in players"
          :key="p.id"
          class="auction-col"
        >
          <AuctionBidderView
            v-if="p.id === myId && myId !== auctioneerId"
            :self="p"
            :highest="game.auction?.highest"
            :nameOf="nameOf"
            @place-bid="(ids:string[]) => onPlaceBid(p.id, ids)"
            @pass="() => onPassBid(p.id)"
          />
        </div>
      </div>
    </section>

    <!-- Auction: Closing -->
    <section v-else-if="phase === 'auction.closing'" class="view auction">
      <h2>Auction: Closing</h2>
      <div v-if="myId === auctioneerId" class="panel">
        <AuctionHostView
          :highest="game.auction?.highest"
          :canBuyback="canBuyback"
          @award="onHostAward"
          @buyback="onHostBuyback"
        />
      </div>
      <div v-else class="panel compact-host">
        <div class="muted">Waiting for host to settle…</div>
        <div>
          Highest: <strong>{{ game.auction?.highest?.total ?? 0 }}</strong>
          <span v-if="game.auction?.highest">
            by <code>{{ game.auction?.highest?.playerId }}</code>
          </span>
        </div>
      </div>
    </section>

    <!-- Auction: Buyback Money Selection -->
    <section v-else-if="phase === 'auction.buyback'" class="view auction">
      <h2>Auction: Buyback</h2>
      <div v-if="myId === auctioneerId" class="panel">
        <div class="buyback-info">
          <p>選擇金錢卡支付 {{ game.auction?.highest?.total }} 以買回 {{ game.auction?.card?.animal }}</p>
          <div class="selected-total">
            已選擇總額：<strong>{{ selectedMoneyTotal }}</strong>
            <span v-if="selectedMoneyTotal < (game.auction?.highest?.total || 0)" class="insufficient">（不足）</span>
          </div>
        </div>

        <MoneyPad
          :moneyCards="auctioneerMoneyCards"
          :selectedIds="selectedMoneyIds"
          @toggle="onToggleMoneyCard"
        />

        <div class="actions">
          <button
            class="primary"
            :disabled="selectedMoneyTotal < (game.auction?.highest?.total || 0)"
            @click="onConfirmBuyback"
          >
            確認買回
          </button>
          <button class="secondary" @click="onCancelBuyback">取消</button>
        </div>
      </div>
      <div v-else class="panel compact-host">
        <div class="muted">Waiting for auctioneer to select money for buyback…</div>
      </div>
    </section>

    <!-- 牛交易階段 -->
    <CowTrade
      v-else-if="isCowTradePhase"
      :phase="phase"
      @target-selected="onCowTargetSelected"
      @animal-selected="onCowAnimalSelected"
      @confirm="onCowConfirm"
      @accept-offer="onCowAcceptOffer"
      @counter-offer="onCowCounterOffer"
      @counter-confirm="onCowCounterConfirm"
      @cancel="onCowCancelled"
    />
    <!-- Turn End -->
    

    <!-- Game End -->
    <section v-else-if="phase === 'game.end'" class="view game-end">
      <div class="panel">
        <h2>Game Over</h2>
        <ol class="scores">
          <li v-for="s in finalScores" :key="s.playerId">
            <strong>{{ nameOf(s.playerId) }}</strong>: {{ s.score }}
          </li>
        </ol>
        <div class="actions">
          <button class="secondary" @click="resetToSetup">Restart</button>
        </div>
      </div>
    </section>

    <!-- Fallback -->
    <section v-else class="view">
      <p>Unknown phase: {{ phase }}</p>
    </section>

    <div class="panel">
      <button class="secondary" @click="endNowForDev">Dev: End Now and Score</button>
    </div>

  </div>
  
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, onUnmounted, watch } from 'vue';
import Hud from '@/components/Hud.vue';
import TurnChoice from '@/components/TurnChoice.vue';
import AuctionBidderView from '@/components/Auction/AuctionBidderView.vue';
import AuctionHostView from '@/components/Auction/AuctionHostView.vue';
import MoneyPad from '@/components/MoneyPad.vue';
import CowTrade from '@/components/CowTrade/CowTrade.vue';
import SetupForm from '@/components/SetupForm.vue';

import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import { useCowStore } from '@/store/cow';
import broadcast from '@/services/broadcast';
import rules from '@/services/rules';
import { Msg } from '@/networking/protocol';
import type { Phase, Player } from '@/types/game';
import { newId } from '@/utils/id';

const game = useGameStore();
const auction = useAuctionStore();

// Presence helpers (Phase 2)
const url = new URL(location.href);
const myId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '');
const roomId = (url.searchParams.get('room') ?? 'dev').toLowerCase().trim();
const hasDisplayName = !!(sessionStorage.getItem('displayName') || '');
type Member = { id: string; data?: { playerId: string; name: string } };
const members = ref<Member[]>([]);
async function refreshPresence() {
  try { members.value = await broadcast.presence().getMembers(); } catch { /* ignore */ }
}
const hostIdLabel = computed(() => game.hostId || members.value.map(m => m.id).sort()[0] || '');

// NameEntry action (store displayName then reload)
function onNameConfirm(name: string) {
  const t = (name || '').trim().slice(0, 12);
  if (!t) return;
  try { sessionStorage.setItem('displayName', t); } catch { /* ignore */ }
  // Reload to let main.ts complete presence enter + join flow
  location.reload();
}

// Start gating (Host only, >=2 members)
const canStartOnline = computed(() => (hostIdLabel.value === myId) && members.value.length >= 2);

// Host change banner
const hostChangedMsg = ref<string | null>(null);
let hostMsgTimer: number | null = null;
watch(() => game.hostId, (newHost, oldHost) => {
  if (oldHost && newHost && newHost !== oldHost) {
    hostChangedMsg.value = `Host changed to ${newHost}`;
    if (hostMsgTimer) window.clearTimeout(hostMsgTimer);
    hostMsgTimer = window.setTimeout(() => { hostChangedMsg.value = null; hostMsgTimer = null; }, 3000);
  }
});

onMounted(() => {
  if (game.phase === 'setup') void refreshPresence();
  const t = window.setInterval(() => { if (game.phase === 'setup') void refreshPresence(); }, 1200);
  (window as any).__presenceTimer = t;
});
onUnmounted(() => {
  const t = (window as any).__presenceTimer as number | undefined;
  if (t) window.clearInterval(t);
});

// 監聽最高出價更新，觸發動畫重新播放
watch(() => game.auction?.highest, (newHighest, oldHighest) => {
  if (newHighest && newHighest !== oldHighest) {
    bidderHighlightKey.value += 1;
  }
}, { deep: true });

/** --------------------------
 * Setup: Start game (host-only, uses presence)
 * -------------------------- */
function startGame() {
  const myId_local = myId;
  void broadcast.publish(Msg.Action.StartGame, { playerId: myId_local });
}

/** --------------------------
 * Derived state
 * -------------------------- */
const phase = computed<Phase>(() => game.phase);
const players = computed<Player[]>(() => game.players);
const deckCount = computed(() => game.deck.length);
const activePlayer = computed<Player | undefined>(() => game.activePlayer);
const isFirstRound = computed(() => {
  // Every player has 0 animals
  return players.value.every(p => {
    const counts = Object.values(p.animals || {});
    return counts.reduce((a, b) => a + (b || 0), 0) === 0;
  });
});
const auctioneerId = computed(() => auction.auction?.auctioneerId ?? game.turnOwnerId);
const canBuyback = computed(() => auction.canAuctioneerBuyback);

// 拍賣動物的顯示內容
const auctionAnimalName = computed(() => {
  const animal = game.auction?.card?.animal;
  return animal ? rules.ANIMAL_NAMES[animal] : '';
});

const auctionAnimalScore = computed(() => {
  const animal = game.auction?.card?.animal;
  return animal ? rules.ANIMAL_SCORES[animal] : 0;
});

// 階段分組判斷
const isCowTradePhase = computed(() => phase.value.startsWith('cow.'));
const nextPlayerName = computed(() => {
  const nowIdx = players.value.findIndex(p => p.id === game.turnOwnerId);
  const next = players.value[(nowIdx + 1) % players.value.length];
  return next?.name ?? '';
});
const finalScores = computed(() => game.computeFinalScores());

// Buyback related state and computed properties
const auctioneerMoneyCards = computed(() => {
  const auctioneer = players.value.find(p => p.id === auctioneerId.value);
  return auctioneer?.moneyCards || [];
});

const selectedMoneyIds = ref<string[]>([]);

const selectedMoneyTotal = computed(() => {
  return selectedMoneyIds.value.reduce((sum, id) => {
    const card = auctioneerMoneyCards.value.find(c => c.id === id);
    return sum + (card?.value || 0);
  }, 0);
});

// 動畫鍵值，用於在最高出價更新時重新觸發動畫
const bidderHighlightKey = ref(0);

function nameOf(id: string) {
  return players.value.find(p => p.id === id)?.name ?? id;
}

/** --------------------------
 * Event handlers
 * -------------------------- */
function onChooseAuction() {
  // Route via Ably to host
  const myId_local = myId;
  void broadcast.publish(Msg.Action.ChooseAuction, { playerId: myId_local });
}

function onChooseCowTrade() {
  console.log('[DEBUG] onChooseCowTrade called', {
    currentPhase: game.phase,
    myId
  });

  const myId_local = myId; // needed for closure
  void broadcast.publish(Msg.Action.ChooseCowTrade, {
    playerId: myId_local
  }, { actionId: newId() });

  console.log('[DEBUG] onChooseCowTrade broadcast published');
}

function onPlaceBid(playerId: string, moneyCardIds: string[]) {
  const myId_local = myId;
  void broadcast.publish(Msg.Action.PlaceBid, { playerId: myId_local, moneyCardIds }, { actionId: newId() });
}

function onPassBid(playerId: string) {
  const myId_local = myId;
  void broadcast.publish(Msg.Action.PassBid, { playerId: myId_local });
}

function onHostAward() {
  const myId_local = myId;
  void broadcast.publish(Msg.Action.HostAward, { playerId: myId_local });
}

function onHostBuyback() {
  const myId_local = myId;
  console.log('[DEBUG] onHostBuyback: Initiating buyback', {
    playerId: myId_local,
    currentPhase: phase.value,
    canBuyback: canBuyback.value
  });
  void broadcast.publish(Msg.Action.HostBuyback, { playerId: myId_local });
}

function nextTurn() {
  // Try to finish; else rotate to next player
  game.checkEndAndMaybeFinish();
  if (game.phase !== 'game.end') {
    game.rotateTurn();
    game.startTurn();
  }
}

function resetToSetup() {
  // Simple reset: reload the page
  window.location.reload();
}

function endNowForDev() {
  // Dev helper: compute scores and jump to game end
  game.computeFinalScores();
  game.phase = 'game.end' as any;
}

function onToggleMoneyCard(cardId: string) {
  const index = selectedMoneyIds.value.indexOf(cardId);
  if (index > -1) {
    selectedMoneyIds.value.splice(index, 1);
    console.log('[DEBUG] onToggleMoneyCard: Deselected card', cardId);
  } else {
    selectedMoneyIds.value.push(cardId);
    console.log('[DEBUG] onToggleMoneyCard: Selected card', cardId);
  }
  console.log('[DEBUG] onToggleMoneyCard: Current selection', {
    selectedIds: selectedMoneyIds.value,
    selectedTotal: selectedMoneyTotal.value,
    requiredTotal: game.auction?.highest?.total || 0
  });
}

function onConfirmBuyback() {
  if (selectedMoneyTotal.value < (game.auction?.highest?.total || 0)) {
    console.log('[DEBUG] onConfirmBuyback: Insufficient funds', {
      selectedTotal: selectedMoneyTotal.value,
      requiredTotal: game.auction?.highest?.total || 0
    });
    return;
  }
  console.log('[DEBUG] onConfirmBuyback: Confirming buyback', {
    playerId: myId,
    selectedCardIds: selectedMoneyIds.value,
    selectedTotal: selectedMoneyTotal.value,
    animal: game.auction?.card?.animal,
    highestBid: game.auction?.highest?.total
  });
  void broadcast.publish(Msg.Action.ConfirmBuyback, {
    playerId: myId,
    moneyCardIds: selectedMoneyIds.value
  });
  selectedMoneyIds.value = []; // Reset selection
}

function onCancelBuyback() {
  console.log('[DEBUG] onCancelBuyback: Cancelling buyback', {
    playerId: myId,
    previouslySelectedCards: selectedMoneyIds.value
  });
  void broadcast.publish(Msg.Action.CancelBuyback, { playerId: myId });
  selectedMoneyIds.value = []; // Reset selection
}

// Cow Trade event handlers
function onCowTargetSelected(targetId: string) {
  console.log('[DEBUG] onCowTargetSelected called', {
    targetId,
    currentPhase: game.phase
  });

  const myId_local = myId; // needed for closure
  void broadcast.publish(Msg.Action.SelectCowTarget, {
    playerId: myId_local,
    targetId: targetId
  }, { actionId: newId() });

  console.log('[DEBUG] onCowTargetSelected broadcast published');
}

function onCowAnimalSelected(animal: import('@/types/game').Animal) {
  console.log('[DEBUG] onCowAnimalSelected called', {
    animal,
    currentPhase: game.phase
  });

  const myId_local = myId; // needed for closure
  void broadcast.publish(Msg.Action.SelectCowAnimal, {
    playerId: myId_local,
    animal: animal
  }, { actionId: newId() });

  console.log('[DEBUG] onCowAnimalSelected broadcast published');
}

function onCowConfirm(moneyCardIds: string[]) {
  console.log('[DEBUG] onCowConfirm called', {
    myId,
    moneyCardIds,
    isInitiator: useCowStore().initiatorId === myId,
    targetId: useCowStore().targetPlayerId,
    currentPhase: game.phase
  });

  const myId_local = myId; // needed for closure
  const moneyCardIds_local = moneyCardIds; // needed for closure

  if (useCowStore().initiatorId === myId) {
    void broadcast.publish(Msg.Action.CommitCowTrade, {
      playerId: myId_local,
      moneyCardIds: moneyCardIds_local
    }, { actionId: newId() });
  } else {
    void broadcast.publish(Msg.Action.CommitCowTrade, {
      playerId: myId_local,
      moneyCardIds: moneyCardIds_local
    }, { actionId: newId() });
  }

  console.log('[DEBUG] onCowConfirm broadcast published');
}

function onCowAcceptOffer() {
  console.log('[DEBUG] onCowAcceptOffer called', {
    currentPhase: game.phase,
    myId
  });

  const myId_local = myId;
  void broadcast.publish(Msg.Action.AcceptCowOffer, {
    playerId: myId_local
  }, { actionId: newId() });

  console.log('[DEBUG] onCowAcceptOffer broadcast published');
}

function onCowCounterOffer() {
  console.log('[DEBUG] onCowCounterOffer called', {
    currentPhase: game.phase,
    myId
  });

  const myId_local = myId;
  void broadcast.publish(Msg.Action.CounterCowOffer, {
    playerId: myId_local
  }, { actionId: newId() });

  console.log('[DEBUG] onCowCounterOffer broadcast published');
}

function onCowCounterConfirm(moneyCardIds: string[]) {
  console.log('[DEBUG] onCowCounterConfirm called', {
    moneyCardIds,
    currentPhase: game.phase,
    myId
  });

  const myId_local = myId;
  const moneyCardIds_local = moneyCardIds;
  void broadcast.publish(Msg.Action.CommitCowCounter, {
    playerId: myId_local,
    moneyCardIds: moneyCardIds_local
  }, { actionId: newId() });

  console.log('[DEBUG] onCowCounterConfirm broadcast published');
}

function onCowCancelled() {
  console.log('[DEBUG] onCowCancelled: Sending cancel request', {
    currentPhase: game.phase,
    myId
  });

  // Send CancelBuyback message to host for unified handling
  const myId_local = myId; // needed for closure
  void broadcast.publish(Msg.Action.CancelBuyback, {
    playerId: myId_local
  }, { actionId: newId() });

  console.log('[DEBUG] onCowCancelled broadcast published');
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
.plist {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}
.badge {
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 9999px;
  background: #eef2f7;
  color: #1f2937;
  font-size: 12px;
}
.compact-bidder { padding: 8px; }
.muted { color: #6b7280; font-size: 12px; }

.compact-host { padding: 8px; }

/* Auctioneer Info Panel */
.auctioneer-info {
  background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
  border: 2px solid #60a5fa;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 15px 35px rgba(59, 130, 246, 0.4);
}

.auctioneer-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.auctioneer-badge {
  background: #f59e0b;
  color: #1f2937;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.5);
  animation: pulse 2s infinite;
}

.auction-details {
  display: flex;
  gap: 20px;
  align-items: center;
}

.animal-display,
.animal-score,
.highest-bid {
  display: flex;
  align-items: center;
  gap: 6px;
}

.label {
  color: #93c5fd;
  font-size: 12px;
  font-weight: 600;
}

.animal-name,
.highest-amount {
  color: #ffffff;
  font-size: 18px;
  font-weight: 800;
}

.animal-points {
  color: #fbbf24; /* 金黃色，代表分數 */
  font-size: 18px;
  font-weight: 800;
}

.highest-bidder-highlight {
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  margin-left: 12px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  padding: 4px 12px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
  animation: bounce-in 0.6s ease-out;
}

.highest-bidder-highlight strong {
  color: #ffffff;
  font-size: 18px;
}

.no-bid {
  color: #9ca3af;
  font-size: 14px;
  font-style: italic;
  margin-left: 8px;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.8;
  }
}

@keyframes bounce-in {
  0% {
    transform: scale(0.8);
    opacity: 0;
  }
  50% {
    transform: scale(1.1);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

</style>


<style scoped>.banner{margin:8px 16px;padding:8px 12px;border-radius:8px;background:#fff3cd;border:1px solid #ffecb5;color:#7a5d00;font-weight:600}</style>
