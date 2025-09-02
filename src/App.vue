<script setup lang="ts">
import { ref } from 'vue';

/**
 * 這裡暫以本地狀態表示 phase，對應 README 的 Phase 定義。
 * 後續接上 store 時，可改為：
 *   import { useGameStore } from '@/store/game';
 *   const game = useGameStore();
 *   const phase = computed(() => game.phase);
 *   const start = () => game.startTurn();
 */
type Phase =
  | 'setup' | 'turn.choice'
  | 'auction.bidding' | 'auction.closing' | 'auction.settlement'
  | 'cow.selectTarget' | 'cow.selectAnimal' | 'cow.commit' | 'cow.reveal' | 'cow.settlement'
  | 'turn.end' | 'game.end';

const phase = ref<Phase>('setup');

function startGame() {
  // 未接上 store 前的最小流程：按鈕把 phase 從 'setup' 切到 'turn.choice'
  if (phase.value === 'setup') {
    phase.value = 'turn.choice';
  }
}
</script>

<template>
  <main style="min-height: 100vh; display: grid; place-items: center; padding: 2rem;">
    <section style="max-width: 560px; width: 100%; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.5rem;">
      <h1 style="margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 700;">
        Multiplayer Auction + Cow Trade
      </h1>
      <p style="margin: 0 0 1rem; color: #6b7280; font-size: 0.95rem;">
        目前階段（phase）：<strong>{{ phase }}</strong>
      </p>

      <button
        :disabled="phase !== 'setup'"
        @click="startGame"
        style="
          display:inline-flex; align-items:center; gap:.5rem;
          padding:.6rem 1rem; border:1px solid #111827; border-radius: .5rem;
          background:#111827; color:#fff; cursor:pointer; font-weight:600;
          opacity: var(--btn-opacity, 1);
        "
        :style="phase !== 'setup' ? '--btn-opacity: .5; cursor: not-allowed; background:#374151; border-color:#374151;' : ''"
        aria-label="開始遊戲"
      >
        ▶ 開始遊戲
      </button>

      <p style="margin-top: 1rem; color:#9ca3af; font-size:.85rem;">
        此為最小殼：僅顯示 phase 與開始鈕。之後接上 Pinia 的 game store 後，按鈕將呼叫 <code>setupGame</code>/<code>startTurn</code>。
      </p>
    </section>
  </main>
</template>

<style scoped>
/* 簡單的可讀性微調；實際樣式以 assets/main.css 為準 */
code { background: #f3f4f6; padding: .1rem .3rem; border-radius: .25rem; }
</style>
