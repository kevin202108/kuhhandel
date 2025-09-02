// src/services/rules.ts
// 常數單一來源（Single Source of Truth）
// 依 Master README 與 src/types/game.ts 的 Rules 介面實作。

import type { Animal, MoneyDenom, Rules } from '@/types/game';

/** 一組動物的張數（固定 4） */
export const SET_SIZE = 4 as const;

/** 錢卡面額（由小到大） */
export const MONEY_DENOMS: MoneyDenom[] = [0, 10, 50, 100, 200, 500];

/**
 * 起始錢卡配置：
 * - 0 元 ×2
 * - 10 元 ×4
 * - 50 元 ×1
 * - 100/200/500 元 ×0（明確填 0 以符合 Record<MoneyDenom, number>）
 */
export const START_MONEY: Record<MoneyDenom, number> = {
  0: 2,
  10: 4,
  50: 1,
  100: 0,
  200: 0,
  500: 0,
};

/**
 * 驢子事件每次發錢的階梯金額（依抽到第 1~4 隻）
 * 注意：這裡**不要**使用 `as const`，否則會變成 readonly tuple，
 * 無法賦值給 Rules.DONKEY_PAYOUTS（需要的是可變動的 tuple 類型）。
 */
export const DONKEY_PAYOUTS: [50, 100, 200, 500] = [50, 100, 200, 500];

/** 各動物分數表（每種動物固定 4 張） */
export const ANIMAL_SCORES: Record<Animal, number> = {
  chicken: 10,
  goose: 40,
  cat: 90,
  dog: 160,
  sheep: 250,
  snake: 350,
  donkey: 500,
  pig: 650,
  cow: 800,
  horse: 1000,
};

/**
 * 規則彙總（預設匯出）
 * - 嚴格符合 Rules 介面
 */
export const RULES: Rules = {
  SET_SIZE,
  MONEY_DENOMS,
  START_MONEY,
  DONKEY_PAYOUTS,
  ANIMAL_SCORES,
};

export default RULES;
