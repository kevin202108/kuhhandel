<template>
  <div class="player-row">
    <input v-model.trim="name" placeholder="最多 12 字（任意字元）" maxlength="12" />
    <button class="ui-btn is-primary" :disabled="!canSubmit" @click="submit">Join</button>
  </div>
  <p class="hint">Display name is for UI only (max 12 chars).</p>
</template>

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

<style scoped>
.player-row { display: flex; gap: 8px; align-items: center; }
input { flex: 1; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 8px; }
/* Buttons standardized via .ui-btn classes */
.hint { opacity: .75; margin-top: 4px; font-size: 12px; }
</style>
