// src/services/rules.ts
// 單一來源（Single Source of Truth）— 遊戲規則常數。
// 僅輸出常數，不包含任何邏輯或副作用。

import type { Animal, MoneyDenom } from '../types/game';

/**
 * 一套動物需要的張數（成套數量）
 * - 用於鎖定 Cow Trade 的判斷與計分
 */
export const SET_SIZE = 4 as const;

/**
 * 可用的錢卡面額（由小到大）
 * - 以 readonly tuple 呈現，呼叫端若需要可展開成可變陣列
 */
export const MONEY_DENOMS = [0, 10, 50, 100, 200, 500] as const satisfies readonly MoneyDenom[];

/**
 * 起始牌組配置：每位玩家開局各面額張數
 * - 未列出的面額請一律視為 0，這裡完整列出以免歧義
 */
export const START_MONEY: Readonly<Record<MoneyDenom, number>> = Object.freeze({
  0: 2,
  10: 4,
  50: 1,
  100: 0,
  200: 0,
  500: 0,
});

/**
 * 驢子（Donkey）事件的全員發錢序列（依抽到第幾張驢子）
 * - 第 1 張：+50
 * - 第 2 張：+100
 * - 第 3 張：+200
 * - 第 4 張：+500
 * - 仍需拍賣該驢子牌
 */
export const DONKEY_PAYOUTS = [50, 100, 200, 500] as const;
export type DonkeyPayoutIndex = 0 | 1 | 2 | 3;

/**
 * 每種動物的分數（單張）
 * - 計分：玩家總分 = （各動物分數總和） × （完成的 4 張組數總和）
 */
export const ANIMAL_SCORES: Readonly<Record<Animal, number>> = Object.freeze({
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
});
