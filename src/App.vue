<template>
  <div class="layout">
    <main class="main">
      <!-- SETUP：開始遊戲 -->
      <section v-if="game.phase === 'setup'" class="card">
        <h2>Multiplayer Auction + Cow Trade (Local MVP)</h2>
        <button class="btn primary" @click="onStart">開始遊戲</button>
      </section>

      <!-- 回合選擇 -->
      <section v-else-if="game.phase === 'turn.choice'" class="card">
        <TurnChoice
          :canAuction="true"
          :canCowTrade="false"       
          :isFirstRound="true"
          @choose-auction="onChooseAuction"
        />
      </section>

      <!-- 拍賣（最小 Host 面板即可跑通「無人出價→主持人拿牌」DoD） -->
      <section
        v-else-if="game.phase === 'auction.bidding' || game.phase === 'auction.closing'"
        class="card"
      >
        <h3>拍賣中</h3>
        <p v-if="game.auction?.card">競標目標：<b>{{ game.auction!.card!.animal }}</b></p>
        <AuctionHostView
          :highest="game.auction?.highest"
          :canBuyback="false"         
          @award="onHostAward"
          @buyback="noop"
        />
      </section>

      <!-- 結束 → 立即啟動下一回合（用 log 觀察） -->
      <section v-else-if="game.phase === 'turn.end'" class="card">
        <p>回合結束。即將進入下一回合…</p>
      </section>

      <!-- 遊戲結束 -->
      <section v-else-if="game.phase === 'game.end'" class="card">
        <h3>遊戲結束</h3>
        <p>請查看右側 HUD 的分數與紀錄。</p>
      </section>
    </main>

    <aside class="side">
      <Hud
        :players="game.players"
        :turnOwnerId="game.turnOwnerId"
        :deckCount="game.deck.length"
        :phase="game.phase"
        :log="game.log"
      />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import TurnChoice from '@/components/TurnChoice.vue';
import AuctionHostView from '@/components/Auction/AuctionHostView.vue';
import Hud from '@/components/Hud.vue';
import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';

const game = useGameStore();
const auction = useAuctionStore();
const { phase } = storeToRefs(game);

function onStart() {
  // 你 Phase 0 應已有 setupGame()，這裡示意建立兩位玩家
  game.setupGame([
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' }
  ]);
  game.startTurn();
}

function onChooseAuction() {
  // 依 README：抽牌 → 進入 bidding；若抽到驢子會在 enterBidding 中處理發錢
  auction.enterBidding();
}

function onHostAward() {
  auction.hostAward(); // 會在 settle('award') 後把 phase 推進到 turn.end/下一回合
}

function noop() {}
</script>

<style scoped>
.layout { display: grid; grid-template-columns: 1fr 360px; gap: 16px; padding: 16px; }
.card { border: 1px solid #e5e7eb; background: #fff; border-radius: 12px; padding: 12px; }
.btn { padding: 8px 12px; border-radius: 10px; border: 1px solid #d1d5db; background: #f9fafb; cursor: pointer; }
.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.main { display: grid; align-content: start; gap: 12px; }
</style>
