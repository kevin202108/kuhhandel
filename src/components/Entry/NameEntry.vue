<template>
  <form class="name-entry" @submit.prevent="onSubmit">
    <label for="player-name" class="label">你的名字</label>

    <input
      id="player-name"
      ref="inputEl"
      v-model="name"
      type="text"
      inputmode="text"
      autocomplete="name"
      :maxlength="NAME_MAX"
      class="input"
      :aria-invalid="!isValid"
      @blur="touched = true"
    />

    <p v-if="showError" class="error">{{ errorText }}</p>

    <button class="btn" type="submit" :disabled="!isValid">確定</button>

    <p class="hint">按 Enter 送出並加入遊戲</p>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

export interface NameEntryProps {
  /** 初始名稱（可選）。若提供，會自動去除前後空白。 */
  initialName?: string;
}

const props = defineProps<NameEntryProps>();

const emit = defineEmits<{
  /**
   * 使用者確認名稱。
   * 僅傳遞淨化（trim）後的名稱字串。
   */
  (e: 'confirm', name: string): void;
}>();

/** 名稱長度限制（README 僅要求「長度檢查」，此處提供合理上限）。 */
const NAME_MIN = 1;
const NAME_MAX = 32;

const name = ref<string>('');
if (props.initialName !== undefined) {
  name.value = props.initialName.trim();
}

const inputEl = ref<HTMLInputElement | null>(null);

onMounted(() => {
  inputEl.value?.focus();
});

const trimmed = computed<string>(() => name.value.trim());

const isValid = computed<boolean>(() => {
  const len = trimmed.value.length;
  return len >= NAME_MIN && len <= NAME_MAX;
});

const touched = ref<boolean>(false);

const showError = computed<boolean>(() => touched.value && !isValid.value);

const errorText = computed<string>(() => {
  const len = trimmed.value.length;
  if (len < NAME_MIN) return '名字不可為空白';
  if (len > NAME_MAX) return `名字長度不可超過 ${NAME_MAX} 個字元`;
  return '';
});

function onSubmit(): void {
  touched.value = true;
  if (!isValid.value) return;
  emit('confirm', trimmed.value);
}
</script>

<style scoped>
.name-entry {
  display: grid;
  gap: 0.75rem;
  max-width: 28rem;
  margin: 2rem auto;
}

.label {
  font-weight: 600;
}

.input {
  padding: 0.625rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  outline: none;
}

.input[aria-invalid='true'] {
  border-color: #ef4444;
}

.btn {
  padding: 0.625rem 0.75rem;
  border: none;
  border-radius: 0.5rem;
  background: #111827;
  color: #ffffff;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  color: #ef4444;
  font-size: 0.875rem;
}

.hint {
  color: #6b7280;
  font-size: 0.875rem;
}
</style>
