// src/services/rules.ts
// Single Source of Truth for all game constants.
// Do not mutate at runtime.

import type { Rules, MoneyDenom, Animal } from '@/types/game';

export const SET_SIZE = 4 as const;

export const MONEY_DENOMS: MoneyDenom[] = [0, 10, 50, 100, 200, 500];

export const START_MONEY: Record<MoneyDenom, number> = {
  0: 2,
  10: 4,
  50: 1,
  100: 0,
  200: 0,
  500: 0,
};

export const DONKEY_PAYOUTS: [50, 100, 200, 500] = [50, 100, 200, 500];

export const ANIMAL_NAMES: Record<Animal, string> = {
  chicken: '雞',
  goose: '鵝',
  cat: '貓',
  dog: '狗',
  sheep: '羊',
  snake: '蛇',
  donkey: '驢',
  pig: '豬',
  cow: '牛',
  horse: '馬',
};

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

// Export a frozen rules object to discourage mutation.
export const rules: Rules = Object.freeze({
  SET_SIZE,
  MONEY_DENOMS,
  START_MONEY,
  DONKEY_PAYOUTS,
  ANIMAL_SCORES,
  ANIMAL_NAMES,
} as const);

export default rules;
