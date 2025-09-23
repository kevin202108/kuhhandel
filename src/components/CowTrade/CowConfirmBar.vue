<template>
  <div class="cow-confirm-bar">
    <div class="trade-summary">
      <h4>交易確認</h4>
      <div class="summary-details">
        <p>與 <strong>{{ targetPlayer?.name }}</strong> 交易 <strong>{{ tradeAmount }}</strong> 隻 <strong>{{ animalName(targetAnimal!) }}</strong></p>
        <p>選擇錢卡進行出價（至少需支付 {{ requiredAmount }}）</p>
      </div>
    </div>

    <MoneyPad
      :moneyCards="availableMoneyCards"
      :selectedIds="selectedIds"
      @toggle="onToggleMoneyCard"
    />

    <div class="selection-summary">
      <div class="total-display">
        已選擇總額：<strong :class="{ 'sufficient': totalSelected >= requiredAmount, 'insufficient': totalSelected < requiredAmount }">{{ totalSelected }}</strong>
        <span v-if="totalSelected < requiredAmount" class="warning">（不足）</span>
      </div>
    </div>

    <div class="actions">
      <button
        class="ui-btn is-primary"
        :disabled="totalSelected < requiredAmount || selectedIds.length === 0"
        @click="confirmTrade"
      >
        確認交易
      </button>
      <button class="ui-btn is-secondary" @click="cancelTrade">返回</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useCowStore } from '@/store/cow';
import { useGameStore } from '@/store/game';
import MoneyPad from '@/components/MoneyPad.vue';
import type { Animal, Player, MoneyCard } from '@/types/game';

const props = defineProps<{
  playerId?: string;  // 如果沒有提供，使用當前邏輯
  onConfirm: (moneyCardIds: string[]) => void;
  onCancel: () => void;
}>();

const cowStore = useCowStore();
const gameStore = useGameStore();

const selectedIds = ref<string[]>([]);

const targetPlayer = computed((): Player | undefined => {
  return gameStore.players.find(p => p.id === cowStore.targetPlayerId);
});

const targetAnimal = computed(() => cowStore.targetAnimal);

const tradeAmount = computed(() => cowStore.tradeAmount);

const availableMoneyCards = computed((): MoneyCard[] => {
  // 如果明確指定了 playerId，使用對應玩家的錢卡
  if (props.playerId) {
    const player = gameStore.players.find(p => p.id === props.playerId);
    const result = player?.moneyCards || [];
    console.log('[DEBUG] availableMoneyCards (by playerId):', {
      specifiedPlayerId: props.playerId,
      foundPlayerCards: result.length,
      moneyCardIds: result.map(c => c.id)
    });
    return result;
  }

  // 備用邏輯：使用舊的判斷（兼容性）
  const result = isInitiator.value
    ? gameStore.players.find(p => p.id === cowStore.initiatorId)?.moneyCards || []
    : gameStore.activePlayer?.moneyCards || [];

  console.log('[DEBUG] availableMoneyCards (legacy):', {
    isInitiator: isInitiator.value,
    activePlayerId: gameStore.activePlayer?.id,
    initiatorId: cowStore.initiatorId,
    moneyCardsCount: result.length,
    moneyCardIds: result.map(c => c.id)
  });

  return result;
});

const isInitiator = computed(() => {
  const me = gameStore.activePlayer;
  return me?.id === cowStore.initiatorId;
});

const requiredAmount = computed(() => {
  if (!isInitiator.value) return 0; // 目標者沒有最低要求

  // 發起者的最低要求：目標者目前選擇的金額
  // 實際上這裡需要從目標者那裡獲取，但由於是秘密出價，在UI階段我們還不知道
  // 這裡先設為0，真正的驗證在store中進行
  return 0;
});

const totalSelected = computed(() => {
  const allCards = [...availableMoneyCards.value];
  return selectedIds.value.reduce((total, id) => {
    const card = allCards.find(c => c.id === id);
    return total + (card?.value || 0);
  }, 0);
});

const animalName = (animal: Animal): string => {
  const map: Record<Animal, string> = {
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
  return map[animal];
};

const onToggleMoneyCard = (cardId: string) => {
  const index = selectedIds.value.indexOf(cardId);
  if (index > -1) {
    selectedIds.value.splice(index, 1);
  } else {
    selectedIds.value.push(cardId);
  }
};

const confirmTrade = () => {
  if (selectedIds.value.length > 0) {
    props.onConfirm(selectedIds.value);
  }
};

const cancelTrade = () => {
  selectedIds.value = [];
  props.onCancel();
};
</script>

<style scoped>
.cow-confirm-bar {
  padding: 16px;
}

.trade-summary {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.trade-summary h4 { margin: 0 0 8px 0; color: var(--c-text); }

.summary-details p { margin: 4px 0; color: var(--c-text); }

.summary-details strong { color: var(--c-accent); }

.selection-summary { margin: 16px 0; text-align: center; }

.total-display { font-size: 16px; color: var(--c-text); }

.total-display strong { font-size: 18px; color: var(--c-success); }

.total-display strong.insufficient { color: var(--c-danger); }

.warning { color: var(--c-danger); font-weight: bold; }

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 20px;
}

/* Buttons standardized via .ui-btn classes */
</style>
