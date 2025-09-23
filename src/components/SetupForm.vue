<script setup lang="ts">
import { computed, ref } from 'vue';

const name = ref('');
const canSubmit = computed(() => {
  const t = name.value.trim();
  return t.length > 0 && t.length <= 12;
});

const emit = defineEmits<{ (e: 'confirm', name: string): void }>();
function submit() {
  if (!canSubmit.value) return;
  emit('confirm', name.value);
}
</script>

<template>
  <div class="player-row">
    <input v-model.trim="name" placeholder="最多 12 字（任意字元）" maxlength="12" />
    <button class="primary" :disabled="!canSubmit" @click="submit">Join</button>
  </div>
</template>

<style scoped>
.player-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}
button.primary {
  padding: 8px 12px;
}
</style>

