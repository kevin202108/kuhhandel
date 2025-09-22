<template>
  <aside class="hud">
    <header class="top">
      <div class="phase">
        <span class="label">Phase</span>
        <strong>{{ phase }}</strong>
      </div>
      <div class="deck">
        Deck: <strong>{{ deckCount }}</strong>
      </div>
    </header>

    <section class="players">
      <h4>Players</h4>
      <ul class="plist">
        <li v-for="p in players" :key="p.id" class="pitem" :class="{ active: p.id === turnOwnerId }">
          <div class="row head">
            <div class="name">
              <span class="dot" :class="{ on: p.id === turnOwnerId }"></span>
              {{ p.name }}
              <small class="pid">(<code>{{ p.id }}</code>)</small>
            </div>
            <div class="money-count">
              錢卡張數: <strong>{{ p.moneyCards.length }}</strong>
            </div>
            <div class="animals">
              <template v-for="a in animalOrder" :key="a">
                <span v-if="p.animals[a] > 0" class="animal" :class="{ 'newly-awarded': isNewlyAwarded(p, a) }">
                  {{ short(a) }}<span class="animal-points">{{ animalScore(a) }}</span>: <strong>{{ p.animals[a] }}</strong>
                </span>
              </template>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <!-- <section class="log">
      <h4>Log</h4>
      <ol class="loglist">
        <li v-if="!log || log.length === 0" class="muted">(empty)</li>
        <li v-for="(entry, i) in log" :key="i">{{ entry }}</li>
      </ol>
    </section> -->
  </aside>
</template>

<script setup lang="ts">
import type { Player, Phase, Animal } from '@/types/game';
import rules from '@/services/rules';

const props = defineProps<{
  players: Player[];
  turnOwnerId: string;
  deckCount: number;
  phase: Phase;
  log: string[];
  myId?: string;
  lastAwarded?: { playerId: string; animal: Animal } | null;
}>();

const animalOrder: Animal[] = ['chicken','goose','cat','dog','sheep','snake','donkey','pig','cow','horse'];

function moneyTotal(p: Player) {
  return p.moneyCards.reduce((acc, c) => acc + c.value, 0);
}

function short(a: Animal): string {
  switch (a) {
    case 'chicken': return '雞';
    case 'goose': return '鵝';
    case 'cat': return '貓';
    case 'dog': return '狗';
    case 'sheep': return '羊';
    case 'snake': return '蛇';
    case 'donkey': return '驢';
    case 'pig': return '豬';
    case 'cow': return '牛';
    case 'horse': return '馬';
  }
}

function animalScore(a: Animal): number {
  return rules.ANIMAL_SCORES[a];
}

function isNewlyAwarded(p: Player, a: Animal): boolean {
  return props.lastAwarded?.playerId === p.id && props.lastAwarded.animal === a;
}
</script>

<style scoped>
.hud {
  border: 1px solid #4b5563;
  border-radius: 12px;
  padding: 12px;
  background: #1f2937;
  color: #f9fafb;
  display: grid;
  row-gap: 14px;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.phase .label { color: #9ca3af; }
.deck strong, .phase strong { font-weight: 700; color: #ffffff; }
.players h4, .log h4 { margin: 0 0 6px; font-size: 14px; color: #d1d5db; }
.plist { list-style: none; padding: 0; margin: 0; display: grid; row-gap: 10px; }
.pitem { border: 1px solid #4b5563; border-radius: 10px; padding: 8px; background: #374151; color: #f9fafb; }
.pitem.active { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.3) inset; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.head .name { display: flex; align-items: center; gap: 6px; }
.money-count { font-weight: 600; }
.pid code { background: #4b5563; padding: 2px 6px; border-radius: 6px; color: #f9fafb; }
.money { font-weight: 600; }
.count { color: #9ca3af; font-weight: 400; margin-left: 4px; }
.animals { display: flex; gap: 8px; }
.animal { font-variant-numeric: tabular-nums; background: #1f2937; border: 1px solid #4b5563; padding: 2px 6px; border-radius: 8px; color: #f9fafb; }
.animal.zero { opacity: 0.55; }
.newly-awarded {
  background: #fef3f2;
  color: #dc2626;
  border-color: #dc2626;
  animation: award-flash 2s ease-in-out;
}
@keyframes award-flash {
  0% { transform: scale(1); background: #fef3f2; }
  20% { background: #fee2e2; transform: scale(1.1); }
  40% { background: #fecaca; }
  60% { background: #fca5a5; }
  80% { background: #f87171; }
  100% { transform: scale(1); background: #fef3f2; }
}
.dot { width: 8px; height: 8px; border-radius: 9999px; background: #6b7280; display: inline-block; }
.dot.on { background: #10b981; }
.loglist { margin: 0; padding-left: 18px; color: #f9fafb; }
.muted { color: #9ca3af; font-style: italic; }
.animal-points {
  color: #fbbf24; /* 金黃色，代表分數 */
}
</style>
