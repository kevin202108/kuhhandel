<template>
  <section class="host-panel">
    <header class="host-header">
      <h3>主持人面板</h3>
      <small class="hint">結標、或（條件允許時）進行買回</small>
    </header>

    <div class="auctioneer-info">
      主持人持有金錢： <strong class="amount">{{ auctioneerTotalMoney }}</strong>
    </div>

    <div class="highest">
      <template v-if="highest">
        <div class="price">
          目前最高出價：
          <strong class="amount">{{ highest.total }}</strong>
        </div>
        <div class="meta">
          來自玩家 <code class="pid">{{ highest.playerId }}</code>
          <span class="ts">（ts: {{ formatTs(highest.ts) }}）</span>
        </div>
      </template>
      <template v-else>
        <div class="no-bid">目前無人出價，按「結標」將由主持人直接取得此牌。</div>
      </template>
    </div>

    <div class="actions">
      <button
        data-testid="btn-award"
        class="btn primary"
        type="button"
        @click="onAward"
      >
        結標：{{ highest ? '給最高出價者' : '由主持人取得' }}
      </button>

      <button
        data-testid="btn-buyback"
        class="btn"
        type="button"
        :disabled="!canBuyback || !highest"
        @click="onBuyback"
        :title="buybackDisabledReason"
      >
        主持人買回（支付大於等於最高出價）
      </button>
    </div>

    <details class="rules">
      <summary>規則提示</summary>
      <ul>
        <li>平手以主持人接收時間（ts）先到者為優先。</li>
        <li>無人出價時，主持人可直接結標拿牌。</li>
        <li>買回需主持人能以錢卡湊出等額，否則此按鈕會被停用。</li>
      </ul>
    </details>

    <!-- 買回確認對話框 -->
    <div v-if="showBuybackDialog" class="buyback-dialog">
      <div class="dialog-overlay" @click="cancelBuyback"></div>
      <div class="dialog-content">
        <h4>確認買回</h4>
        <p>選擇錢卡支付給最高出價者（需要大於等於 {{ highest?.total }}元）</p>

        <MoneyPad
          :money-cards="auctioneerMoneyCards"
          :selected-ids="selectedMoneyCardIds"
          @toggle="onToggleMoneyCard"
        />

        <div class="dialog-actions">
          <button class="btn secondary" @click="cancelBuyback">取消</button>
          <button class="btn primary" :disabled="!canConfirmBuyback" @click="confirmBuyback">
            確認買回（支付 {{ buybackTotal }}元）
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MoneyPad from '@/components/MoneyPad.vue';
import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import type { Bid, MoneyCard } from '@/types/game';

const props = defineProps<{
  highest?: Bid;
  canBuyback: boolean;
}>();

const emit = defineEmits<{
  (e: 'award'): void;
  (e: 'buyback', moneyCardIds: string[]): void;
}>();

const game = useGameStore();
const auction = useAuctionStore();

const showBuybackDialog = ref(false);
const selectedMoneyCardIds = ref<string[]>([]);

const auctioneerMoneyCards = computed(() => {
  console.log('🔍 AuctionHostView 渲染檢查:', {
    階段: game.phase,
    我是主持人: props.highest !== undefined, // 有highest prop表示我是主持人
    auction存在: !!auction.auction,
    auction物件: auction.auction,
    auctionStore狀態: {
      auction: auction.auction,
      canBuyback: auction.canAuctioneerBuyback
    },
    gameStore狀態: {
      auction: game.auction,
      phase: game.phase,
      players: game.players.length
    }
  });

  // 嘗試從 game.auction 獲取資料（因為可能auction store沒有同步）
  const auctionData = game.auction || auction.auction;
  const auctioneerId = auctionData?.auctioneerId;

  console.log('🔍 最終使用的 auction 資料:', {
    auctionData存在: !!auctionData,
    auctioneerId: auctioneerId,
    使用來源: game.auction ? 'game.auction' : 'auction.auction'
  });

  if (!auctioneerId) {
    console.log('⚠️ 沒有 auctioneerId，無法獲取主持人錢卡');
    return [];
  }

  const auctioneer = game.players.find(p => p.id === auctioneerId);
  const moneyCards = auctioneer?.moneyCards ?? [];

  // 添加詳細的錢卡資訊輸出
  console.log('💳 主持人錢卡詳細資訊:', {
    主持人ID: auctioneerId,
    主持人名稱: auctioneer?.name,
    錢卡數量: moneyCards.length,
    錢卡列表: moneyCards.map(card => ({
      ID: card.id,
      價值: card.value
    })),
    總金額: moneyCards.reduce((sum, card) => sum + card.value, 0)
  });

  return moneyCards;
});

