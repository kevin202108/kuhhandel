<template>
  <div class="bidder" :class="{ 'is-passed': hasPassed }">
    <header class="header">
      <h3 class="title">投標者視圖</h3>
      <div class="highest" v-if="highest">
        目前最高價：
        <strong class="amount">{{ highest.total }}</strong>
        <small class="desc">（先到先贏）</small>
      </div>
      <div class="highest none" v-else>目前尚無出價</div>

      <!-- 顯眼提示：已放棄 -->
      <div v-if="hasPassed" class="banner-passed">你已放棄本輪出價</div>
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
        <button class="secondary" @click="onClear" :disabled="selectedIds.length === 0 || hasPassed">
          清空
        </button>
        <button class="primary" :disabled="!canConfirm" @click="confirmNow">
          確認出價（{{ total }}）
        </button>
        <button
          class="ghost pass-btn"
          :class="{ passed: hasPassed }"
          :disabled="hasPassed"
          :aria-pressed="hasPassed ? 'true' : 'false'"
          title="放棄後本輪不可再出價"
          @click="onPass"
        >
          <span v-if="!hasPassed">放棄出價</span>
          <span v-else>已放棄</span>
        </button>
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

// 是否已放棄（本地狀態；父層開始新一輪拍賣時，建議給此元件一個新的 :key 來重置）
const hasPassed = ref(false);

const total = computed(() =>
  selectedIds.value
    .map((id) => props.self.moneyCards.find((c) => c.id === id)?.value ?? 0)
    .reduce<number>((a, b) => a + (b ?? 0), 0)
);

// 放棄後禁用出價
const canConfirm = computed(() => !hasPassed.value);

function onToggle(id: string) {
  if (hasPassed.value) return; // 放棄後忽略互動
  const i = selectedIds.value.indexOf(id);
  if (i >= 0) selectedIds.value.splice(i, 1);
  else selectedIds.value.push(id);
}

function onClear() {
  if (hasPassed.value) return;
  selectedIds.value = [];
}

function onConfirm(ids: string[]) {
  if (!canConfirm.value) return;
  emit('place-bid', ids);
  selectedIds.value = [];
}

function confirmNow() {
  if (!canConfirm.value) return;
  emit('place-bid', selectedIds.value.slice());
  selectedIds.value = [];
}

function onPass() {
  hasPassed.value = true;     // 立刻反映樣式與禁用
  selectedIds.value = [];     // 清掉暫存
  emit('pass');               // 通知父層 / store
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

/* Buttons */
button.primary,
button.secondary,
button.ghost {
  appearance: none;
  border-radius: 10px;
  padding: 8px 12px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.05s ease, opacity 0.2s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
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

/* 放棄後的視覺狀態（顯眼） */
.pass-btn.passed {
  background: #fee2e2;       /* 紅色淡底 */
  border-color: #fecaca;
  color: #991b1b;
  cursor: not-allowed;
}
.pass-btn.passed:disabled {
  opacity: 1;               /* 保持高對比，不要淡掉 */
}

/* 額外在頂部提示 */
.banner-passed {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

/* 整卡片淡化但仍可閱讀（可選） */
.is-passed .pad {
  opacity: 0.7;
}
</style>
