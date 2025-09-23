<template>
  <section class="view turn-choice">
    <div class="panel">
      <h2>Choose Action ({{ activePlayer?.name }})</h2>
      <div v-if="myId === game.turnOwnerId">
        <TurnChoice
          :canAuction="game.canChooseAuction"
          :canCowTrade="game.canChooseCowTrade"
          :isFirstRound="isFirstRound"
          :isMyTurn="true"
          @choose-auction="emit('choose-auction')"
          @choose-cow-trade="emit('choose-cow-trade')"
        />
      </div>
      <div v-else class="muted">
        Waiting for {{ activePlayer?.name }} to choose…
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import TurnChoice from '@/components/TurnChoice.vue';
import { useGameStore } from '@/store/game';
import type { Player } from '@/types/game';

const emit = defineEmits<{ 'choose-auction': []; 'choose-cow-trade': [] }>();

const game = useGameStore();
const myId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '');
const players = computed<Player[]>(() => game.players);
const activePlayer = computed<Player | undefined>(() => game.activePlayer);

const isFirstRound = computed(() => {
  return players.value.every(p => {
    const counts = Object.values(p.animals || {});
    return counts.reduce((a, b) => a + (b || 0), 0) === 0;
  });
});
</script>

<style scoped>
.muted { color: #6b7280; font-size: 12px; }
.panel {
  background: #121a33;
  border: 1px solid #223055;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
}
</style>

