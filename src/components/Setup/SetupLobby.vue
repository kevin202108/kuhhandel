<template>
  <div class="setup-lobby">
    <h1>幕後交易 KUHHANDEL</h1>

    <!-- NameEntry when displayName is not set -->
    <div v-if="!hasDisplayName" class="panel">
      <h2>Enter Your Display Name</h2>
      <div class="players-setup">
        <SetupForm @confirm="onNameConfirm" />
        <p class="hint">Display name is for UI only (max 12 chars).</p>
      </div>
    </div>

    <!-- Lobby when already joined -->
    <div v-else class="panel">
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
        <button class="secondary" @click="refreshPresence">Refresh</button>
        <button class="primary" :disabled="!canStartOnline" @click="onStartGame">Start Game (Host)</button>
      </div>
      <p class="hint">至少需要兩名玩家，由房主開始遊戲。</p>
    </div>
  </div>
  
  
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import SetupForm from '@/components/SetupForm.vue';
import { useGameStore } from '@/store/game';
import broadcast from '@/services/broadcast';

type Member = { id: string; data?: { playerId: string; name: string } };

const emit = defineEmits<{ 'start-game': [] }>();

const game = useGameStore();

// Local identity and room label
const url = new URL(location.href);
const myId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '');
const roomId = (url.searchParams.get('room') ?? 'dev').toLowerCase().trim();
const hasDisplayName = !!(sessionStorage.getItem('displayName') || '');

// Presence members
const members = ref<Member[]>([]);
async function refreshPresence() {
  try { members.value = await broadcast.presence().getMembers(); } catch { /* ignore */ }
}

// Host label (prefer game.hostId when present)
const hostIdLabel = computed(() => game.hostId || members.value.map(m => m.id).sort()[0] || '');

// Start gating (Host only, >=2 members)
const canStartOnline = computed(() => (hostIdLabel.value === myId) && members.value.length >= 2);

// NameEntry confirm (store then reload)
function onNameConfirm(name: string) {
  const t = (name || '').trim().slice(0, 12);
  if (!t) return;
  try { sessionStorage.setItem('displayName', t); } catch { /* ignore */ }
  location.reload();
}

function onStartGame() {
  emit('start-game');
}

onMounted(() => {
  void refreshPresence();
  const t = window.setInterval(() => { void refreshPresence(); }, 1200);
  (window as any).__setupPresenceTimer = t;
});

onUnmounted(() => {
  const t = (window as any).__setupPresenceTimer as number | undefined;
  if (t) window.clearInterval(t);
});

</script>

<style scoped>
.setup-lobby { padding: 16px; }

.panel {
  background: #121a33;
  border: 1px solid #223055;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
}

.players-setup .player-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
}
.players-setup input {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #2a3b66;
  background: #0f1630;
  color: #e7e9ee;
}

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
.badge {
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 9999px;
  background: #eef2f7;
  color: #1f2937;
  font-size: 12px;
}

button {
  appearance: none;
  border: 1px solid #35508a;
  background: #1a2748;
  color: #e7e9ee;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
}
button.primary { background: #2a5ad1; border-color: #2a5ad1; }
button.secondary { background: #203258; }
button:disabled { opacity: .5; cursor: not-allowed; }
</style>

