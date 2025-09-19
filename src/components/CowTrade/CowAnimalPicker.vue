<template>
  <div class="cow-animal-picker">
    <h3>選擇交易動物</h3>
    <div class="trade-info">
      <p>與玩家 <strong>{{ targetPlayer?.name }}</strong> 交易</p>
    </div>
    <div class="animals-grid">
      <div
        v-for="animal in availableAnimals"
        :key="animal"
        class="animal-card"
        :class="{ selected: selectedAnimal === animal }"
        @click="selectAnimalItem(animal)"
      >
        <div class="animal-icon">{{ iconName(animal) }}</div>
        <div class="animal-details">
          <div class="animal-name">{{ animalName(animal) }}</div>
          <div class="animal-counts">
            <span class="my-count">你：{{ myCount(animal) }}</span>
            <span class="target-count">對方：{{ targetCount(animal) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="actions">
      <button
        class="primary"
        :disabled="!selectedAnimal"
        @click="confirmSelection"
      >
        確認選擇
      </button>
      <!-- <button class="secondary" @click="cancelSelection">取消</button> -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useCowStore } from '@/store/cow';
import { useGameStore } from '@/store/game';
import type { Animal, Player } from '@/types/game';

const props = defineProps<{
  onAnimalSelected: (animal: Animal) => void;
  onCancel: () => void;
}>();

const cowStore = useCowStore();
const gameStore = useGameStore();

const selectedAnimal = ref<Animal | null>(null);

const availableAnimals = computed(() => cowStore.availableAnimals);

const targetPlayer = computed((): Player | undefined => {
  return gameStore.players.find(p => p.id === cowStore.targetPlayerId);
});

const tradeAmount = computed(() => cowStore.tradeAmount);

const myCount = (animal: Animal): number => {
  const me = gameStore.activePlayer;
  return me?.animals[animal] || 0;
};

const targetCount = (animal: Animal): number => {
  const target = targetPlayer.value;
  return target?.animals[animal] || 0;
};

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

const iconName = (animal: Animal): string => {
  const map: Record<Animal, string> = {
    chicken: '🐔',
    goose: '🦆',
    cat: '🐱',
    dog: '🐶',
    sheep: '🐑',
    snake: '🐍',
    donkey: '🫏',
    pig: '🐷',
    cow: '🐄',
    horse: '🐎',
  };
  return map[animal];
};

const selectAnimalItem = (animal: Animal) => {
  selectedAnimal.value = animal;
};

const confirmSelection = () => {
  if (selectedAnimal.value) {
    props.onAnimalSelected(selectedAnimal.value);
  }
};

const cancelSelection = () => {
  props.onCancel();
};
</script>

<style scoped>
.cow-animal-picker {
  padding: 16px;
}

.trade-info {
  background: #1f2937;
  border: 1px solid #4b5563;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  text-align: center;
}

.trade-info p {
  margin: 4px 0;
  color: #f9fafb;
}

.trade-amount {
  font-weight: bold;
  color: #60a5fa;
  font-size: 16px;
}

.animals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin: 16px 0;
}

.animal-card {
  border: 2px solid #4b5563;
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  background: #374151;
  color: #f9fafb;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.animal-card:hover {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.3);
}

.animal-card.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);
  background: #064e3b;
}

.animal-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.animal-details {
  width: 100%;
}

.animal-name {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 8px;
  color: #ffffff;
}

.animal-counts {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}

.my-count {
  color: #10b981;
}

.target-count {
  color: #f59e0b;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 20px;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

button.primary {
  background: #10b981;
  color: white;
}

button.primary:disabled {
  background: #6b7280;
  cursor: not-allowed;
}

button.secondary {
  background: #374151;
  color: #f9fafb;
  border: 1px solid #4b5563;
}

button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
</style>
