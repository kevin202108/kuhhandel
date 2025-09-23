<template>
  <section class="view game-end">
    <div class="panel">
      <h2>Game Over</h2>
      <ol class="scores">
        <li v-for="s in finalScores" :key="s.playerId">
          <strong>{{ nameOf(s.playerId) }}</strong>: {{ s.score }}
        </li>
      </ol>
      <div class="actions">
        <button class="secondary" @click="emit('restart')">Restart</button>
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
.panel {
  background: #121a33;
  border: 1px solid #223055;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
}
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
button.secondary { background: #203258; }
.scores {
  margin: 8px 0 0;
  padding: 0 0 0 18px;
}
</style>

