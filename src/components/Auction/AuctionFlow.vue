<template>
  <div class="auction-flow">
    <!-- Auction: Bidding -->
    <section v-if="phase === 'auction.bidding'" class="view auction">
      <h2>Auction: Bidding</h2>

      <!-- Auctioneer: Fixed prominent display at top -->
      <div class="ui-panel is-accent">
        <div class="auctioneer-header">
          <strong>{{ nameOf(auctioneerId) }}</strong> <span class="auctioneer-badge">拍賣者</span>
        </div>
        <div class="auction-details">
          <div class="animal-display">
            <span class="label">拍賣動物：</span>
            <strong class="animal-name">{{ auctionAnimalName }} <span class="animal-points">{{ auctionAnimalScore }}</span></strong>
          </div>
          <div class="highest-bid">
            <span class="label">目前最高：</span>
            <strong class="highest-amount">{{ game.auction?.highest?.total ?? 0 }}</strong>
            <span v-if="game.auction?.highest" :key="bidderHighlightKey" class="highest-bidder-highlight">
              🚀 <strong>{{ nameOf(game.auction!.highest!.playerId) }}</strong> 領先中!
            </span>
            <span v-else class="no-bid">無人出價</span>
          </div>
        </div>
      </div>

      <div class="auction-grid">
        <div
          v-if="myPlayer && myId !== auctioneerId"
          class="auction-col"
        >
          <AuctionBidderView
            :self="myPlayer"
            :highest="game.auction?.highest"
            :nameOf="nameOf"
            @place-bid="(ids:string[]) => emit('place-bid', myId, ids)"
            @pass="() => emit('pass-bid', myId)"
          />
        </div>
      </div>
    </section>

    <!-- Auction: Closing -->
    <section v-else-if="phase === 'auction.closing'" class="view auction">
      <h2>Auction: Closing</h2>
      <div v-if="myId === auctioneerId" class="ui-panel">
        <AuctionHostView
          :highest="game.auction?.highest"
          :canBuyback="canBuyback"
          @award="() => emit('award')"
          @buyback="() => emit('buyback')"
        />
      </div>
      <div v-else class="ui-panel compact-host">
        <div class="muted">Waiting for host to settle…</div>
        <div>
          Highest: <strong>{{ game.auction?.highest?.total ?? 0 }}</strong>
          <span v-if="game.auction?.highest">
            by <code>{{ game.auction?.highest?.playerId }}</code>
          </span>
        </div>
      </div>
    </section>

    <!-- Auction: Buyback Money Selection -->
    <section v-else-if="phase === 'auction.buyback'" class="view auction">
      <h2>Auction: Buyback</h2>
      <div v-if="myId === auctioneerId" class="ui-panel">
        <div class="buyback-info">
          <p>選擇金錢卡支付 {{ game.auction?.highest?.total }} 以買回 {{ game.auction?.card?.animal }}</p>
          <div class="selected-total">
            已選擇總額：<strong>{{ selectedMoneyTotal }}</strong>
            <span v-if="selectedMoneyTotal < (game.auction?.highest?.total || 0)" class="insufficient">（不足）</span>
          </div>
        </div>

        <MoneyPad
          :moneyCards="auctioneerMoneyCards"
          :selectedIds="selectedMoneyIds"
          @toggle="onToggleMoneyCard"
        />

        <div class="actions">
          <button
            class="ui-btn is-primary"
            :disabled="selectedMoneyTotal < (game.auction?.highest?.total || 0)"
            @click="emit('confirm-buyback', selectedMoneyIds)"
          >
            確認買回
          </button>
          <button class="ui-btn is-secondary" @click="emit('cancel-buyback')">取消</button>
        </div>
      </div>
      <div v-else class="ui-panel compact-host">
        <div class="muted">Waiting for auctioneer to select money for buyback…</div>
      </div>
    </section>

    <!-- Auction: Reveal (all players) -->
    <section v-else-if="phase === 'auction.reveal'" class="view auction auction-reveal">
      <h2>Auction: Result</h2>
      <div class="ui-panel">
        <div class="reveal-info">
          <p><strong>動物：</strong>{{ auctionAnimalName }}</p>
          <template v-if="game.auction?.reveal?.mode === 'award'">
            <p>
              <strong>{{ nameOf(game.auction?.reveal?.payerId || '') }}</strong>
              取得 <strong>{{ auctionAnimalName }}</strong>
              ，支付 🪙<strong>{{ game.auction?.reveal?.amount }}</strong>
              給 <strong>{{ nameOf(game.auction?.reveal?.payeeId || '') }}</strong>
            </p>
          </template>
          <template v-else-if="game.auction?.reveal?.mode === 'buyback'">
            <p>
              拍賣者 <strong>{{ nameOf(auctioneerId) }}</strong>
              買回 <strong>{{ auctionAnimalName }}</strong>
              ，支付 🪙<strong>{{ game.auction?.reveal?.amount }}</strong>
              給 <strong>{{ nameOf(game.auction?.reveal?.payeeId || '') }}</strong>
            </p>
          </template>
          <template v-else>
            <p>無人出價，拍賣者 <strong>{{ nameOf(auctioneerId) }}</strong> 取得 <strong>{{ auctionAnimalName }}</strong></p>
          </template>

          <div v-if="isHost" class="actions">
            <button class="ui-btn is-primary" @click="emit('reveal-continue')">繼續</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import AuctionBidderView from '@/components/Auction/AuctionBidderView.vue';
