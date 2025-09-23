<template>
  <div class="cow-target-picker">
    <h3>選擇交易對象</h3>
    <div class="targets-grid">
      <div
        v-for="player in availableTargets"
        :key="player.id"
        class="target-card"
        :class="{ selected: selectedTargetId === player.id }"
        @click="selectTarget(player.id)"
      >
        <div class="player-name">{{ player.name }}</div>
        <div class="player-info">
          <div class="money-count">💰 {{ player.moneyCards.length }}</div>
          <div class="animals-preview">
            <template v-for="animal in commonAnimalsWith(player)" :key="animal">
              <span class="animal-badge" :class="animal">
                {{ shortName(animal) }}: {{ player.animals[animal] }}
              </span>
            </template>
          </div>
        </div>
      </div>
    </div>
    <div class="actions">
      <button
        class="ui-btn is-primary"
        :disabled="!selectedTargetId"
        @click="confirmSelection"
      >
        確認選擇
      </button>
      <button class="ui-btn is-secondary" @click="cancelSelection">返回</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useCowStore } from '@/store/cow';
import { useGameStore } from '@/store/game';
import type { Player, Animal } from '@/types/game';

const props = defineProps<{
  onTargetSelected: (targetId: string) => void;
  onCancel: () => void;
}>();

const cowStore = useCowStore();
const gameStore = useGameStore();

const selectedTargetId = ref<string | null>(null);

const availableTargets = computed(() => cowStore.availableTargets);

const commonAnimalsWith = (targetPlayer: Player): Animal[] => {
  const me = gameStore.activePlayer;
  if (!me) return [];

  return Object.keys(me.animals).filter(animal => {
    const animalKey = animal as Animal;
    return (me.animals[animalKey] || 0) > 0 && (targetPlayer.animals[animalKey] || 0) > 0;
  }) as Animal[];
};

const shortName = (animal: Animal): string => {
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

const selectTarget = (targetId: string) => {
  selectedTargetId.value = targetId;
};

const confirmSelection = () => {
  if (selectedTargetId.value) {
    props.onTargetSelected(selectedTargetId.value);
  }
};

const cancelSelection = () => {
  props.onCancel();
};
</script>

<style scoped>
.cow-target-picker {
  padding: 16px;
}

.targets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin: 16px 0;
}

.target-card {
  border: 2px solid #4b5563;
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  background: #374151;
  color: #f9fafb;
  transition: all 0.2s ease;
}

.target-card:hover {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.3);
}

.target-card.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);
  background: #064e3b;
}

.player-name {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 8px;
  color: #ffffff;
}

.player-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.money-count {
  font-weight: 600;
  color: #fbbf24;
}

.animals-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.animal-badge {
  background: #1f2937;
  border: 1px solid #4b5563;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: #f9fafb;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 20px;
}

/* Buttons standardized via .ui-btn classes */
</style>
