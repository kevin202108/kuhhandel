<template>
  <div class="cow-trade-container">
    <!-- 階段 1: 選擇目標玩家 (只有發起者能操作) -->
    <section v-if="phase === 'cow.selectTarget'" class="view cow-trade">
      <h2>🐄 牛交易：選擇對象</h2>

      <!-- 發起者視角 -->
      <div v-if="isInitiator" class="panel">
        <p>選擇你想要交易的玩家：</p>
        <CowTargetPicker
          @target-selected="onTargetSelected"
          @cancel="onCancel"
        />
      </div>

      <!-- 其他玩家視角 -->
      <div v-else class="panel waiting">
        <div class="muted">
          <p>{{ initiatorName }} 正在選擇交易對象...</p>
          <div class="spinner"></div>
        </div>
      </div>
    </section>

    <!-- 階段 2: 選擇交易動物 (只有發起者能操作) -->
    <section v-else-if="phase === 'cow.selectAnimal'" class="view cow-trade">
      <h2>🐄 牛交易：選擇動物</h2>

      <!-- 發起者視角 -->
      <div v-if="isInitiator" class="panel">
        <p>與 {{ targetName }} 交易哪種動物？</p>
        <CowAnimalPicker
          @animal-selected="onAnimalSelected"
          @cancel="onCancel"
        />
      </div>

      <!-- 目標玩家視角 -->
      <div v-else-if="isTarget" class="panel waiting">
        <div class="muted">
          <p>{{ initiatorName }} 正在選擇要交易的動物...</p>
          <div class="trade-preview">
            <p>交易對象：{{ initiatorName }}</p>
          </div>
        </div>
      </div>

      <!-- 其他玩家視角 -->
      <div v-else class="panel waiting">
        <div class="muted">
          <p>{{ initiatorName }} 正在與 {{ targetName }} 選擇交易動物...</p>
        </div>
      </div>
    </section>

    <!-- 階段 3: 秘密出價 (發起者和目標玩家都要操作) -->
    <section v-else-if="phase === 'cow.commit'" class="view cow-trade">
      <h2>🐄 牛交易：秘密出價</h2>

      <!-- 交易雙方視角 -->
      <div v-if="isParticipant" class="panel">
        <div class="trade-info">
          <p><strong>交易動物：</strong>{{ tradeAnimal }}</p>
          <p><strong>交易數量：</strong>{{ tradeAmount }} 隻</p>
          <p><strong>對手：</strong>{{ opponentName }}</p>
        </div>
        <CowConfirmBar
          @confirm="onConfirm"
          @cancel="onCancel"
        />
      </div>

      <!-- 其他玩家視角 -->
      <div v-else class="panel waiting">
        <div class="muted">
          <p>{{ initiatorName }} 和 {{ targetName }} 正在進行秘密出價...</p>
          <div class="trade-preview">
            <p>交易動物：{{ tradeAnimal }}</p>
            <p>交易數量：{{ tradeAmount }} 隻</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 階段 4: 結果揭曉 (所有人可見) -->
    <section v-else-if="phase === 'cow.reveal'" class="view cow-trade">
      <h2>🐄 牛交易：結果揭曉</h2>
      <div class="panel">
        <div class="reveal-info">
          <p><strong>交易動物：</strong>{{ tradeAnimal }}</p>
          <p><strong>交易數量：</strong>{{ tradeAmount }} 隻</p>
          <div class="bids-reveal">
            <div class="bid-item">
              <strong>{{ initiatorName }} 出價：</strong>{{ initiatorBid }}
            </div>
            <div class="bid-item">
              <strong>{{ targetName }} 出價：</strong>{{ targetBid }}
            </div>
          </div>
          <div class="result">
            <p v-if="winner === 'initiator'" class="winner">
              🎉 {{ initiatorName }} 獲勝！獲得 {{ tradeAmount }} 隻 {{ tradeAnimal }}
            </p>
            <p v-else-if="winner === 'target'" class="winner">
              🎉 {{ targetName }} 獲勝！獲得 {{ tradeAmount }} 隻 {{ tradeAnimal }}
            </p>
            <p v-else-if="winner === 'tie'" class="tie">
              🤝 平手，沒有動物交換
            </p>
            <p v-else class="muted">
              正在計算結果...
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 階段 5: 結算 (所有人可見) -->
    <section v-else-if="phase === 'cow.settlement'" class="view cow-trade">
      <h2>🐄 牛交易：結算完成</h2>
      <div class="panel">
        <div class="muted">交易已完成，遊戲繼續...</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/store/game'
