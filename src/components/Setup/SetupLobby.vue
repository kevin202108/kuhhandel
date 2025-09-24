<template>
  <div class="setup-lobby">
    <h1>幕後交易 KUHHANDEL</h1>

    <!-- NameEntry when displayName or roomId is not set -->
    <div v-if="!hasDisplayName || !hasRoom" class="ui-panel">
      <h2>Enter Your Name & Room</h2>
      <div class="players-setup">
        <div class="player-row">
          <input
            v-model.trim="name"
            placeholder="Your name（最多 12 字，任意字元）"
            maxlength="12"
          />
        </div>
        <div class="player-row">
          <input
            v-model.trim="room"
            placeholder="Room（最多 12 字，任意字元）"
            maxlength="12"
          />
        </div>
        <div class="player-row">
          <button class="ui-btn is-primary" :disabled="!canSubmit" @click="submitName">Join</button>
        </div>
        <p class="hint">Both display name and room accept any characters, max 12.</p>
      </div>
    </div>

    <!-- Lobby when already joined -->
    <div v-else class="ui-panel">
      <h2>大廳 (房間: {{ roomId }})</h2>
      <p class="hint">房主: <code>{{ hostIdLabel }}</code></p>
      <ul class="plist">
        <li v-for="m in members" :key="m.id">
          <strong>{{ m.data?.name || m.id }}</strong> <code>({{ m.id }})</code>
          <span v-if="m.id === hostIdLabel" class="badge">房主</span>
          <span v-if="m.id === myId" class="badge">你</span>
        </li>
      </ul>
      <div class="setup-actions">
        <button class="ui-btn is-secondary" @click="refreshPresence">Refresh</button>
        <button class="ui-btn is-primary" :disabled="!canStartOnline" @click="onStartGame">Start Game (Host)</button>
      </div>
      <p class="hint">至少需要兩名玩家，由房主開始遊戲。</p>
    </div>
  </div>
  
  
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useGameStore } from '@/store/game';
import broadcast from '@/services/broadcast';

type Member = { id: string; data?: { playerId: string; name: string } };

const emit = defineEmits<{ 'start-game': [] }>();

const game = useGameStore();

// Local identity and room label
const myId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '');
const roomId = (sessionStorage.getItem('roomId') || '').slice(0, 12);
const hasDisplayName = !!(sessionStorage.getItem('displayName') || '');
const hasRoom = !!roomId;

// Inline form state
const name = ref('');
const room = ref('');
const canSubmit = computed(() => {
  const n = name.value.trim();
  const r = room.value.trim();
  return n.length > 0 && n.length <= 12 && r.length > 0 && r.length <= 12;
});

// Presence members
const members = ref<Member[]>([]);
async function refreshPresence() {
  try { members.value = await broadcast.presence().getMembers(); } catch { /* ignore */ }
}

// Host label (prefer game.hostId when present)
const hostIdLabel = computed(() => game.hostId || members.value.map(m => m.id).sort()[0] || '');

// Start gating (Host only, >=2 members)
const canStartOnline = computed(() => (hostIdLabel.value === myId) && members.value.length >= 2);

// NameEntry confirm (store name + room then reload)
function submitName() {
  if (!canSubmit.value) return;
  const n = name.value.trim().slice(0, 12);
  const r = room.value.trim().slice(0, 12);
  try {
    sessionStorage.setItem('displayName', n);
    sessionStorage.setItem('roomId', r);
  } catch { /* ignore */ }
  (globalThis as any).__ROOM__ = r;
  location.reload();
}

function onStartGame() {
  emit('start-game');
}

onMounted(() => {
  if (hasRoom) {
    void refreshPresence();
    const t = window.setInterval(() => { void refreshPresence(); }, 1200);
    (window as any).__setupPresenceTimer = t;
  }
});

onUnmounted(() => {
  const t = (window as any).__setupPresenceTimer as number | undefined;
  if (t) window.clearInterval(t);
});

</script>

<style scoped>
.setup-lobby { padding: 16px; }

/* Panel styling provided by .ui-panel (global) */

.players-setup .player-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
}
.players-setup input { flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-text); }

.setup-actions {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.hint { opacity: .75; margin-top: 4px; font-size: 12px; }

.plist {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}
.badge { margin-left: 6px; padding: 2px 6px; border-radius: 9999px; background: var(--c-surface-2); color: var(--c-text); border: 1px solid var(--c-border); font-size: 12px; }

/* Buttons standardized via .ui-btn classes */
</style>

