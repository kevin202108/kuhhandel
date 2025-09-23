<template>
  <section class="view game-end">
    <div class="panel">
      <h2>🎉 遊戲結束 🎉</h2>

      <!-- 最終排名 -->
      <div class="final-scores">
        <h3>最終排名</h3>
        <ol class="scores-list">
          <li
            v-for="(score, index) in finalScores"
            :key="score.playerId"
            class="score-item"
            :class="{
              'first-place': index === 0,
              'second-place': index === 1,
              'third-place': index === 2,
              'current-player': score.playerId === currentPlayerId
            }"
          >
            <div class="rank-badge">
              #{{ index + 1 }}
            </div>
            <div class="player-info">
              <div class="player-name">{{ score.playerId }}</div>
              <div class="score-value">{{ score.score }} 分</div>
            </div>
          </li>
        </ol>
      </div>

      <!-- 重新開始按鈕 -->
      <div class="actions">
        <button class="primary" @click="onRestart">
          🔄 重新開始遊戲
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Player } from '@/types/game'

interface ScoreItem {
  playerId: string
  score: number
}

const props = defineProps<{
  finalScores: ScoreItem[]
}>()

const emit = defineEmits<{
  'reset': []
}>()

// 從 URL 獲取當前玩家 ID
const currentPlayerId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '')

function onRestart() {
  emit('reset')
}
</script>

<style scoped>
.view {
  padding: 16px;
  max-width: 600px;
  margin: 0 auto;
}

.panel {
  background: #121a33;
  border: 1px solid #223055;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  text-align: center;
}

h2 {
  color: #fbbf24;
  font-size: 2rem;
  margin-bottom: 24px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.final-scores {
  margin-bottom: 32px;
}

h3 {
  color: #e7e9ee;
  margin-bottom: 16px;
  font-size: 1.2rem;
}

.scores-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.score-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: #1e293b;
  border-radius: 8px;
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.score-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.first-place {
  background: linear-gradient(135deg, #ffd700, #ffb347);
  border-color: #ffd700;
  box-shadow: 0 4px 12px rgba(255, 215, 0, 0.4);
}

.second-place {
  background: linear-gradient(135deg, #c0c0c0, #a8a8a8);
  border-color: #c0c0c0;
  box-shadow: 0 4px 12px rgba(192, 192, 192, 0.3);
}

.third-place {
  background: linear-gradient(135deg, #cd7f32, #a0522d);
  border-color: #cd7f32;
  box-shadow: 0 4px 12px rgba(205, 127, 50, 0.3);
}

.current-player {
  border-color: #10b981 !important;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.rank-badge {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #374151;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.1rem;
  color: #e7e9ee;
  margin-right: 16px;
  border: 2px solid #4b5563;
}

.first-place .rank-badge {
  background: #ffd700;
  border-color: #ffb347;
  color: #1f2937;
}

.second-place .rank-badge {
  background: #c0c0c0;
  border-color: #a8a8a8;
  color: #1f2937;
}

.third-place .rank-badge {
  background: #cd7f32;
  border-color: #a0522d;
  color: #ffffff;
}

.current-player .rank-badge {
  border-color: #10b981;
}

.player-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: 1;
}

.player-name {
  font-weight: 600;
  color: #e7e9ee;
  font-size: 1.1rem;
}

.first-place .player-name,
.second-place .player-name,
.third-place .player-name {
  color: #1f2937;
}

.score-value {
  font-weight: bold;
  font-size: 1.2rem;
  color: #fbbf24;
}

.first-place .score-value {
  color: #1f2937;
}

.actions {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

.primary {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border: none;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
}

.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.6);
}

.primary:active {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
}

/* 響應式設計 */
@media (max-width: 480px) {
  .panel {
    padding: 16px;
  }

  h2 {
    font-size: 1.5rem;
  }

  .score-item {
    padding: 10px 12px;
  }

  .rank-badge {
    width: 35px;
    height: 35px;
    font-size: 1rem;
    margin-right: 12px;
  }

  .player-name {
    font-size: 1rem;
  }

  .score-value {
    font-size: 1.1rem;
  }

  .primary {
    padding: 10px 20px;
    font-size: 0.9rem;
  }
}
</style>
