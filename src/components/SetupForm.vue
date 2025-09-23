<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useIdentityStore } from '@/store/identity';
import { startNetworking } from '@/networking/bootstrap';

const identity = useIdentityStore();

const roomInput = ref('');
const nameInput = ref('');
const error = ref<string | null>(null);

function normalizeId(raw: string): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
}

const canSubmit = computed(() => {
  const room = normalizeId(roomInput.value);
  const name = (nameInput.value ?? '').trim();
  return room.length > 0 && name.length > 0 && name.length <= 12;
});

watchEffect(() => {
  error.value = null;
});

async function onSubmit(e: Event) {
  e.preventDefault();
  const room = normalizeId(roomInput.value);
  const name = (nameInput.value ?? '').trim().slice(0, 12);
  if (!room) { error.value = '房號僅可用 a-z0-9_-（最多24）'; return; }
  if (!name) { error.value = '玩家名稱不可為空'; return; }
  if (name.length > 12) { error.value = '玩家名稱最長 12 字'; return; }

  const playerId = identity.ensurePlayerId(room);
  identity.setIdentity({ roomId: room, playerId, displayName: name });

  try {
    await startNetworking();
    identity.markJoined();
  } catch (err) {
    error.value = '連線失敗，請稍後再試';
    // eslint-disable-next-line no-console
    console.error('[SetupForm] startNetworking failed:', err);
  }
}
</script>

<template>
  <form class="setup-form" @submit="onSubmit">
    <div class="row">
      <label>
        房號
        <input
          v-model.trim="roomInput"
          placeholder="room (a-z0-9_-)"
          maxlength="24"
          autocomplete="off"
        />
      </label>
    </div>
    <div class="row">
      <label>
        玩家名稱
        <input
          v-model="nameInput"
          placeholder="你的顯示名稱"
          maxlength="12"
          autocomplete="off"
        />
      </label>
    </div>
    <div class="actions">
      <button class="primary" type="submit" :disabled="!canSubmit">加入房間</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
  </form>
</template>

<style scoped>
.setup-form { display: grid; gap: 10px; }
.row { display: grid; gap: 6px; }
label { font-size: 12px; color: #9ca3af; }
input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #2a3b66;
  background: #0f1630;
  color: #e7e9ee;
}
.actions { margin-top: 8px; }
.primary {
  appearance: none;
  border: 1px solid #2a5ad1;
  background: #2a5ad1;
  color: #fff;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
}
.error { color: #ef4444; font-size: 12px; margin: 0; }
</style>

