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

    <!-- 階段 3: 秘密出價 (只有發起者操作) -->
    <section v-else-if="phase === 'cow.commit'" class="view cow-trade">
      <h2>🐄 牛交易：秘密出價</h2>

      <!-- 發起者視角 -->
      <div v-if="isInitiator" class="panel">
        <div class="trade-info">
          <p><strong>交易動物：</strong>{{ tradeAnimal }}</p>
          <p><strong>交易數量：</strong>{{ tradeAmount }} 隻</p>
          <p><strong>目標玩家：</strong>{{ targetName }}</p>
        </div>
        <CowConfirmBar
          :playerId="cow.initiatorId"
          @confirm="onConfirm"
          @cancel="onCancel"
        />
      </div>

      <!-- 目標玩家視角 -->
      <div v-else-if="isTarget" class="panel waiting">
        <div class="muted">
          <p>{{ initiatorName }} 正在出價...</p>
          <div class="trade-preview">
            <p>交易動物：{{ tradeAnimal }}</p>
            <p>交易數量：{{ tradeAmount }} 隻</p>
          </div>
        </div>
      </div>

      <!-- 其他玩家視角 -->
      <div v-else class="panel waiting">
        <div class="muted">
          <p>{{ initiatorName }} 正在向 {{ targetName }} 出價...</p>
          <div class="trade-preview">
            <p>交易動物：{{ tradeAnimal }}</p>
            <p>交易數量：{{ tradeAmount }} 隻</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 階段 4: 目標玩家選擇 (只有目標玩家操作) -->
    <section v-else-if="phase === 'cow.choose'" class="view cow-trade">
      <h2>🐄 牛交易：選擇回應</h2>

      <div v-if="isInitiator" class="panel waiting">
        <div class="muted">
          <p>{{ targetName }} 正在考慮是否接受出價...</p>
          <div class="bid-info">
            <p><strong>您的出價：</strong>{{ initiatorCardCount }} 張牌</p>
          </div>
        </div>
      </div>

      <div v-else-if="isTarget" class="panel">
        <div class="trade-info">
          <p><strong>交易動物：</strong>{{ tradeAnimal }}</p>
          <p><strong>交易數量：</strong>{{ tradeAmount }} 隻</p>
          <p><strong>對方出價：</strong>{{ initiatorCardCount }} 張牌</p>
        </div>
        <div class="choice-buttons">
          <button class="primary" @click="onAcceptOffer">接受出價</button>
          <button class="secondary" @click="onCounterOffer">提出回價</button>
        </div>
      </div>

      <div v-else class="panel waiting">
        <div class="muted">
          <p>{{ targetName }} 正在決定是否接受 {{ initiatorName }} 的出價...</p>
        </div>
      </div>
    </section>

    <!-- 階段 5: 目標玩家出價 (只有目標玩家操作) -->
    <section v-else-if="phase === 'cow.selectMoney'" class="view cow-trade">
      <h2>🐄 牛交易：回價</h2>

      <div v-if="isInitiator" class="panel waiting">
        <div class="muted">
          <p>{{ targetName }} 正在提出回價...</p>
          <div class="bid-info">
            <p><strong>您的出價：</strong>{{ initiatorCardCount }} 張牌</p>
          </div>
        </div>
      </div>

      <div v-else-if="isTarget" class="panel">
        <div class="trade-info">
          <p><strong>交易動物：</strong>{{ tradeAnimal }}</p>
          <p><strong>交易數量：</strong>{{ tradeAmount }} 隻</p>
          <p><strong>對方出價：</strong>{{ initiatorCardCount }} 張牌</p>
        </div>
        <CowConfirmBar
          :playerId="cow.targetPlayerId"
          @confirm="onCounterConfirm"
          @cancel="onCounterCancel"
        />
      </div>

      <div v-else class="panel waiting">
        <div class="muted">
          <p>{{ targetName }} 正在向 {{ initiatorName }} 提出回價...</p>
        </div>
      </div>
    </section>

    <!-- 階段 6: 結果揭曉 (所有人可見) -->
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
import { useCowTrade } from '@/composables/useCowTrade'
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
  'accept-offer': []
  'counter-offer': []
  'counter-confirm': [moneyCardIds: string[]]
  'counter-cancel': []
}>()

// 從 URL 獲取當前玩家 ID
const myId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '')

const game = useGameStore()
const cow = useCowStore()

// 玩家角色判斷 - 添加防護邏輯和調試
const isInitiator = computed(() => {
  // 如果 cow.initiatorId 存在，直接比較
  if (cow.initiatorId) {
    const result = myId === cow.initiatorId
    console.log('[DEBUG] isInitiator (direct):', { myId, cowInitiatorId: cow.initiatorId, result })
    return result
  }

  // 備用邏輯：如果當前玩家是回合擁有者，且處於牛交易相關階段，則假設是發起者
  const cowTradePhases = ['cow.selectTarget', 'cow.selectAnimal', 'cow.commit']
  if (cowTradePhases.includes(props.phase) && myId === game.turnOwnerId) {
    console.log('[DEBUG] isInitiator (fallback):', { myId, gameTurnOwnerId: game.turnOwnerId, phase: props.phase, result: true })
    return true
  }

  console.log('[DEBUG] isInitiator (default):', { myId, cowInitiatorId: cow.initiatorId, gameTurnOwnerId: game.turnOwnerId, phase: props.phase, result: false })
  return false
})

const isTarget = computed(() => {
  const result = myId === cow.targetPlayerId
  console.log('[DEBUG] isTarget:', { myId, cowTargetPlayerId: cow.targetPlayerId, result })
  return result
})

const isParticipant = computed(() => {
  const result = isInitiator.value || isTarget.value
  console.log('[DEBUG] isParticipant:', { isInitiator: isInitiator.value, isTarget: isTarget.value, result })
  return result
})

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

const initiatorCardCount = computed(() => {
  return cow.initiatorCardCount || 0
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

const targetCardCount = computed(() => {
  return cow.targetCardCount || 0
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

function onAcceptOffer() {
  emit('accept-offer')
}

function onCounterOffer() {
  emit('counter-offer')
}

function onCounterConfirm(moneyCardIds: string[]) {
  emit('counter-confirm', moneyCardIds)
}

function onCounterCancel() {
  emit('counter-cancel')
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

.choice-buttons {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-top: 1.5rem;
}

.choice-buttons button {
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.choice-buttons .primary {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
}

.choice-buttons .primary:hover {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
}

.choice-buttons .secondary {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
}

.choice-buttons .secondary:hover {
  background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4);
}
</style>
