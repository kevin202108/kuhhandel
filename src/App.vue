<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { storeToRefs } from 'pinia';

import NameEntry from '@/components/Entry/NameEntry.vue';
import Lobby from '@/components/Entry/Lobby.vue';
import Hud from '@/components/Hud.vue';
import TurnChoice from '@/components/TurnChoice.vue';

import type { Player, Phase } from '@/types/game';
import { Msg } from '@/networking/protocol';
import type { IBroadcast } from '@/services/broadcast';
import { useGameStore } from '@/store/game';

/** -------- 依賴注入（由 main.ts provide） -------- */
const _broadcast = inject<IBroadcast>('broadcast');
if (!_broadcast) {
  throw new Error('[App] broadcast is not provided. Please provide IBroadcast in main.ts');
}
const broadcast: IBroadcast = _broadcast;

const _selfId = inject<string>('selfId');
if (!_selfId) {
  throw new Error('[App] selfId is not provided. Please provide playerId in main.ts');
}
const selfId: string = _selfId;

/** -------- Pinia 狀態（唯讀於 UI，勿直接改動） -------- */
const game = useGameStore();
const { phase, players, hostId, turnOwnerId, deck, log } = storeToRefs(game);

/** -------- 是否已加入（presence.enter 完成後才視為加入） -------- */
const hasJoined = ref(false);

/** -------- 衍生狀態 -------- */
const deckCount = computed<number>(() => deck.value.length);

const isFirstRound = computed<boolean>(() => {
  // 第一回合：無人持有任何動物
  const sumAnimals = (p: Player): number =>
    (Object.values(p.animals) as number[]).reduce((a, b) => a + b, 0);
  return players.value.length > 0 && players.value.every((p) => sumAnimals(p) === 0);
});

const canChooseAuction = computed<boolean>(() => game.canChooseAuction);
const canChooseCowTrade = computed<boolean>(() => game.canChooseCowTrade);

/** -------- NameEntry 事件 -------- */
function onConfirmName(name: string): void {
  void (async () => {
    await broadcast.presence().enter({ playerId: selfId, name });
    await broadcast.publish(Msg.System.Join, { playerId: selfId, name });
    hasJoined.value = true;
  })();
}

/** -------- Lobby（Host 專屬） -------- */
function onStartGame(): void {
  void broadcast.publish(Msg.Action.StartGame, { playerId: selfId });
}

/** -------- TurnChoice -------- */
function onChooseAuction(): void {
  void broadcast.publish(Msg.Action.ChooseAuction, { playerId: selfId });
}
function onChooseCowTrade(): void {
  void broadcast.publish(Msg.Action.ChooseCowTrade, { playerId: selfId });
}

/** -------- 切頁條件（NameEntry / Lobby / Game） -------- */
const shouldShowNameEntry = computed<boolean>(() => !hasJoined.value);
const shouldShowLobby = computed<boolean>(() => hasJoined.value && phase.value === 'setup');
const shouldShowGame = computed<boolean>(() => hasJoined.value && phase.value !== 'setup');

// 專供 <Lobby v-bind="..."> 使用：必填的 players/selfId 一定有，hostId 僅在為 string 時才加上
const lobbyBindProps = computed<
  { players: Player[]; selfId: string } & ({} | { hostId: string })
>(() => {
  const base = { players: players.value, selfId };
  return hostId && hostId.value && typeof hostId.value === 'string' ? { ...base, hostId: hostId.value } : base;
});


// 讓模板少轉型
const currentPhase = computed<Phase>(() => phase.value);
</script>

<template>
  <!-- 1) 尚未加入：NameEntry（只輸入自己的名字，送出即 join） -->
  <NameEntry v-if="shouldShowNameEntry" @confirm="onConfirmName" />

  <!-- 2) 已加入且 phase='setup'：Lobby（只有 Host 看得到開始遊戲按鈕） -->
  <Lobby
  v-else-if="shouldShowLobby"
  v-bind="lobbyBindProps"
  @start-game="onStartGame"
  />

  <!-- 3) 其他 phase：遊戲頁（HUD + 本回合選擇） -->
  <div v-else class="game-shell">
    <Hud
      :players="players"
      :turn-owner-id="turnOwnerId"
      :deck-count="deckCount"
      :phase="currentPhase"
      :log="log"
    />

    <TurnChoice
      v-if="currentPhase === 'turn.choice'"
      :can-auction="canChooseAuction"
      :can-cow-trade="canChooseCowTrade"
      :is-first-round="isFirstRound"
      @choose-auction="onChooseAuction"
      @choose-cow-trade="onChooseCowTrade"
    />
  </div>
</template>

<style scoped>
.game-shell {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 12px;
  padding: 12px;
}
</style>
