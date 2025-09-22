<script setup lang="ts">
import { computed, defineProps, defineEmits } from 'vue';

type Member = { id: string; data?: { playerId: string; name: string } };

const props = defineProps<{
  roomId: string;
  myId: string;
  members: Member[];
  hostIdLabel: string;
  canStartOnline: boolean;
}>();

defineEmits<{
  'refresh-presence': [];
  'start-game': [];
}>();

// Computed
const computedCanStart = computed(() => (props.hostIdLabel === props.myId) && props.members.length >= 2);
</script>

<template>
  <div class="panel">
    <h2>Lobby (room: {{ roomId }})</h2>
    <p class="hint">Host: <code>{{ hostIdLabel }}</code></p>
    <ul class="plist">
      <li v-for="m in members" :key="m.id">
        <strong>{{ m.data?.name || m.id }}</strong> <code>({{ m.id }})</code>
        <span v-if="m.id === hostIdLabel" class="badge">Host</span>
        <span v-if="m.id === myId" class="badge">You</span>
      </li>
    </ul>
    <div class="setup-actions">
      <button class="secondary" @click="$emit('refresh-presence')">Refresh</button>
      <button
        class="primary"
        :disabled="!computedCanStart"
        @click="$emit('start-game')">
        Start Game (Host)
      </button>
    </div>
    <p class="hint">Requires at least 2 members; only Host can start.</p>
  </div>
</template>

<style scoped>
/* Lobby styles can be added if needed */
</style>
