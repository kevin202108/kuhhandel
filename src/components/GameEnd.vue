<template>
  <section class="view game-end">
    <div class="ui-panel">
      <h2>Game Over</h2>
      <ol class="scores">
        <li v-for="s in finalScores" :key="s.playerId">
          <strong>{{ nameOf(s.playerId) }}</strong>: {{ s.score }}
        </li>
      </ol>
      <div class="actions">
        <button class="ui-btn is-secondary" @click="emit('restart')">Restart</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '@/store/game';
import type { Player } from '@/types/game';

const emit = defineEmits<{ restart: [] }>();

const game = useGameStore();
const players = computed<Player[]>(() => game.players);
const finalScores = computed(() => game.computeFinalScores());

function nameOf(id: string) {
  return players.value.find(p => p.id === id)?.name ?? id;
}
</script>

<style scoped>
/* Panel styling provided by .ui-panel (global) */
.actions {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
/* Buttons standardized via .ui-btn classes */
.scores {
  margin: 8px 0 0;
  padding: 0 0 0 18px;
}
</style>
