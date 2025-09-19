<template>
  <div class="cow-animal-picker">
    <h3>選擇要交易的動物</h3>
    <p class="description">選擇一個您擁有的動物進行交易</p>

    <div class="animals-grid">
      <button
        v-for="animal in availableAnimals"
        :key="animal"
        class="animal-btn"
        :class="{ selected: selectedAnimal === animal }"
        @click="selectAnimal(animal)"
      >
        <div class="animal-icon">{{ short(animal) }}</div>
        <div class="animal-info">
          <div class="animal-name">{{ animalNames[animal] }}</div>
          <div class="animal-count">持有: {{ myAnimals[animal] }}</div>
        </div>
      </button>
    </div>

    <div v-if="selectedAnimal" class="selection-info">
      <p>已選擇：<strong>{{ short(selectedAnimal) }} ({{ animalNames[selectedAnimal] }})</strong></p>
    </div>

    <div class="actions">
      <button
        class="btn primary"
        :disabled="!selectedAnimal"
        @click="$emit('select-animal', selectedAnimal!)"
      >
        確認選擇
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Animal, Player } from '@/types/game';

const props = defineProps<{
  myAnimals: Record<Animal, number>;
  targetPlayer?: Player;
}>();

const emit = defineEmits<{
  (e: 'select-animal', animal: Animal): void;
}>();

const selectedAnimal = ref<Animal | null>(null);

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

// Only show animals that both players have (both > 0)
const availableAnimals = computed(() => {
  if (!props.targetPlayer) return [];

  const myAnimalTypes = (Object.keys(props.myAnimals) as Animal[])
    .filter(animal => props.myAnimals[animal] > 0);

  const targetAnimalTypes = (Object.keys(props.targetPlayer.animals) as Animal[])
    .filter(animal => props.targetPlayer!.animals[animal] > 0);

  // Return intersection of animals both players have
  return myAnimalTypes.filter(animal => targetAnimalTypes.includes(animal));
});

const calculatedTradeAmount = computed(() => {
  if (!selectedAnimal.value || !props.targetPlayer) return 0;

  const myCount = props.myAnimals[selectedAnimal.value] || 0;
  const targetCount = props.targetPlayer.animals[selectedAnimal.value] || 0;

  // If both have 2 or more, trade 2 animals; otherwise trade 1
  if (myCount >= 2 && targetCount >= 2) {
    return 2;
  }
  return 1;
});

function selectAnimal(animal: Animal) {
  selectedAnimal.value = animal;
}

function short(a: Animal): string {
  return animalNames[a].charAt(0).toUpperCase();
}
</script>

<style scoped>
.cow-animal-picker {
  display: grid;
  gap: 16px;
  padding: 16px;
  background: #1f2937;
  color: #f9fafb;
  border-radius: 12px;
  border: 1px solid #4b5563;
}

h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
}

.description {
  margin: 0;
  color: #9ca3af;
  font-size: 14px;
}

.animals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.animal-btn {
  border: 2px solid #4b5563;
  border-radius: 12px;
  background: #374151;
  color: #f9fafb;
  cursor: pointer;
  padding: 16px;
  transition: all 0.15s ease;
  display: grid;
  gap: 8px;
  align-items: center;
  text-align: center;
}

.animal-btn:hover {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.3);
  transform: translateY(-2px);
}

.animal-btn.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.4);
  background: linear-gradient(135deg, #10b98120 0%, #14b8a620 100%);
}

.animal-icon {
  font-size: 32px;
  font-weight: 800;
  color: #ffffff;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.animal-info {
  display: grid;
  gap: 4px;
}

.animal-name {
  font-weight: 600;
  font-size: 14px;
}

.animal-count {
  font-size: 12px;
  color: #9ca3af;
  font-weight: 500;
}

.selection-info {
  background: #374151;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #4b5563;
}

.selection-info p {
  margin: 0;
  color: #e5e7eb;
  font-size: 14px;
}

.actions {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}

.btn {
  appearance: none;
  border: 1px solid #4b5563;
  border-radius: 8px;
  background: #374151;
  color: #f9fafb;
  padding: 10px 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn.primary {
  border-color: #10b981;
  background: #10b981;
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

@media (max-width: 600px) {
  .animals-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 10px;
  }

  .animal-btn {
    padding: 12px;
  }

  .animal-icon {
    font-size: 24px;
  }
}
</style>
