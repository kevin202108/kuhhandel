<script setup lang="ts">
import { ref, computed, defineEmits } from 'vue';

// Emits
const emit = defineEmits<{
  configured: []
}>();

// State
const apiKeyInput = ref('');
const nameInput = ref('');
const ID_RE = /^[a-z0-9_-]{1,24}$/;

// Computed
const canConfigure = computed(() => {
  const apiKeyValid = apiKeyInput.value.trim().length > 10; // Basic API key length check
  const nameValid = ID_RE.test(nameInput.value.trim().toLowerCase());
  return apiKeyValid && nameValid;
});

// Methods
function configureAndJoin() {
  if (!canConfigure.value) return;

  // Save to localStorage
  localStorage.setItem('ably-api-key', apiKeyInput.value.trim());
  localStorage.setItem('player-configured', 'true');

  // Reset form
  apiKeyInput.value = '';
  nameInput.value = '';

  // Emit configured event
  emit('configured');
}
</script>

<template>
  <div class="panel">
    <h2>Setup Your Game</h2>
    <div class="players-setup">
      <div class="input-row">
        <label>Ably API Key:</label>
        <input
          v-model.trim="apiKeyInput"
          placeholder="Your Ably API key (from ably.io)..."
          type="password" />
      </div>
      <div class="input-row">
        <label>Your Name:</label>
        <input
          v-model.trim="nameInput"
          placeholder="your-name (a-z0-9_-)"
          maxlength="16" />
      </div>
      <div class="actions">
        <button
          class="primary"
          :disabled="!canConfigure"
          @click="configureAndJoin">
          Continue to Lobby
        </button>
      </div>
      <p class="hint">Enter your Ably API key and choose a player name to join the gaming room.</p>
    </div>
  </div>
</template>

<style scoped>
.input-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 12px 0;
}

.input-row label {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 12px;
}

.input-row input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-secondary);
  background: var(--bg-accent);
  color: var(--text-primary);
}

.input-row input[type="password"] {
  font-family: monospace;
}

.actions {
  margin-top: 16px;
}
</style>
