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
            <strong class="animal-name">{{ game.auction?.card?.animal }}</strong>
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
    <!-- Cow Trade: Select Target -->
    <section v-else-if="phase === 'cow.selectTarget'" class="view cow-trade">
      <CowTargetPicker
        :players="players"
        :myId="myId"
        @select-target="onSelectCowTarget"
      />
    </section>

    <!-- Cow Trade: Select Animal -->
    <section v-else-if="phase === 'cow.selectAnimal'" class="view cow-trade">
      <CowAnimalPicker
        :myAnimals="activePlayer?.animals || emptyAnimals"
        @select-animal="onSelectCowAnimal"
      />
    </section>

    <!-- Cow Trade: Commit -->
    <section v-else-if="phase === 'cow.commit'" class="view cow-trade">
      <CowConfirmBar
        :selectedAnimal="game.cow?.targetAnimal || 'chicken'"
        :targetPlayer="players.find(p => p.id === game.cow?.targetPlayerId) || players[0]!"
        :myMoneyCards="activePlayer?.moneyCards || []"
        @commit-trade="onCommitCowTrade"
        @cancel-commit="onCancelCowCommit"
      />
    </section>

    <!-- Cow Trade: Reveal -->
    <section v-else-if="phase === 'cow.reveal'" class="view cow-trade">
      <div class="panel">
        <h2>正在揭示雙方選擇...</h2>
        <p class="description">請稍候，正在處理交易結果</p>
      </div>
    </section>

    <!-- Cow Trade: Settlement -->
    <section v-else-if="phase === 'cow.settlement'" class="view cow-trade">
      <div class="panel">
        <h2>交易結算中...</h2>
        <p class="description">正在執行資源交換</p>
      </div>
    </section>

    <!-- Turn End -->
    <section v-else-if="phase === 'turn.end'" class="view turn-end">
      <div class="panel">
        <h2>回合結束</h2>
        <p class="description">正在準備下一回合...</p>
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
import MoneyPad from '@/components/MoneyPad.vue';
import CowTargetPicker from '@/components/CowTrade/CowTargetPicker.vue';
import CowAnimalPicker from '@/components/CowTrade/CowAnimalPicker.vue';
import CowConfirmBar from '@/components/CowTrade/CowConfirmBar.vue';

import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import broadcast from '@/services/broadcast';
import { Msg } from '@/networking/protocol';
import type { Phase, Player, Animal } from '@/types/game';
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

// Empty animals object for type safety
const emptyAnimals: Record<Animal, number> = {
  chicken: 0,
  goose: 0,
  cat: 0,
  dog: 0,
  sheep: 0,
  snake: 0,
  donkey: 0,
  pig: 0,
  cow: 0,
  horse: 0,
};

/** --------------------------
 * Event handlers
 * -------------------------- */
function onChooseAuction() {
  // Route via Ably to host
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  void broadcast.publish(Msg.Action.ChooseAuction, { playerId: myId });
}

function onChooseCowTrade() {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  // Initialize cow trade phase
  game.phase = 'cow.selectTarget';
  game.appendLog(`${nameOf(myId)} 發起牛交易`);
  game.bumpVersion();
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
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  console.log('[DEBUG] onHostBuyback: Initiating buyback', {
    playerId: myId,
    currentPhase: phase.value,
    canBuyback: canBuyback.value
  });
  void broadcast.publish(Msg.Action.HostBuyback, { playerId: myId });
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
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
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
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  console.log('[DEBUG] onCancelBuyback: Cancelling buyback', {
    playerId: myId,
    previouslySelectedCards: selectedMoneyIds.value
  });
  void broadcast.publish(Msg.Action.CancelBuyback, { playerId: myId });
  selectedMoneyIds.value = []; // Reset selection
}



function onSelectCowTarget(targetId: string) {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  console.log('[CowTrade] Selecting target:', targetId);

  // Initialize cow trade state
  if (!game.cow) {
    game.cow = {
      initiatorId: myId,
      targetPlayerId: targetId,
      targetAnimal: undefined,
      initiatorSecret: undefined,
      targetSecret: undefined,
    };
  } else {
    game.cow.targetPlayerId = targetId;
  }

  game.phase = 'cow.selectAnimal';
  game.appendLog(`交易對象：${nameOf(targetId)}`);
  game.bumpVersion();
}

function onSelectCowAnimal(animal: string) {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  console.log('[CowTrade] Selecting animal:', animal);

  if (game.cow) {
    game.cow.targetAnimal = animal as any;
  }

  game.phase = 'cow.commit';
  game.appendLog(`選擇動物：${animal}`);
  game.bumpVersion();
}

