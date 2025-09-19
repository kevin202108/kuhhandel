<template>
  <div class="cow-confirm-bar">
    <h3>確認交易</h3>

    <div class="trade-summary">
      <div class="trade-item">
        <div class="label">要交易的動物：</div>
        <div class="value animal-value">
          <strong>{{ animalNames[selectedAnimal] }} ({{ short(selectedAnimal) }})</strong>
        </div>
      </div>
      <div class="trade-item">
        <div class="label">交易對象：</div>
        <div class="value">
          <strong>{{ targetPlayerName }}</strong>
        </div>
      </div>
    </div>

    <div class="money-selection">
      <h4>選擇要給出的錢卡金額</h4>
      <p class="description">秘密選擇您要給出的錢卡，總額將決定交易勝利者</p>

      <div class="current-selection">
        <div class="total-display">
          已選擇金額：<strong class="total-amount">{{ selectedTotal }}</strong>
        </div>
        <div class="card-count">已選擇 {{ selectedIds.length }} 張卡</div>
      </div>

      <MoneyPad
        :moneyCards="availableMoneyCards"
        :selectedIds="selectedIds"
        @toggle="onToggleMoneyCard"
      />
    </div>

    <div class="commit-section">
      <div class="commit-info">
        <p class="commit-notice">⚠️ 確認後將無法更改選擇，直到雙方都確認</p>
        <div class="commit-status">
          <div class="status-item" :class="{ ready: hasCommitted }">
            <span class="status-dot" :class="{ ready: hasCommitted }"></span>
            您已{{ hasCommitted ? '確認' : '未確認' }}
          </div>
          <div class="status-item" :class="{ waiting: !opponentCommitted }">
            <span class="status-dot" :class="{ ready: opponentCommitted }"></span>
            {{ opponentCommitted ? '對方已確認' : '等待對方確認' }}
          </div>
        </div>
      </div>

      <div class="actions">
        <button
          v-if="!hasCommitted"
          class="btn primary"
          :disabled="selectedIds.length === 0"
          @click="onCommit"
        >
          確認交易選擇
        </button>
        <button
          v-else
          class="btn secondary"
          @click="onCancel"
        >
          取消確認
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import MoneyPad from '@/components/MoneyPad.vue';
import type { Animal, MoneyCard, Player } from '@/types/game';

const props = defineProps<{
  selectedAnimal: Animal;
  targetPlayer: Player;
  myMoneyCards: MoneyCard[];
  hasCommitted?: boolean;
  opponentCommitted?: boolean;
}>();

const emit = defineEmits<{
  (e: 'commit-trade', moneyCardIds: string[]): void;
  (e: 'cancel-commit'): void;
}>();

const selectedIds = ref<string[]>([]);

const animalNames: Record<Animal, string> = {
  chicken: '雞',
  goose: '鵝',
  cat: '貓',
  dog: '狗',
  sheep: '羊',
  snake: '蛇',
  donkey: '驢',
  pig: '豬',
  cow: '牛',
  horse: '馬',
};

const availableMoneyCards = computed(() => props.myMoneyCards);

const selectedTotal = computed(() => {
  return selectedIds.value.reduce((total, id) => {
    const card = availableMoneyCards.value.find(c => c.id === id);
    return total + (card?.value || 0);
  }, 0);
});

const targetPlayerName = computed(() => props.targetPlayer?.name || '未知玩家');

function short(a: Animal): string {
  return animalNames[a].charAt(0).toUpperCase();
}

function onToggleMoneyCard(cardId: string) {
  const index = selectedIds.value.indexOf(cardId);
  if (index > -1) {
    selectedIds.value.splice(index, 1);
  } else {
    selectedIds.value.push(cardId);
  }
}

function onCommit() {
  if (selectedIds.value.length === 0) return;
  emit('commit-trade', [...selectedIds.value]);
}

function onCancel() {
  emit('cancel-commit');
}
</script>

<style scoped>
.cow-confirm-bar {
  display: grid;
  gap: 24px;
  padding: 16px;
  background: #1f2937;
  color: #f9fafb;
  border-radius: 12px;
  border: 1px solid #4b5563;
  max-width: 600px;
  margin: 0 auto;
}

h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
}

h4 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
}

.trade-summary {
  background: #374151;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #4b5563;
}

.trade-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #4b5563;
}

.trade-item:last-child {
  border-bottom: none;
}

.label {
  color: #9ca3af;
  font-weight: 500;
}

.value {
  color: #ffffff;
  font-weight: 600;
}

.animal-value {
  color: #10b981;
}

.money-selection {
  background: #374151;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #4b5563;
}

.description {
  margin: 0 0 16px;
  color: #9ca3af;
  font-size: 14px;
  line-height: 1.5;
}

.current-selection {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px;
  background: #1f2937;
  border-radius: 6px;
  border: 1px solid #4b5563;
}

.total-display {
  font-size: 14px;
  color: #e5e7eb;
}

.total-amount {
  color: #10b981;
  font-size: 18px;
}

.card-count {
  color: #6b7280;
  font-size: 12px;
}

.commit-section {
  background: #374151;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #4b5563;
}

.commit-info {
  margin-bottom: 16px;
}

.commit-notice {
  margin: 0 0 12px;
  color: #f59e0b;
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.commit-status {
  display: grid;
  gap: 8px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #9ca3af;
  font-size: 14px;
}

.status-item.ready {
  color: #10b981;
}

.status-item.waiting {
  color: #f59e0b;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6b7280;
}

.status-dot.ready {
  background: #10b981;
}

.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.btn {
  appearance: none;
  border: 1px solid #4b5563;
  border-radius: 8px;
  background: #374151;
  color: #f9fafb;
  padding: 12px 20px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 120px;
}

.btn.primary {
  border-color: #10b981;
  background: #10b981;
  color: #ffffff;
}

.btn.secondary {
  border-color: #ef4444;
  background: #ef4444;
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

.btn.secondary:not(:disabled):hover {
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}
</style>