const auctioneerTotalMoney = computed(() => {
  const total = auctioneerMoneyCards.value.reduce((sum: number, card) => sum + card.value, 0);
  console.log('🎭 主持人總金額:', total);
  return total;
});

const buybackTotal = computed(() => {
  const total = selectedMoneyCardIds.value
    .map(id => auctioneerMoneyCards.value.find(card => card.id === id)?.value ?? 0)
    .reduce((sum: number, value) => sum + value, 0);
  console.log('🛒 選中錢卡總和:', {
    選中錢卡數量: selectedMoneyCardIds.value.length,
    總金額: total,
    所需最低金額: props.highest?.total ?? 0,
    是否滿足條件: total >= (props.highest?.total ?? 0)
  });
  return total;
});

const canConfirmBuyback = computed(() => {
  const canConfirm = selectedMoneyCardIds.value.length > 0 &&
                    buybackTotal.value >= (props.highest?.total ?? 0);
  console.log('✅ 買回確認狀態:', {
    有選中錢卡: selectedMoneyCardIds.value.length > 0,
    總金額足夠: buybackTotal.value >= (props.highest?.total ?? 0),
    可以確認買回: canConfirm
  });
  return canConfirm;
});

function onAward() {
  emit('award');
}

function onBuyback() {
  if (!props.highest || !props.canBuyback) {
    console.log('❌ 無法開啟買回對話框:', {
      有最高出價: !!props.highest,
      可以買回: props.canBuyback,
      原因是: !props.highest ? '沒有出價' : '主持人錢不足'
    });
    return;
  }
  console.log('🔓 開啟買回對話框:', {
    最高出價: props.highest.total,
    主持人總金額: auctioneerTotalMoney.value
  });
  showBuybackDialog.value = true;
  selectedMoneyCardIds.value = [];
}

function onToggleMoneyCard(cardId: string) {
  const index = selectedMoneyCardIds.value.indexOf(cardId);
  if (index > -1) {
    selectedMoneyCardIds.value.splice(index, 1);
  } else {
    selectedMoneyCardIds.value.push(cardId);
  }
}

function cancelBuyback() {
  showBuybackDialog.value = false;
  selectedMoneyCardIds.value = [];
}

function confirmBuyback() {
  if (!canConfirmBuyback.value) return;
  emit('buyback', [...selectedMoneyCardIds.value]);
  showBuybackDialog.value = false;
  selectedMoneyCardIds.value = [];
}

function formatTs(ts: number) {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return String(ts);
  }
}

const buybackDisabledReason = computed<string>(() => {
  if (!props.highest) return '目前沒有出價，不可買回';
  if (!props.canBuyback) return '主持人錢卡不足，無法等額買回';
  return '';
});
</script>

<style scoped>
.host-panel {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  background: #fff;
  display: grid;
  row-gap: 10px;
}
.host-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.host-header h3 {
  margin: 0;
  font-size: 16px;
}
.hint {
  color: #6b7280;
}
.auctioneer-info {
  font-size: 14px;
  padding: 4px 8px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.highest .price {
  font-size: 14px;
  margin-bottom: 2px;
}
.amount {
  font-size: 18px;
}
.meta {
  color: #4b5563;
  font-size: 12px;
}
.pid {
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 6px;
}
.no-bid {
  color: #6b7280;
  font-style: italic;
}
.actions {
  display: flex;
  gap: 8px;
}
.btn {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid #d1d5db;
  background: #f9fafb;
  cursor: pointer;
  font-size: 14px;
}
.btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: white;
}
.rules summary {
  cursor: pointer;
  color: #374151;
}
.rules ul {
  margin: 6px 0 0;
  padding-left: 20px;
}

.buyback-dialog {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
}

.dialog-content {
  position: relative;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  max-width: 400px;
  width: 100%;
  margin: 20px;
}

.dialog-content h4 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
}

.dialog-content p {
  margin: 0 0 16px 0;
  color: #6b7280;
  font-size: 14px;
}

.dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 20px;
}

.secondary {
  background: #6b7280;
  border-color: #6b7280;
  color: white;
}
</style>
