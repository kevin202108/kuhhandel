<template>
  <div class="money-pad">
    <div class="cards">
      <button
        v-for="card in sortedMoneyCards"
        :key="card.id"
        class="card"
        :class="{ selected: selectedIdsSet.has(card.id), zero: card.value === 0 }"
        @click="emit('toggle', card.id)"
        :aria-pressed="selectedIdsSet.has(card.id)"
      >
        <span class="value">🪙{{ card.value }}</span>
      </button>

      <p v-if="!moneyCards.length" class="empty">你沒有可用的錢卡</p>
    </div>

    <div class="bar"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MoneyCard } from '@/types/game';

const props = defineProps<{
  moneyCards: MoneyCard[];
  selectedIds: string[];
}>();

const emit = defineEmits<{
  (e: 'toggle', id: string): void;
  (e: 'clear'): void;
  (e: 'confirm', moneyCardIds: string[]): void;
}>();

const selectedIdsSet = computed(() => new Set(props.selectedIds));

const sortedMoneyCards = computed(() =>
  props.moneyCards.slice().sort((a, b) => a.value - b.value)
);

const total = computed(() =>
  props.selectedIds
    .map((id) => props.moneyCards.find((c) => c.id === id)?.value ?? 0)
    .reduce<number>((a, b) => a + b, 0)
);

function onConfirm() {
  // UI guard：不送出空選擇
  if (props.selectedIds.length === 0) return;
  emit('confirm', props.selectedIds);
}

function shortId(id: string) {
  // 僅用於 UI 顯示（避免整串 id 太長）
  return id.length > 6 ? id.slice(0, 3) + '…' + id.slice(-2) : id;
}
</script>

<style scoped>
.money-pad {
  display: grid;
  gap: 10px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
}
.card {
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: var(--c-surface-2);
  padding: 10px 8px;
  cursor: pointer;
  display: grid;
  gap: 4px;
  text-align: center;
  transition: box-shadow 0.15s ease, transform 0.05s ease, border-color 0.15s ease;
  color: var(--c-text);
}
.card .value {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.2px;
  color: var(--c-text-strong);
}
/* .card.zero .value {
  color: #64748b;
} */
.card .id {
  color: #9ca3af;
  font-size: 11px;
}
.card.selected {
  border-color: var(--c-success);
  box-shadow: 0 0 0 4px #10b98140 inset; /* uses success w/ alpha */
  background: linear-gradient(135deg, #10b98140 0%, #14b8a640 100%);
  transform: scale(1.05);
  border-width: 2px;
}
.card:active {
  transform: translateY(1px);
}
</style>
