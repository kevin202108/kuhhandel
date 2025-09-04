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

// --------------------
// Injection keys (typed)
// --------------------
export interface RealtimeIdentity {
  playerId: string;
  name: string;
}
export type BusFactory = (roomId: string) => IBroadcast;

export const RoomIdKey: InjectionKey<string> = Symbol('roomId');
export const MeKey: InjectionKey<RealtimeIdentity> = Symbol('me');
export const BusFactoryKey: InjectionKey<BusFactory> = Symbol('busFactory');

// --------------------
// Env
// --------------------
const APP_NAME = (import.meta.env.VITE_APP_NAME ?? 'MyVueGame') as string;
const ABLY_API_KEY = import.meta.env.VITE_ABLY_API_KEY as string | undefined;

if (!ABLY_API_KEY) {
  // 避免你以為有連線但其實沒設定 key
  throw new Error('Missing VITE_ABLY_API_KEY in .env');
}

// --------------------
// Helpers (no any)
// --------------------
function sanitizeId(raw: string, fallback: string): string {
  const s = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return s.length > 0 ? s : fallback;
}

function resolveRoomId(): string {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('room');
  if (fromQuery) return sanitizeId(fromQuery, 'dev');
  // 沒給就用固定 dev（方便你開多分頁同房測試）
  return 'dev';
}

function resolveIdentity(_roomId: string): RealtimeIdentity {
  const url = new URL(window.location.href);
  const pid = url.searchParams.get('pid'); // 手動指定 playerId（測試用）
  const nameQ = url.searchParams.get('name');

  // 重要：為了避免「複製分頁」帶出相同 sessionStorage/localStorage，
  // 我們在開發期採取「每次分頁載入都新生一個 playerId」的策略。
  const playerId = pid ? sanitizeId(`p-${pid}`, `p-${newId()}`) : `p-${newId()}`;
  const name = nameQ ? sanitizeId(nameQ, `P-${playerId.slice(0, 6)}`) : `P-${playerId.slice(0, 6)}`;

  return { playerId, name };
}

// --------------------
// Ably client & Bus factory
// --------------------
function makeBusFactory(me: RealtimeIdentity): BusFactory {
  // clientId 必須等於 playerId（Presence/Host 選舉依此）
  const ablyClient: AblyClient = createAblyClient(
    { apiKey: ABLY_API_KEY as string, appName: APP_NAME },
    me.playerId
  );

  // 小提醒：若你需要在執行期更換 playerId，請在外層銷毀並重建本工廠。
  const factory: BusFactory = (roomId: string) => {
    const channel = ablyClient.getChannel(`game-${roomId}`);
    return createAblyBroadcast(channel);
  };
  return factory;
}

// --------------------
// Bootstrap
// --------------------
const roomId = resolveRoomId();
const me = resolveIdentity(roomId);

// Optional: show room in title
document.title = `${APP_NAME} — ${roomId}`;

// Boot logs（方便檢查）
/* eslint-disable no-console */
console.log('[BOOT] start', { roomId, me });

const app = createApp(App);
app.use(createPinia());

// Provide room & identity
app.provide(RoomIdKey, roomId);
app.provide(MeKey, me);

// Provide BusFactory（Ably）
const busFactory = makeBusFactory(me);
app.provide(BusFactoryKey, busFactory);
console.log('[BOOT] bus ready', { adapter: 'ably', clientId: me.playerId });
/* eslint-enable no-console */

app.mount('#app');

// --------------------
// (Optional) Types consumed elsewhere; kept here for import convenience
// --------------------
export type { GameState, Animal };
