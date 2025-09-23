<template>
  <div class="auction-container">
    <!-- 拍賣競標階段 -->
    <section v-if="phase === 'auction.bidding'" class="view auction">
      <h2>拍賣競標</h2>

      <!-- 拍賣品資訊 -->
      <div class="auction-info">
        <div class="auctioneer-info">
          <strong>{{ auctioneerName }}</strong> <span class="badge">拍賣者</span>
        </div>
        <div class="auction-item">
          <span class="animal-name">{{ game.auction?.card?.animal }}</span>
        </div>
        <div class="current-bid">
          目前最高： <strong>{{ game.auction?.highest?.total ?? 0 }}</strong>
          <span v-if="game.auction?.highest">
            ({{ highestBidderName }})
          </span>
        </div>
      </div>

      <!-- 競標區域 -->
      <div class="bidding-area">
        <AuctionBidderView
          v-if="isCurrentPlayer && currentPlayer"
          :self="currentPlayer"
          :highest="game.auction?.highest"
          :nameOf="nameOf"
          @place-bid="onPlaceBid"
          @pass="onPassBid"
        />
        <div v-else class="waiting-message">
          等待 {{ currentPlayerName }} 出價...
        </div>
      </div>
    </section>

    <!-- 拍賣結算階段 -->
    <section v-else-if="phase === 'auction.closing'" class="view auction">
      <h2>拍賣結算</h2>
      <div class="closing-info">
        <p>拍賣品：{{ game.auction?.card?.animal }}</p>
        <p>最終價格：{{ game.auction?.highest?.total ?? 0 }}</p>
        <p>得標者：{{ highestBidderName }}</p>
      </div>

      <!-- 拍賣者決定區域 -->
      <div v-if="isAuctioneer" class="auctioneer-actions">
        <AuctionHostView
          :highest="game.auction?.highest"
          :canBuyback="canBuyback"
          @award="onHostAward"
          @buyback="onHostBuyback"
        />
      </div>
      <div v-else class="waiting-message">
        等待拍賣者決定...
      </div>
    </section>

    <!-- 買回階段 -->
    <section v-else-if="phase === 'auction.buyback'" class="view auction">
      <h2>拍賣買回</h2>

      <div v-if="isAuctioneer" class="buyback-area">
        <div class="buyback-info">
          <p>選擇金錢卡支付 {{ game.auction?.highest?.total }} 以買回 {{ game.auction?.card?.animal }}</p>
        </div>
        <MoneyPad
          :moneyCards="auctioneerMoneyCards"
          :selectedIds="selectedMoneyIds"
          @toggle="onToggleMoneyCard"
        />
        <div class="buyback-actions">
          <button
            class="primary"
            :disabled="!canConfirmBuyback"
            @click="onConfirmBuyback"
          >
            確認買回
          </button>
          <button class="secondary" @click="onCancelBuyback">取消</button>
        </div>
      </div>
      <div v-else class="waiting-message">
        等待拍賣者決定買回...
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '@/store/game'
import { useAuctionStore } from '@/store/auction'
import AuctionBidderView from '@/components/Auction/AuctionBidderView.vue'
import AuctionHostView from '@/components/Auction/AuctionHostView.vue'
import MoneyPad from '@/components/MoneyPad.vue'
import { useIdentityStore } from '@/store/identity'

const props = defineProps<{
  phase: string
}>()

const emit = defineEmits<{
  'place-bid': [moneyCardIds: string[]]
  'pass-bid': []
  'host-award': []
  'host-buyback': []
  'confirm-buyback': [moneyCardIds: string[]]
  'cancel-buyback': []
}>()

// Store
const game = useGameStore()
const auction = useAuctionStore()

// 從 Identity 取得當前玩家 ID
const myId = useIdentityStore().playerId

// 本地狀態
const selectedMoneyIds = ref<string[]>([])

// 計算屬性
const isCurrentPlayer = computed(() => myId === game.turnOwnerId)
const currentPlayer = computed(() => game.players.find(p => p.id === game.turnOwnerId))
const currentPlayerName = computed(() => currentPlayer.value?.name || '玩家')
const isAuctioneer = computed(() => myId === auction.auction?.auctioneerId)
const canBuyback = computed(() => auction.canAuctioneerBuyback)

const auctioneerName = computed(() => {
  const auctioneer = game.players.find(p => p.id === auction.auction?.auctioneerId)
  return auctioneer?.name || '拍賣者'
})

const highestBidderName = computed(() => {
  const highestBidder = game.players.find(p => p.id === game.auction?.highest?.playerId)
  return highestBidder?.name || '無人'
})

const auctioneerMoneyCards = computed(() => {
  const auctioneer = game.players.find(p => p.id === auction.auction?.auctioneerId)
  return auctioneer?.moneyCards || []
})

const selectedMoneyTotal = computed(() => {
  return selectedMoneyIds.value.reduce((sum, id) => {
    const card = auctioneerMoneyCards.value.find(c => c.id === id)
    return sum + (card?.value || 0)
  }, 0)
})

const canConfirmBuyback = computed(() => {
  return selectedMoneyTotal.value >= (game.auction?.highest?.total || 0)
})

function nameOf(id: string): string {
  return game.players.find(p => p.id === id)?.name || id
}

// 事件處理
function onPlaceBid(moneyCardIds: string[]) {
  emit('place-bid', moneyCardIds)
}

function onPassBid() {
  emit('pass-bid')
}

function onHostAward() {
  emit('host-award')
}

function onHostBuyback() {
  emit('host-buyback')
}

function onToggleMoneyCard(cardId: string) {
  const index = selectedMoneyIds.value.indexOf(cardId)
  if (index > -1) {
    selectedMoneyIds.value.splice(index, 1)
  } else {
    selectedMoneyIds.value.push(cardId)
  }
}

function onConfirmBuyback() {
  emit('confirm-buyback', selectedMoneyIds.value)
}

function onCancelBuyback() {
  emit('cancel-buyback')
}
</script>

<style scoped>
.auction-container {
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
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}

.auction-info {
  background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
  border: 2px solid #60a5fa;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 15px 35px rgba(59, 130, 246, 0.4);
}

.badge {
  background: #f59e0b;
  color: #1f2937;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
}

.animal-name {
  color: #ffffff;
  font-size: 24px;
  font-weight: 800;
}

.current-bid {
  color: #e0e7ff;
  margin-top: 8px;
}

.waiting-message {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
}

.bidding-area {
  margin-top: 16px;
}

.closing-info {
  background: #2d3748;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.auctioneer-actions {
  margin-top: 16px;
}

.buyback-area {
  margin-top: 16px;
}

.buyback-info {
  background: #1e3a8a;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.buyback-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 20px;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.primary {
  background: #10b981;
  color: white;
}

.primary:disabled {
  background: #6b7280;
  cursor: not-allowed;
}

.secondary {
  background: #374151;
  color: #f9fafb;
  border: 1px solid #4b5563;
}

button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
</style>