import { useCowStore } from '@/store/cow'
import CowTargetPicker from './CowTargetPicker.vue'
import CowAnimalPicker from './CowAnimalPicker.vue'
import CowConfirmBar from './CowConfirmBar.vue'
import type { Animal } from '@/types/game'

const props = defineProps<{
  phase: string
}>()

const emit = defineEmits<{
  'target-selected': [targetId: string]
  'animal-selected': [animal: Animal]
  'confirm': [moneyCardIds: string[]]
  'cancel': []
}>()

// 從 URL 獲取當前玩家 ID
const url = new URL(location.href)
const myId = url.searchParams.get('player')?.toLowerCase().trim() || ''

const game = useGameStore()
const cow = useCowStore()

// 玩家角色判斷
const isInitiator = computed(() => myId === cow.initiatorId)
const isTarget = computed(() => myId === cow.targetPlayerId)
const isParticipant = computed(() => isInitiator.value || isTarget.value)

// 獲取玩家名稱的輔助函數
function getPlayerName(playerId: string): string {
  return game.players.find(p => p.id === playerId)?.name || playerId
}

// 計算屬性：玩家名稱
const initiatorName = computed(() => getPlayerName(cow.initiatorId || ''))
const targetName = computed(() => getPlayerName(cow.targetPlayerId || ''))
const opponentName = computed(() => {
  return isInitiator.value ? targetName.value : initiatorName.value
})

// 計算屬性：交易資訊
const tradeAnimal = computed(() => cow.targetAnimal || '未知')
const tradeAmount = computed(() => cow.tradeAmount)

// 出價資訊計算
const initiatorBid = computed(() => {
  if (!cow.initiatorSecret) return '?'
  const player = game.players.find(p => p.id === cow.initiatorId)
  if (!player) return '?'
  return cow.initiatorSecret.reduce((sum, id) => {
    const card = player.moneyCards.find(c => c.id === id)
    return sum + (card?.value || 0)
  }, 0)
})

const targetBid = computed(() => {
  if (!cow.targetSecret) return '?'
  const player = game.players.find(p => p.id === cow.targetPlayerId)
  if (!player) return '?'
  return cow.targetSecret.reduce((sum, id) => {
    const card = player.moneyCards.find(c => c.id === id)
    return sum + (card?.value || 0)
  }, 0)
})

// 勝者判斷
const winner = computed(() => {
  const initBid = initiatorBid.value
  const targBid = targetBid.value
  if (typeof initBid !== 'number' || typeof targBid !== 'number') return null
  if (initBid > targBid) return 'initiator'
  if (targBid > initBid) return 'target'
  return 'tie'
})

// 事件處理函數
function onTargetSelected(targetId: string) {
  emit('target-selected', targetId)
}

function onAnimalSelected(animal: Animal) {
  emit('animal-selected', animal)
}

function onConfirm(moneyCardIds: string[]) {
  emit('confirm', moneyCardIds)
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.cow-trade-container {
  padding: 16px;
  max-width: 800px;
  margin: 0 auto;
}

.view {
  margin-bottom: 16px;
}

.panel {
  background: #121a33;
  border: 1px solid #223055;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
}

.waiting {
  text-align: center;
  padding: 2rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 1rem auto;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  50% { transform: 50% 50%; }
  100% { transform: rotate(360deg); }
}

.trade-info {
  background: #1e3a8a;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.bids-reveal {
  display: flex;
  justify-content: space-between;
  margin: 1rem 0;
  gap: 1rem;
}

.bid-item {
  flex: 1;
  text-align: center;
  padding: 0.5rem;
  background: #374151;
  border-radius: 4px;
}

.winner {
  color: #10b981;
  font-size: 1.2rem;
  text-align: center;
  margin: 1rem 0;
  font-weight: bold;
}

.tie {
  color: #f59e0b;
  font-size: 1.2rem;
  text-align: center;
  margin: 1rem 0;
  font-weight: bold;
}

.muted {
  color: #6b7280;
  text-align: center;
}

.trade-preview {
  margin-top: 1rem;
  padding: 0.5rem;
  background: #2d3748;
  border-radius: 4px;
}
</style>
