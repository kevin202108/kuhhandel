import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import { useGameStore } from '@/store/game';
import {
  SET_SIZE,
  DONKEY_PAYOUTS,
  ANIMAL_SCORES,
} from '@/services/rules';
import type { Animal, MoneyDenom, Player } from '@/types/game';

// 小工具
const makePlayers = (n: number) =>
  Array.from({ length: n }).map((_, i) => ({
    id: String(i + 1),
    name: `P${i + 1}`,
  }));

const animalList = Object.keys(ANIMAL_SCORES) as Animal[];

const countDenom = (p: Player, denom: MoneyDenom) =>
  p.moneyCards.filter((m) => m.value === denom).length;

const totalMoney = (p: Player) =>
  p.moneyCards.reduce((acc, m) => acc + m.value, 0);

describe('store/game.ts (MVP)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('setupGame：建立玩家、起始錢卡與完整牌庫', () => {
    const store = useGameStore();
    store.setupGame(makePlayers(3));

    expect(store.players).toHaveLength(3);
    // 起始錢卡：2x0 + 4x10 + 1x50 = 7 張；金額應 >= 90（4*10 + 1*50）
    store.players.forEach((p) => {
      expect(p.moneyCards.length).toBe(7);
      expect(totalMoney(p)).toBeGreaterThanOrEqual(90);
      // 動物初始為 0
      animalList.forEach((a) => expect(p.animals[a]).toBe(0));
    });

    // 牌庫：每種動物 4 張
    const expectedDeck = animalList.length * SET_SIZE;
    expect(store.deck.length).toBe(expectedDeck);

    // 回合與狀態
    expect(store.turnOwnerId).toBe(store.players[0].id);
    expect(store.donkeyDrawCount).toBe(0);
    expect(store.phase).toBe('setup');
  });

  it('startTurn / rotateTurn：phase 與回合輪替', () => {
    const store = useGameStore();
    store.setupGame(makePlayers(3));

    store.startTurn();
    expect(store.phase).toBe('turn.choice');

    const first = store.turnOwnerId;
    store.rotateTurn();
    expect(store.turnOwnerId).not.toBe(first);
    store.rotateTurn();
    store.rotateTurn(); // 轉三次應回到原點
    expect(store.turnOwnerId).toBe(first);
  });

  it('drawCardForAuction：抽一張牌並縮短牌庫', () => {
    const store = useGameStore();
    store.setupGame(makePlayers(2));
    const before = store.deck.length;

    const card = store.drawCardForAuction();
    expect(card.kind).toBe('animal');
    expect(animalList.includes(card.animal)).toBe(true);
    expect(store.deck.length).toBe(before - 1);
  });

  it('grantDonkeyPayout：依序 +50、+100、+200、+500，最多四次', () => {
    const store = useGameStore();
    store.setupGame(makePlayers(2));

    // baseline：各面額張數
    const baseline = store.players.map((p) => ({
      c50: countDenom(p, 50),
      c100: countDenom(p, 100),
      c200: countDenom(p, 200),
      c500: countDenom(p, 500),
    }));

    // 1st：+50
    store.grantDonkeyPayout();
    store.players.forEach((p, i) => {
      expect(countDenom(p, 50)).toBe(baseline[i].c50 + 1);
    });
    expect(store.donkeyDrawCount).toBe(1);

    // 2nd：+100
    store.grantDonkeyPayout();
    store.players.forEach((p, i) => {
      expect(countDenom(p, 100)).toBe(baseline[i].c100 + 1);
    });
    expect(store.donkeyDrawCount).toBe(2);

    // 3rd：+200
    store.grantDonkeyPayout();
    store.players.forEach((p, i) => {
      expect(countDenom(p, 200)).toBe(baseline[i].c200 + 1);
    });
    expect(store.donkeyDrawCount).toBe(3);

    // 4th：+500
    store.grantDonkeyPayout();
    store.players.forEach((p, i) => {
      expect(countDenom(p, 500)).toBe(baseline[i].c500 + 1);
    });
    expect(store.donkeyDrawCount).toBe(4);

    // 5th：不再發錢（上限 4）
    store.grantDonkeyPayout();
    expect(store.donkeyDrawCount).toBe(4);
  });

  it('canChooseAuction / canChooseCowTrade：基本可用性', () => {
    const store = useGameStore();
    store.setupGame(makePlayers(2));
    store.startTurn();

    // 起始就有錢，Cow Trade 可發起（是否有對手另由畫面/其他 store 判斷）
    expect(store.canChooseCowTrade).toBe(true);
    // 牌庫有牌 → 可拍賣
    expect(store.canChooseAuction).toBe(true);

    // 當前玩家沒錢時 → Cow Trade 禁用
    store.activePlayer.moneyCards = []; // 清空錢卡
    expect(store.canChooseCowTrade).toBe(false);
  });

  it('checkEndAndMaybeFinish：所有動物皆有人湊滿 4 張 → Game End', () => {
    const store = useGameStore();
    store.setupGame(makePlayers(3));
    store.startTurn();

    // 讓 P1 對所有動物都達成 4 張
    const p1 = store.players[0];
    animalList.forEach((a) => (p1.animals[a] = SET_SIZE));

    store.checkEndAndMaybeFinish();
    expect(store.phase).toBe('game.end');
  });

  it('computeFinalScores：分數 = (動物分值總和) × (完成的 4 張組數)', () => {
    const store = useGameStore();
    store.setupGame(makePlayers(2));

    // 清空，手動設置動物數（避免牌庫干擾）
    store.players.forEach((p) =>
      animalList.forEach((a) => (p.animals[a] = 0)),
    );

    // P1：牛 4（800*4=3200）、雞 2（10*2=20）→ sum=3220、setCount=1、score=3220
    const p1 = store.players[0];
    p1.animals.cow = 4 as any;
    p1.animals.chicken = 2 as any;

    // P2：驢 4（500*4=2000）、馬 4（1000*4=4000）→ sum=6000、setCount=2、score=12000
    const p2 = store.players[1];
    p2.animals.donkey = 4 as any;
    p2.animals.horse = 4 as any;

    const scores = store.computeFinalScores();
    const s1 = scores.find((s) => s.playerId === p1.id)!.score;
    const s2 = scores.find((s) => s.playerId === p2.id)!.score;

    expect(s1).toBe(3220);
    expect(s2).toBe(12000);
    expect(s2).toBeGreaterThan(s1);
  });
});
