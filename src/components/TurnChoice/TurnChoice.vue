<template>
  <section class="view turn-choice">
    <div class="ui-panel">
      <h2>Choose Action ({{ activePlayer?.name }})</h2>
      <div v-if="isMyTurn">
        <div class="turn-choice">
          <h2 class="title">Choose your action</h2>
          <div class="buttons">
            <button
              class="ui-btn is-primary"
              :disabled="!isMyTurn || !canAuction"
              @click="emit('choose-auction')"
            >
              發起拍賣(抽卡)
            </button>

            <button
              class="ui-btn is-secondary"
              :disabled="!isMyTurn || isFirstRound || !canCowTrade"
              @click="emit('choose-cow-trade')"
              :title="cowDisabledTooltip"
            >
              發起幕後交易
            </button>
          </div>

          <p v-if="isFirstRound" class="hint">First round: Auction only; Cow Trade disabled.</p>
          <p v-else-if="!canCowTrade" class="hint">Cow Trade unavailable now.</p>
        </div>
      </div>
      <div v-else class="muted">
        Waiting for {{ activePlayer?.name }} to choose…
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '@/store/game';
import type { Player } from '@/types/game';

const emit = defineEmits<{ 'choose-auction': []; 'choose-cow-trade': [] }>();

const game = useGameStore();
const players = computed<Player[]>(() => game.players);
const activePlayer = computed<Player | undefined>(() => game.activePlayer);
const myId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '');
const isMyTurn = computed(() => myId === game.turnOwnerId);
const canAuction = computed(() => game.canChooseAuction);
const canCowTrade = computed(() => game.canChooseCowTrade);

const isFirstRound = computed(() => {
  return players.value.every(p => {
    const counts = Object.values(p.animals || {});
    return counts.reduce((a, b) => a + (b || 0), 0) === 0;
  });
});

const cowDisabledTooltip = computed(() => {
  if (!isMyTurn.value) return 'Not your turn';
  if (isFirstRound.value) return 'First round: Auction only';
  if (!canCowTrade.value) return 'Cow Trade not available';
  return '';
});
</script>

<style scoped>
.muted { color: #6b7280; font-size: 12px; }
/* Panel styling provided by .ui-panel (global) */
.turn-choice {
  display: grid;
  gap: 12px;
  padding: 12px;
  background: #1f2937;
  color: #f9fafb;
}
.title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
}
.buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
/* Buttons standardized via .ui-btn classes */
.hint {
  color: #9ca3af;
  font-size: 13px;
  margin: 0;
}
</style>
