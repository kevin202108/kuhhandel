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

    <!-- Setup / Lobby -->
    <section v-if="phase === 'setup'" class="view setup">
      <SetupLobby @start-game="startGame" />
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

    <!-- Auction -->
    <AuctionFlow
      v-else-if="isAuctionPhase"
      :phase="phase"
      @place-bid="onPlaceBid"
      @pass-bid="onPassBid"
      @award="onHostAward"
      @buyback="onHostBuyback"
      @confirm-buyback="onConfirmBuyback"
      @cancel-buyback="onCancelBuyback"
    />

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
      @counter-cancel="onCowCounterCancel"
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

  </div>
  
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Hud from '@/components/Hud.vue';
import TurnChoice from '@/components/TurnChoice.vue';
import AuctionFlow from '@/components/Auction/AuctionFlow.vue';
import CowTrade from '@/components/CowTrade/CowTrade.vue';
import SetupLobby from '@/components/Setup/SetupLobby.vue';

import { useGameStore } from '@/store/game';
import { useCowStore } from '@/store/cow';
import broadcast from '@/services/broadcast';
import { Msg } from '@/networking/protocol';
import type { Phase, Player } from '@/types/game';
import { newId } from '@/utils/id';

const game = useGameStore();

// Identity used across views
const myId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '');

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

// Setup/Lobby presence handling moved into SetupLobby

// Auction-specific UI behaviors moved into AuctionFlow

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
// Auction-specific derived state now lives in AuctionFlow

// 階段分組判斷
const isAuctionPhase = computed(() => phase.value.startsWith('auction.'));
const isCowTradePhase = computed(() => phase.value.startsWith('cow.'));
const finalScores = computed(() => game.computeFinalScores());

// Auction buyback selection now handled by AuctionFlow

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
    currentPhase: phase.value
  });
  void broadcast.publish(Msg.Action.HostBuyback, { playerId: myId_local });
}

function resetToSetup() {
  // Simple reset: reload the page
  window.location.reload();
}

function onConfirmBuyback(moneyCardIds: string[]) {
  void broadcast.publish(Msg.Action.ConfirmBuyback, {
    playerId: myId,
    moneyCardIds,
  });
}

function onCancelBuyback() {
  void broadcast.publish(Msg.Action.CancelBuyback, { playerId: myId });
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

function onCowCounterCancel() {
  console.log('[DEBUG] onCowCounterCancel called', {
    currentPhase: game.phase,
    myId
  });

  const myId_local = myId;
  void broadcast.publish(Msg.Action.CancelCowCounter, {
    playerId: myId_local
  }, { actionId: newId() });

  console.log('[DEBUG] onCowCounterCancel broadcast published');
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

/* setup-specific styles moved to SetupLobby.vue */

.actions {
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

.scores {
  margin: 8px 0 0;
  padding: 0 0 0 18px;
}
/* setup list styles moved to SetupLobby.vue */
.muted { color: #6b7280; font-size: 12px; }

/* Auction styles moved to AuctionFlow.vue */

</style>


<style scoped>.banner{margin:8px 16px;padding:8px 12px;border-radius:8px;background:#fff3cd;border:1px solid #ffecb5;color:#7a5d00;font-weight:600}</style>
