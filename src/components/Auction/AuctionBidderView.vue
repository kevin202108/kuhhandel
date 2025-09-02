<template>
  <div class="bidder">
    <header class="header">
      <h3 class="title">投標者視圖</h3>
      <div class="highest" v-if="highest">
        目前最高價：
        <strong class="amount">{{ highest.total }}</strong>
        <small class="desc">（先到先贏）</small>
      </div>
      <div class="highest none" v-else>目前尚無出價</div>
    </header>

    <section class="pad">
      <MoneyPad
        :money-cards="self.moneyCards"
        :selected-ids="selectedIds"
        @toggle="onToggle"
        @clear="onClear"
        @confirm="onConfirm"
      />
    </section>

    <footer class="footer">
      <div class="you">
        你的出價合計：<strong class="amount">{{ total }}</strong>
      </div>

      <div class="actions">
        <button class="secondary" @click="onClear" :disabled="selectedIds.length === 0">
          清空
        </button>
        <button class="primary" :disabled="!canConfirm" @click="confirmNow">
          確認出價（{{ total }}）
        </button>
        <button class="ghost" @click="emit('pass')">放棄出價</button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MoneyPad from './MoneyPad.vue';
import type { Player, Bid } from '@/types/game';

const props = defineProps<{
  self: Player;
  highest?: Bid;
}>();

const emit = defineEmits<{
  (e: 'place-bid', moneyCardIds: string[]): void;
  (e: 'pass'): void;
}>();

// 本地暫存選擇（送出前不動真資產）
const selectedIds = ref<string[]>([]);

const total = computed(() =>
  selectedIds.value
    .map((id) => props.self.moneyCards.find((c) => c.id === id)?.value ?? 0)
    .reduce<number>((a, b) => a + b, 0)
);

const canConfirm = computed(() => total.value > 0);

function onToggle(id: string) {
  const i = selectedIds.value.indexOf(id);
  if (i >= 0) selectedIds.value.splice(i, 1);
  else selectedIds.value.push(id);
}

function onClear() {
  selectedIds.value = [];
}

function onConfirm(ids: string[]) {
  // 從 MoneyPad 直接按下「確認」
  if (!canConfirm.value) return;
  emit('place-bid', ids);
  selectedIds.value = [];
}

function confirmNow() {
  if (!canConfirm.value) return;
  emit('place-bid', selectedIds.value.slice());
  selectedIds.value = [];
}
</script>

<style scoped>
.bidder {
  display: grid;
  gap: 12px;
}
.header {
  display: grid;
  gap: 6px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}
.highest {
  font-size: 14px;
  color: #111827;
}
.highest.none {
  color: #6b7280;
}
.amount {
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  margin-left: 4px;
}
.desc {
  color: #6b7280;
  margin-left: 6px;
}
.pad {
  border: 1px dashed #e5e7eb;
  border-radius: 12px;
  padding: 10px;
  background: #fafafa;
}
.footer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}
.you {
  font-weight: 700;
}
.actions {
  display: grid;
  grid-auto-flow: column;
  gap: 8px;
}
button.primary,
button.secondary,
button.ghost {
  appearance: none;
  border-radius: 10px;
  padding: 8px 12px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.05s ease, opacity 0.2s ease, box-shadow 0.15s ease;
  border: 1px solid transparent;
}
button.primary {
  color: #fff;
  background: #155eef;
  border-color: #155eef;
}
button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.secondary {
  background: #fff;
  border-color: #d0d5dd;
}
button.secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
button.ghost {
  background: transparent;
  border-color: #e5e7eb;
}
button:not(:disabled):active {
  transform: translateY(1px);
}
</style>
