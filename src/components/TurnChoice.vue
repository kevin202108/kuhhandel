<template>
  <div class="turn-choice">
    <h2 class="title">Choose your action</h2>
    <div class="buttons">
      <button
        class="btn primary"
        :disabled="!isMyTurn || !canAuction"
        @click="emit('choose-auction')"
      >
        發起拍賣(抽卡)
      </button>

      <button
        class="btn"
        :disabled="!isMyTurn || isFirstRound || !canCowTrade"
        @click="emit('choose-cow-trade')"
        :title="cowDisabledTooltip"
      >
        發起幕後交易
      </button>
    </div>

    <p v-if="isFirstRound" class="hint">First round: Auction only; Cow Trade disabled.</p>
    <p v-else-if="!canCowTrade" class="hint">Cow Trade unavailable now.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  canAuction: boolean;
  canCowTrade: boolean;
  isFirstRound: boolean;
  isMyTurn?: boolean;
}>();

const emit = defineEmits<{
  (e: 'choose-auction'): void;
  (e: 'choose-cow-trade'): void;
}>();

const cowDisabledTooltip = computed(() => {
  if (!props.isMyTurn) return 'Not your turn';
  if (props.isFirstRound) return 'First round: Auction only';
  if (!props.canCowTrade) return 'Cow Trade not available';
  return '';
});
</script>

<style scoped>
.turn-choice {
  display: grid;
  gap: 12px;
  padding: 12px;
  background: #1f2937;
  color: #f9fafb;
}
.title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
}
.buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.btn {
  appearance: none;
  border: 1px solid #4b5563;
  border-radius: 10px;
  background: #374151;
  padding: 12px 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.05s ease, box-shadow 0.15s ease, opacity 0.2s ease, color 0.15s ease, border-color 0.15s ease;
  color: #f9fafb;
}
.btn.primary {
  border-color: #155eef;
  background: #165dff30;
  color: #ffffff;
}
.btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.btn:not(:disabled):active {
  transform: translateY(1px);
}
.hint {
  color: #9ca3af;
  font-size: 13px;
  margin: 0;
}
</style>
