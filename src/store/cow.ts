import { defineStore } from 'pinia';
import type { Animal, MoneyCard, Player, CowTradeState } from '@/types/game';

export const useCowStore = defineStore('cow', {
  state: (): CowTradeState => ({
    initiatorId: undefined,
    targetPlayerId: undefined,
    targetAnimal: undefined,
    initiatorSecret: undefined,
    targetSecret: undefined,
  }),
});