function onCommitCowTrade(moneyCardIds: string[]) {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  console.log('[CowTrade] Committing trade:', moneyCardIds);

  if (game.cow) {
    if (myId === game.cow.initiatorId) {
      game.cow.initiatorSecret = moneyCardIds;
    } else if (myId === game.cow.targetPlayerId) {
      game.cow.targetSecret = moneyCardIds;
    }

    // If both players have committed, proceed to reveal
    if (game.cow.initiatorSecret && game.cow.targetSecret) {
      setTimeout(() => {
        game.phase = 'cow.reveal';
        game.bumpVersion();

        setTimeout(() => {
          onSettleCowTrade();
        }, 2000);
      }, 1000);
    }
  }

  game.appendLog(`玩家 ${nameOf(myId)} 已提交交易`);
  game.bumpVersion();
}

function onCancelCowCommit() {
  const myId = new URL(location.href).searchParams.get('player')?.toLowerCase().trim() || '';
  console.log('[CowTrade] Cancelling commit');

  if (game.cow) {
    if (myId === game.cow.initiatorId) {
      game.cow.initiatorSecret = undefined;
    } else if (myId === game.cow.targetPlayerId) {
      game.cow.targetSecret = undefined;
    }
  }

  game.appendLog(`玩家 ${nameOf(myId)} 取消提交`);
  game.bumpVersion();
}

function onSettleCowTrade() {
  console.log('[CowTrade] Settling trade');

  if (!game.cow || !game.cow.initiatorId || !game.cow.targetPlayerId || !game.cow.targetAnimal) {
    onCancelCowCommit();
    return;
  }

  const initiator = game.players.find(p => p.id === game.cow!.initiatorId);
  const target = game.players.find(p => p.id === game.cow!.targetPlayerId);

  if (!initiator || !target || !game.cow.initiatorSecret || !game.cow.targetSecret) {
    onCancelCowCommit();
    return;
  }

  // Calculate winner based on money totals
  const calcTotal = (cardIds: string[]) => {
    const allCards = [...initiator!.moneyCards, ...target!.moneyCards];
    return cardIds.reduce((total, id) => {
      const card = allCards.find(c => c.id === id);
      return total + (card?.value || 0);
    }, 0);
  };

  const initiatorTotal = calcTotal(game.cow.initiatorSecret);
  const targetTotal = calcTotal(game.cow.targetSecret);

  let winner, logMessage;

  if (initiatorTotal > targetTotal) {
    winner = initiator;
    logMessage = `${initiator.name} 贏得交易，獲得 ${game.cow.targetAnimal}`;
  } else if (targetTotal > initiatorTotal) {
    winner = target;
    logMessage = `${target.name} 贏得交易，獲得 ${game.cow.targetAnimal}`;
  } else {
    // Tie - no exchange
    logMessage = '交易平手，取消交易';
  }

  if (winner && winner !== initiator) {
    // Exchange animal
    winner.animals[game.cow.targetAnimal] = (winner.animals[game.cow.targetAnimal] || 0) + 1;
    initiator.animals[game.cow.targetAnimal] = Math.max(0, (initiator.animals[game.cow.targetAnimal] || 0) - 1);

    // Exchange money cards
    const winnerCards = game.cow.initiatorSecret.map(id =>
      initiator.moneyCards.find(card => card.id === id)
    ).filter(Boolean);

    const initiatorCards = game.cow.targetSecret.map(id =>
      target.moneyCards.find(card => card.id === id)
    ).filter(Boolean);

    // Remove cards from original owners
    initiator.moneyCards = initiator.moneyCards.filter(card => !game.cow!.initiatorSecret!.includes(card.id));
    target.moneyCards = target.moneyCards.filter(card => !game.cow!.targetSecret!.includes(card.id));

    // Add cards to new owners
    initiator.moneyCards.push(...initiatorCards as any[]);
    target.moneyCards.push(...winnerCards as any[]);
  }

  game.appendLog(logMessage);

  // End cow trade and return to turn flow
  endCowTrade();
}

function endCowTrade() {
  game.phase = 'turn.end';
  game.cow = null;
  game.bumpVersion();

  setTimeout(() => {
    game.checkEndAndMaybeFinish();
    if (game.phase !== 'game.end') {
      game.rotateTurn();
      game.startTurn();
    }
  }, 1000);
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
