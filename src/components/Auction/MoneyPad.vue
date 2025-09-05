<template>
  <div class="money-pad">
    <div class="cards">
      <button
        v-for="card in moneyCards"
        :key="card.id"
        class="card"
        :class="{ selected: selectedIdsSet.has(card.id), zero: card.value === 0 }"
        @click="emit('toggle', card.id)"
        :aria-pressed="selectedIdsSet.has(card.id)"
      >
        <span class="value">{{ card.value }}</span>
        <small class="id">{{ shortId(card.id) }}</small>
      </button>

      <p v-if="!moneyCards.length" class="empty">你沒有可用的錢卡</p>
    </div>

    <div class="bar">
      <div class="total">
        合計：
        <span class="amount">{{ total }}</span>
      </div>

      <div class="actions">
        <button class="secondary" @click="emit('clear')" :disabled="selectedIds.length === 0">
          清空選擇
        </button>

        <button
          class="primary"
          :disabled="selectedIds.length === 0 || total <= 0"
          @click="onConfirm"
          title="至少需要合計 > 0 才能確認出價"
        >
          確認（{{ total }}）
        </button>
      </div>
    </div>
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

const total = computed(() =>
  props.selectedIds
    .map((id) => props.moneyCards.find((c) => c.id === id)?.value ?? 0)
    .reduce<number>((a, b) => a + b, 0)
);

function onConfirm() {
  // UI guard：不送出 0 元出價
  if (props.selectedIds.length === 0 || total.value <= 0) return;
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
  border: 1px solid #d0d5dd;
  border-radius: 10px;
  background: #fff;
  padding: 10px 8px;
  cursor: pointer;
  display: grid;
  gap: 4px;
  text-align: center;
  transition: box-shadow 0.15s ease, transform 0.05s ease, border-color 0.15s ease;
}
.card .value {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.2px;
}
/* .card.zero .value {
  color: #64748b;
} */
.card .id {
  color: #6b7280;
  font-size: 11px;
}
.card.selected {
  border-color: #155eef;
  box-shadow: 0 0 0 3px #165dff22 inset;
  background: #165dff0d;
}
.card:active {
  transform: translateY(1px);
}
</style>
