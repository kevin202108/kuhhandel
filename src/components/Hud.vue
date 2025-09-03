<template>
  <aside class="hud">
    <header class="top">
      <div class="phase">
        <span class="label">階段：</span>
        <strong>{{ phase }}</strong>
      </div>
      <div class="deck">
        牌庫剩餘：<strong>{{ deckCount }}</strong>
      </div>
    </header>

    <section class="players">
      <h4>玩家狀態</h4>
      <ul class="plist">
        <li
          v-for="p in players"
          :key="p.id"
          class="pitem"
          :class="{ active: p.id === turnOwnerId }"
        >
          <div class="row head">
            <div class="name">
              <span class="dot" :class="{ on: p.id === turnOwnerId }"></span>
              {{ p.name }}
              <small class="pid">(<code>{{ p.id }}</code>)</small>
            </div>
            <div class="money">
              💰 {{ moneyTotal(p) }}
              <small class="count">（{{ p.moneyCards.length }}張）</small>
            </div>
          </div>

          <div class="row animals">
            <template v-for="a in animalOrder" :key="a">
              <span class="animal" :class="{ zero: !p.animals[a] }">
                {{ short(a) }}: <strong>{{ p.animals[a] || 0 }}</strong>
              </span>
            </template>
          </div>
        </li>
      </ul>
    </section>

    <section class="log">
      <h4>Log</h4>
      <ol class="loglist">
        <li v-if="!log || log.length === 0" class="muted">（目前尚無紀錄）</li>
        <li v-for="(entry, i) in log" :key="i">{{ entry }}</li>
      </ol>
    </section>
  </aside>
</template>

<script setup lang="ts">
import type { Player, Phase, Animal } from '@/types/game';

const props = defineProps<{
  players: Player[];
  turnOwnerId: string;
  deckCount: number;
  phase: Phase;
  log: string[];
}>();

const animalOrder: Animal[] = [
  'chicken',
  'goose',
  'cat',
  'dog',
  'sheep',
  'snake',
  'donkey',
  'pig',
  'cow',
  'horse',
];

function moneyTotal(p: Player) {
  return p.moneyCards.reduce((acc, c) => acc + c.value, 0);
}

function short(a: Animal): string {
  // 簡短顯示（固定順序）
  switch (a) {
    case 'chicken':
      return '雞';
    case 'goose':
      return '鵝';
    case 'cat':
      return '貓';
    case 'dog':
      return '狗';
    case 'sheep':
      return '羊';
    case 'snake':
      return '蛇';
    case 'donkey':
      return '驢';
    case 'pig':
      return '豬';
    case 'cow':
      return '牛';
    case 'horse':
      return '馬';
  }
}
</script>

<style scoped>
.hud {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  background: #fff;
  display: grid;
  row-gap: 14px;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.phase .label {
  color: #6b7280;
}
.deck strong,
.phase strong {
  font-weight: 700;
}
.players h4,
.log h4 {
  margin: 0 0 6px;
  font-size: 14px;
  color: #374151;
}
.plist {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  row-gap: 10px;
}
.pitem {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px;
  background: #f9fafb;
}
.pitem.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15) inset;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.head .name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pid code {
  background: #eef2f7;
  padding: 2px 6px;
  border-radius: 6px;
}
.money {
  font-weight: 600;
}
.count {
  color: #6b7280;
  font-weight: 400;
  margin-left: 4px;
}
.animals {
  margin-top: 6px;
  flex-wrap: wrap;
  gap: 8px;
}
.animal {
  font-variant-numeric: tabular-nums;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 2px 6px;
  border-radius: 8px;
}
.animal.zero {
  opacity: 0.55;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #d1d5db;
  display: inline-block;
}
.dot.on {
  background: #10b981;
}
.loglist {
  margin: 0;
  padding-left: 18px;
}
.muted {
  color: #6b7280;
  font-style: italic;
}
</style>
