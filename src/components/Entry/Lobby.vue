<template>
  <section class="lobby">
    <header class="lobby__header">
      <h2 class="lobby__title">Lobby</h2>
      <p class="lobby__subtitle">
        房內玩家（{{ playerCount }}）
        <span v-if="hostIdText" class="lobby__host-hint">｜主持人：{{ hostIdText }}</span>
        <span v-else class="lobby__host-hint--pending">｜正在決定主持人…</span>
      </p>
    </header>

    <ul class="lobby__list" role="list">
      <li
        v-for="p in players"
        :key="p.id"
        class="lobby__item"
        :aria-label="`玩家 ${p.name}`"
      >
        <span class="lobby__name">
          {{ p.name }}
          <small v-if="p.id === selfId" class="badge badge--me" aria-label="這是你">你</small>
        </span>

        <span class="lobby__badges">
          <small
            v-if="hostIdDefined && p.id === hostId"
            class="badge badge--host"
            aria-label="主持人"
            title="主持人（Host）"
            >HOST</small
          >
        </span>
      </li>
    </ul>

    <footer class="lobby__footer">
      <!-- Host 才看得到開始遊戲按鈕 -->
      <button
        v-if="isHost"
        class="btn btn--primary"
        type="button"
        :disabled="!playersInRange"
        :title="startDisabledReason ?? ''"
        aria-label="開始遊戲"
        @click="onStart"
      >
        開始遊戲
        <small v-if="!playersInRange" class="btn__hint">（需 2–5 人）</small>
      </button>

      <!-- 非 Host 顯示等待文案 -->
      <p v-else class="lobby__waiting" role="status">
        等待主持人開始遊戲…
      </p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Player } from '@/types/game';

interface Props {
  players: Player[];
  hostId?: string; // exactOptionalPropertyTypes: 需要顯式處理 undefined
  selfId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  /**
   * 僅在 Host 看到的按鈕上觸發。
   * 外層（例如 App.vue）接到此事件後，負責 publish 對應的 payload：
   *   type: Msg.Action.StartGame
   *   payload: { playerId: selfId }
   */
  'start-game': [];
}>();

// === 派生狀態 ===
const hostIdDefined = computed<boolean>(() => props.hostId !== undefined);
const isHost = computed<boolean>(() => hostIdDefined.value && props.selfId === props.hostId);
const playerCount = computed<number>(() => props.players.length);
const playersInRange = computed<boolean>(() => playerCount.value >= 2 && playerCount.value <= 5);

// 僅作為 UI 提示（title）；按鈕是否出現與禁用由 isHost / playersInRange 控制
const startDisabledReason = computed<string | undefined>(() => {
  if (!isHost.value) return '只有主持人可以開始遊戲';
  if (!playersInRange.value) return '人數需 2–5 人';
  return undefined;
});

const hostIdText = computed<string | undefined>(() => {
  // 僅顯示 id；如需顯示名字，外層可依 props.players 對應映射後改傳入
  return props.hostId;
});

// === 事件 ===
function onStart(): void {
  // 僅 Host 會看到此按鈕；再次防守性檢查
  if (!isHost.value) return;
  if (!playersInRange.value) return;
  emit('start-game');
}
</script>

<style scoped>
.lobby {
  display: grid;
  gap: 1rem;
  padding: 1rem 1.25rem;
}

.lobby__header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.lobby__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.lobby__subtitle {
  margin: 0;
  color: #666;
  font-size: 0.95rem;
}

.lobby__host-hint {
  color: #444;
}

.lobby__host-hint--pending {
  color: #a66;
}

.lobby__list {
  list-style: none;
  padding: 0;
  margin: 0;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
}

.lobby__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid #f0f2f5;
}
.lobby__item:last-child {
  border-bottom: none;
}

.lobby__name {
  font-weight: 600;
}

.lobby__badges {
  display: inline-flex;
  gap: 0.5rem;
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  line-height: 1.2;
  vertical-align: middle;
}

.badge--host {
  background: #ecfeff;
  color: #0369a1;
  border: 1px solid #bae6fd;
}

.badge--me {
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.lobby__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.btn {
  appearance: none;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #111827;
  padding: 0.55rem 1rem;
  border-radius: 0.6rem;
  cursor: pointer;
  font-weight: 600;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn--primary {
  background: #111827;
  color: #fff;
  border-color: #111827;
}

.btn__hint {
  margin-left: 0.35rem;
  font-weight: 500;
  opacity: 0.85;
}

.lobby__waiting {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
}
</style>
