<template>
  <div class="bidder" :class="{ 'is-passed': hasPassed }">
    <header class="header">
      <h3 class="title">你持有的金錢卡</h3>

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
      <div class="selection-summary" v-if="selectedIds.length > 0">
        選中 {{ selectedIds.length }} 張錢卡，總額 {{ total }}
      </div>
    </section>

    <footer class="footer">
      <!-- <div class="you">
        你的出價合計：<strong class="amount">{{ total }}</strong>
      </div> -->

      <div class="actions">
        <button class="ui-btn is-secondary" @click="onClear" :disabled="selectedIds.length === 0 || hasPassed">
          清空
        </button>
        <button class="ui-btn is-primary" :disabled="!canConfirm" @click="confirmNow">
          確認出價（{{ total }}）
        </button>
        <button
          class="ui-btn pass-btn"
          :class="hasPassed ? 'is-danger no-dim-when-disabled' : 'is-ghost'"
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
import MoneyPad from '../MoneyPad.vue';
import type { Player, Bid } from '@/types/game';

const props = defineProps<{
  self: Player;
  highest?: Bid;
  auctionAnimal?: string;
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

// 放棄後禁用出價，且必須選擇至少一張錢卡
const canConfirm = computed(() => !hasPassed.value && selectedIds.value.length > 0);

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
  background: var(--c-surface);
  color: var(--c-text);
  border-radius: 12px;
  padding: 12px;
}
.header {
  display: grid;
  gap: 6px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--c-text-strong);
}
.highest {
  font-size: 14px;
  color: var(--c-text-muted);
}
.highest.none {
  color: var(--c-text-dimmer);
}
.amount {
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  margin-left: 4px;
  color: var(--c-text-strong);
}
.desc {
  color: var(--c-text-dimmer);
  margin-left: 6px;
}
.pad {
  border: 1px dashed var(--c-border);
  border-radius: 12px;
  padding: 10px;
  background: var(--c-surface-2);
}

.selection-summary {
  margin-top: 12px;
  padding: 8px 12px;
  background: linear-gradient(135deg, var(--c-success-surface) 0%, var(--c-success-surface-2) 100%);
  border: 1px solid var(--c-success);
  border-radius: 8px;
  color: #6ee7b7;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}
.footer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}
.you {
  font-weight: 700;
  color: var(--c-text);
}
.actions {
  display: grid;
  grid-auto-flow: column;
  gap: 8px;
}

/* Buttons moved to global ui-btn classes in src/assets/main.css */

/* 額外在頂部提示 */
.banner-passed {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13px;
  background: var(--c-danger-surface);
  border: 1px solid var(--c-danger);
  color: var(--c-danger-contrast);
}

/* 整卡片淡化但仍可閱讀（可選） */
.is-passed .pad {
  opacity: 0.7;
}
</style>
