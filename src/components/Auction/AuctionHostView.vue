<template>
  <section class="host-panel">
    <header class="host-header">
      <h3>主持人面板</h3>
      <small class="hint">結標、或（條件允許時）進行買回</small>
    </header>

    <div v-if="auctionAnimal" class="auction-animal">
      <strong>當前拍賣動物：</strong>{{ auctionAnimal }}
    </div>

    <div class="highest">
      <template v-if="highest">
        <div class="price">
          目前最高出價：
          <strong class="amount">{{ highest.total }}</strong>
        </div>
        <div class="meta">
          來自玩家 <code class="pid">{{ highest.playerId }}</code>
          <span class="ts">（ts: {{ formatTs(highest.ts) }}）</span>
        </div>
      </template>
      <template v-else>
        <div class="no-bid">目前無人出價，按「結標」將由主持人直接取得此牌。</div>
      </template>
    </div>

    <div class="actions">
      <button
        data-testid="btn-award"
        class="btn primary"
        type="button"
        @click="onAward"
      >
        結標：{{ highest ? '給最高出價者' : '由主持人取得' }}
      </button>

      <button
        data-testid="btn-buyback"
        class="btn"
        type="button"
        :disabled="!canBuyback || !highest"
        @click="onBuyback"
        :title="buybackDisabledReason"
      >
        主持人買回（等額）
      </button>
    </div>

    <details class="rules">
      <summary>規則提示</summary>
      <ul>
        <li>平手以主持人接收時間（ts）先到者為優先。</li>
        <li>無人出價時，主持人可直接結標拿牌。</li>
        <li>買回需主持人能以錢卡湊出等額，否則此按鈕會被停用。</li>
      </ul>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Bid } from '@/types/game';

const props = defineProps<{
  highest?: Bid;
  canBuyback: boolean;
  auctionAnimal?: string;
}>();

const emit = defineEmits<{
  (e: 'award'): void;
  (e: 'buyback'): void;
}>();

function onAward() {
  emit('award');
}
function onBuyback() {
  if (!props.highest || !props.canBuyback) return;
  emit('buyback');
}
function formatTs(ts: number) {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return String(ts);
  }
}

const buybackDisabledReason = computed<string>(() => {
  if (!props.highest) return '目前沒有出價，不可買回';
  if (!props.canBuyback) return '主持人錢卡不足，無法等額買回';
  return '';
});
</script>

<style scoped>
.host-panel {
  border: 1px solid #4b5563;
  border-radius: 12px;
  padding: 12px;
  background: #1f2937;
  color: #f9fafb;
  display: grid;
  row-gap: 10px;
}
.host-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.host-header h3 {
  margin: 0;
  font-size: 16px;
  color: #ffffff;
}
.hint {
  color: #9ca3af;
}
.highest .price {
  font-size: 14px;
  margin-bottom: 2px;
  color: #d1d5db;
}
.amount {
  font-size: 18px;
  color: #ffffff;
}
.meta {
  color: #a1a1aa;
  font-size: 12px;
}
.pid {
  background: #374151;
  padding: 1px 6px;
  border-radius: 6px;
  color: #f9fafb;
}
.no-bid {
  color: #9ca3af;
  font-style: italic;
}
.actions {
  display: flex;
  gap: 8px;
}
.btn {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid #4b5563;
  background: #374151;
  cursor: pointer;
  font-size: 14px;
  color: #f9fafb;
}
.btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: white;
}
.auction-animal {
  font-size: 14px;
  padding: 6px 8px;
  background: #374151;
  border: 1px solid #4b5563;
  border-radius: 6px;
  color: #f9fafb;
}
.auction-animal strong {
  color: #ffffff;
}
.rules summary {
  cursor: pointer;
  color: #d1d5db;
}
.rules ul {
  margin: 6px 0 0;
  padding-left: 20px;
  color: #f9fafb;
}
</style>