import AuctionHostView from '@/components/Auction/AuctionHostView.vue';
import MoneyPad from '@/components/MoneyPad.vue';
import rules from '@/services/rules';
import type { Player } from '@/types/game';

const props = defineProps<{ phase: string }>();
const emit = defineEmits<{
  'place-bid': [playerId: string, moneyCardIds: string[]];
  'pass-bid': [playerId: string];
  award: [];
  buyback: [];
  'confirm-buyback': [moneyCardIds: string[]];
  'cancel-buyback': [];
  'reveal-continue': [];
}>();

const game = useGameStore();
const auction = useAuctionStore();

const players = computed<Player[]>(() => game.players);
const myPlayer = computed<Player | undefined>(() => players.value.find(p => p.id === myId));
const myId = ((globalThis as any).__PLAYER__ as string) || (sessionStorage.getItem('playerId') || '');
const auctioneerId = computed(() => auction.auction?.auctioneerId ?? game.turnOwnerId);
const canBuyback = computed(() => auction.canAuctioneerBuyback);
const isHost = computed(() => game.hostId === myId);

const auctionAnimalName = computed(() => {
  const animal = game.auction?.card?.animal;
  return animal ? rules.ANIMAL_NAMES[animal] : '';
});
const auctionAnimalScore = computed(() => {
  const animal = game.auction?.card?.animal;
  return animal ? rules.ANIMAL_SCORES[animal] : 0;
});

const bidderHighlightKey = ref(0);
watch(() => game.auction?.highest, (n, o) => { if (n && n !== o) bidderHighlightKey.value += 1; }, { deep: true });

function nameOf(id: string) {
  return players.value.find(p => p.id === id)?.name ?? id;
}

// Buyback local selection state
const selectedMoneyIds = ref<string[]>([]);
const auctioneerMoneyCards = computed(() => {
  const auctioneer = players.value.find(p => p.id === auctioneerId.value);
  return auctioneer?.moneyCards || [];
});
const selectedMoneyTotal = computed(() => {
  return selectedMoneyIds.value.reduce((sum, id) => {
    const card = auctioneerMoneyCards.value.find(c => c.id === id);
    return sum + (card?.value || 0);
  }, 0);
});

function onToggleMoneyCard(cardId: string) {
  const idx = selectedMoneyIds.value.indexOf(cardId);
  if (idx > -1) selectedMoneyIds.value.splice(idx, 1); else selectedMoneyIds.value.push(cardId);
}

</script>

<style scoped>
.auction-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
  justify-content: center;
}
.auction-col {
  min-width: 0;
  justify-self: center;
  width: 100%;
  max-width: 640px;
}
.muted { color: var(--c-text-dimmer); font-size: 12px; }
.compact-host { padding: 8px; }
.auction-reveal .actions { margin-top: 12px; text-align: center; }

/* Auctioneer Info Panel */
/* Accent panel now via .ui-panel.is-accent (global) */
.auctioneer-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.auctioneer-badge {
  background: var(--c-warning); color: #1f2937; padding: 4px 12px; border-radius: 20px; font-size: 10px; font-weight: 800;
  letter-spacing: 1px; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.5); animation: pulse 2s infinite;
}
.auction-details { display: flex; gap: 20px; align-items: center; }
.animal-display, .animal-score, .highest-bid { display: flex; align-items: center; gap: 6px; }
.label { color: var(--c-accent-border); font-size: 12px; font-weight: 600; }
.animal-name, .highest-amount { color: var(--c-text-strong); font-size: 18px; font-weight: 800; }
.animal-points { color: var(--c-warning); font-size: 18px; font-weight: 800; }
.highest-bidder-highlight {
  color: #fff; font-size: 16px; font-weight: 700; margin-left: 12px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  padding: 4px 12px; border-radius: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4); animation: bounce-in 0.6s ease-out;
}
.highest-bidder-highlight strong { color: var(--c-text-strong); font-size: 18px; }
.no-bid { color: var(--c-text-dimmer); font-size: 14px; font-style: italic; margin-left: 8px; }

@keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.05);opacity:.8} }
@keyframes bounce-in { 0%{transform:scale(.8);opacity:0} 50%{transform:scale(1.1);opacity:1} 100%{transform:scale(1);opacity:1} }
</style>
