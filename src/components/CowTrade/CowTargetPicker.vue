<template>
  <div class="cow-target-picker">
    <h3>選擇交易對象</h3>
    <ul class="plist">
      <li
        v-for="p in otherPlayers"
        :key="p.id"
        class="pitem selectable"
        :class="{ selected: selectedPlayerId === p.id }"
        @click="selectPlayer(p.id)"
      >
        <div class="row head">
          <div class="name">
            <span class="dot" :class="{ on: p.id === myId }"></span>
            {{ p.name }}
            <small class="pid">(<code>{{ p.id }}</code>)</small>
          </div>
          <div class="money-count">
            錢卡: <strong>{{ p.moneyCards.length }}</strong>
          </div>
          <div class="animals">
            <template v-for="a in animalOrder" :key="a">
              <span v-if="p.animals[a] > 0" class="animal">
                {{ short(a) }}: <strong>{{ p.animals[a] }}</strong>
              </span>
            </template>
          </div>
        </div>
      </li>
    </ul>
    <div class="actions">
      <button
        class="btn primary"
        :disabled="!selectedPlayerId"
        @click="$emit('select-target', selectedPlayerId!)"
      >
        確認選擇
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Player, Animal } from '@/types/game';

const props = defineProps<{
  players: Player[];
  myId: string;
}>();

const emit = defineEmits<{
  (e: 'select-target', targetId: string): void;
}>();

const selectedPlayerId = ref<string | null>(null);
const animalOrder: Animal[] = ['chicken', 'goose', 'cat', 'dog', 'sheep', 'snake', 'donkey', 'pig', 'cow', 'horse'];

const otherPlayers = computed(() =>
  props.players.filter(p => p.id !== props.myId)
);

function selectPlayer(playerId: string) {
  selectedPlayerId.value = playerId;
}

function short(a: Animal): string {
  switch (a) {
    case 'chicken': return '雞';
    case 'goose': return '鵝';
    case 'cat': return '貓';
    case 'dog': return '狗';
    case 'sheep': return '羊';
    case 'snake': return '蛇';
    case 'donkey': return '驢';
    case 'pig': return '豬';
    case 'cow': return '牛';
    case 'horse': return '馬';
  }
}
</script>

<style scoped>
.cow-target-picker {
  display: grid;
  gap: 16px;
  padding: 16px;
  background: #1f2937;
  color: #f9fafb;
  border-radius: 12px;
  border: 1px solid #4b5563;
}

h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
}

.plist {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  row-gap: 8px;
}

.pitem {
  border: 1px solid #4b5563;
  border-radius: 8px;
  padding: 12px;
  background: #374151;
  color: #f9fafb;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pitem:hover {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.3);
}

.pitem.selectable.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);
  background: linear-gradient(135deg, #10b98120 0%, #14b8a620 100%);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.head .name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.money-count {
  font-weight: 600;
  color: #e5e7eb;
  font-size: 14px;
}

.animals {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.animal {
  font-variant-numeric: tabular-nums;
  background: #1f2937;
  border: 1px solid #4b5563;
  padding: 4px 8px;
  border-radius: 6px;
  color: #f9fafb;
  font-size: 12px;
  font-weight: 600;
}

.pid code {
  background: #4b5563;
  padding: 2px 6px;
  border-radius: 4px;
  color: #f9fafb;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #6b7280;
  display: inline-block;
  flex-shrink: 0;
}

.dot.on {
  background: #10b981;
}

.actions {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}

.btn {
  appearance: none;
  border: 1px solid #4b5563;
  border-radius: 8px;
  background: #374151;
  color: #f9fafb;
  padding: 10px 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn.primary {
  border-color: #10b981;
  background: #10b981;
  color: #ffffff;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}
</style>
