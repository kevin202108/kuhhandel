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
                  {{ short(a) }} <span class="animal-points">{{ animalScore(a) }}</span>: <strong>{{ p.animals[a] }}</strong>
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
  return rules.ANIMAL_NAMES[a];
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
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 12px;
  background: var(--c-surface);
  color: var(--c-text);
  display: grid;
  row-gap: 14px;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.phase .label { color: var(--c-text-dimmer); }
.deck strong, .phase strong { font-weight: 700; color: var(--c-text-strong); }
.players h4, .log h4 { margin: 0 0 6px; font-size: 14px; color: var(--c-text-muted); }
.plist { list-style: none; padding: 0; margin: 0; display: grid; row-gap: 10px; }
.pitem { border: 1px solid var(--c-border); border-radius: 10px; padding: 8px; background: var(--c-surface-2); color: var(--c-text); }
.pitem.active { border-color: var(--c-primary); box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.3) inset; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.head .name { display: flex; align-items: center; gap: 6px; }
.money-count { font-weight: 600; }
.pid code { background: var(--c-border); padding: 2px 6px; border-radius: 6px; color: var(--c-text); }
.money { font-weight: 600; }
.count { color: var(--c-text-dimmer); font-weight: 400; margin-left: 4px; }
.animals { display: flex; gap: 8px; }
.animal { font-variant-numeric: tabular-nums; background: var(--c-surface); border: 1px solid var(--c-border); padding: 2px 6px; border-radius: 8px; color: var(--c-text); }
.animal.zero { opacity: 0.55; }
.newly-awarded {
  background: #fef3f2;
  color: var(--c-danger);
  border-color: var(--c-danger);
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
.dot.on { background: var(--c-success); }
.loglist { margin: 0; padding-left: 18px; color: var(--c-text); }
.muted { color: var(--c-text-dimmer); font-style: italic; }
.animal-points {
  color: var(--c-warning); /* 金黃色，代表分數 */
}
</style>
