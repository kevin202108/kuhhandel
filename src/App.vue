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
    <div v-if="hostChangedMsg" class="banner">{{ hostChangedMsg }}</div>

    <!-- Setup Screen (NameEntry / Lobby) -->
    <section v-if="phase === 'setup'" class="view setup">
      <h1>Multiplayer Auction + Cow Trade</h1>
      <p class="sub">Phase 2: Ably Multiplayer MVP</p>

      <!-- NameEntry when no ?player= given -->
      <div v-if="!myId" class="panel">
        <h2>Enter Your Name</h2>
        <div class="players-setup">
          <div class="player-row">
            <input v-model.trim="nameInput" placeholder="your-name (a-z0-9_-)" maxlength="16" />
            <button class="primary" :disabled="!canJoin" @click="joinRoom">Join</button>
          </div>
          <p class="hint">Adds ?player= to URL and reloads, then presence joins automatically.</p>
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
      <h2>Auction: Bidding</h2>
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
            v-else-if="p.id === myId"
            :self="p"
            :highest="auction.auction?.highest"
            @place-bid="(ids:string[]) => onPlaceBid(p.id, ids)"
            @pass="() => onPassBid(p.id)"
          />
          <div v-else class="panel compact-bidder">
            <strong>{{ p.name }}</strong>
            <div class="muted">Bidding...</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Auction: Closing -->
    <section v-else-if="phase === 'auction.closing'" class="view auction">
      <h2>Auction: Closing</h2>
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
        <h2>Turn End</h2>
        <p>Next player: <strong>{{ nextPlayerName }}</strong></p>
        <div class="actions">
          <button class="primary" @click="nextTurn">Next Turn</button>
        </div>
      </div>
    </section>

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

import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import broadcast from '@/services/broadcast';
import { Msg } from '@/networking/protocol';
import type { Phase, Player } from '@/types/game';
import { newId } from '@/utils/id';

const game = useGameStore();
const auction = useAuctionStore();

// Presence helpers (Phase 2)
const url = new URL(location.href);
const myId = (url.searchParams.get('player') ?? '').toLowerCase().trim();
const roomId = (url.searchParams.get('room') ?? 'dev').toLowerCase().trim();
type Member = { id: string; data?: { playerId: string; name: string } };
const members = ref<Member[]>([]);
async function refreshPresence() {
  try { members.value = await broadcast.presence().getMembers(); } catch { /* ignore */ }
}
const hostIdLabel = computed(() => game.hostId || members.value.map(m => m.id).sort()[0] || '');

// NameEntry data
const nameInput = ref('');
const ID_RE = /^[a-z0-9_-]{1,24}$/;
const canJoin = computed(() => ID_RE.test(nameInput.value.trim().toLowerCase()));
function joinRoom() {
  if (!canJoin.value) return;
  const n = nameInput.value.trim().toLowerCase();
  const next = new URL(location.href);
  next.searchParams.set('player', n);
  location.href = next.toString();
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

/** --------------------------
 * Setup: Start game (host-only, uses presence)
 * -------------------------- */
function startGame() {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  void broadcast.publish(Msg.Action.StartGame, { playerId: myId });
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
 * Event handlers
 * -------------------------- */
function onChooseAuction() {
  // Route via Ably to host
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  void broadcast.publish(Msg.Action.ChooseAuction, { playerId: myId });
}

function onChooseCowTrade() {
  // Not implemented in Phase 2
  game.appendLog('Cow Trade will be implemented in a later phase; use Auction for now.');
}

function onPlaceBid(playerId: string, moneyCardIds: string[]) {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  void broadcast.publish(Msg.Action.PlaceBid, { playerId: myId, moneyCardIds }, { actionId: newId() });
}

function onPassBid(playerId: string) {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  void broadcast.publish(Msg.Action.PassBid, { playerId: myId });
}

function onHostAward() {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  void broadcast.publish(Msg.Action.HostAward, { playerId: myId });
}

function onHostBuyback() {
  // Not implemented in Phase 2
  game.appendLog('(Dev) Buyback will be implemented in Phase 3; skipping for now.');
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
</style>


<style scoped>.banner{margin:8px 16px;padding:8px 12px;border-radius:8px;background:#fff3cd;border:1px solid #ffecb5;color:#7a5d00;font-weight:600}</style>
