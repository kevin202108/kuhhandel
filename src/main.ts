// src/main.ts
import { createApp, type InjectionKey } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './assets/main.css';

import { newId } from '@/utils/id';
import type { Animal, GameState } from '@/types/game';
import type { IBroadcast } from '@/services/broadcast';
import { createAblyClient, type AblyClient } from '@/networking/ablyClient';
import { createAblyBroadcast } from '@/services/broadcast';

export interface RealtimeIdentity { playerId: string; name: string; }
export type BusFactory = (roomId: string) => IBroadcast;

export const RoomIdKey: InjectionKey<string> = Symbol('roomId');
export const MeKey: InjectionKey<RealtimeIdentity> = Symbol('me');
export const BusFactoryKey: InjectionKey<BusFactory> = Symbol('busFactory');

const APP_NAME = (import.meta.env.VITE_APP_NAME ?? 'MyVueGame') as string;
const ABLY_API_KEY = import.meta.env.VITE_ABLY_API_KEY as string | undefined;
if (!ABLY_API_KEY) throw new Error('Missing VITE_ABLY_API_KEY in .env');

function sanitizeId(raw: string, fallback: string): string {
  const s = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return s.length > 0 ? s : fallback;
}
function resolveRoomId(): string {
  const url = new URL(window.location.href);
  const from = url.searchParams.get('room');
  return from ? sanitizeId(from, 'dev') : 'dev'; // 同房測試方便
}
function resolveIdentity(): RealtimeIdentity {
  const url = new URL(window.location.href);
  const pid = url.searchParams.get('pid');
  const playerId = pid ? sanitizeId(`p-${pid}`, `p-${newId()}`) : `p-${newId()}`;
  const nameQ = url.searchParams.get('name');
  const name = nameQ ? sanitizeId(nameQ, `P-${playerId.slice(0, 6)}`) : `P-${playerId.slice(0, 6)}`;
  return { playerId, name };
}

function makeBusFactory(me: RealtimeIdentity): BusFactory {
  const ably: AblyClient = createAblyClient({ apiKey: ABLY_API_KEY as string, appName: APP_NAME }, me.playerId);
  return (roomId: string) => {
    const ch = ably.getChannel(roomId.startsWith('game-') ? roomId : `game-${roomId}`);
    return createAblyBroadcast(ch);
  };
}

const roomId = resolveRoomId();
const me = resolveIdentity();

/* eslint-disable no-console */
console.log('[BOOT] start', { roomId, me });
/* eslint-enable no-console */

document.title = `${APP_NAME} — ${roomId}`;

const app = createApp(App);
app.use(createPinia());
app.provide(RoomIdKey, roomId);
app.provide(MeKey, me);
app.provide(BusFactoryKey, makeBusFactory(me));

/* eslint-disable no-console */
console.log('[BOOT] bus ready', { adapter: 'ably', clientId: me.playerId });
/* eslint-enable no-console */

app.mount('#app');

export type { GameState, Animal };
