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
export interface RealtimeIdentity { playerId: string; name: string; }
export type BusFactory = (roomId: string) => IBroadcast;

export const RoomIdKey: InjectionKey<string> = Symbol('roomId');
export const MeKey: InjectionKey<RealtimeIdentity> = Symbol('me');
export const BusFactoryKey: InjectionKey<BusFactory> = Symbol('busFactory');

// --------------------
// Env
// --------------------
const ABLY_API_KEY = (import.meta.env.VITE_ABLY_API_KEY ?? '') as string;
const APP_NAME = (import.meta.env.VITE_APP_NAME ?? 'MyVueGame') as string;

// --------------------
// Helpers (no any)
// --------------------
function generateRoomCode(): string {
  // keep it URL-friendly; use nanoid/newId then trim
  return newId().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) || 'room';
}

function resolveRoomId(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('room');
  if (fromQuery && /^[\w-]{3,64}$/.test(fromQuery)) return fromQuery;

  const cached = localStorage.getItem('lastRoomId');
  if (cached && /^[\w-]{3,64}$/.test(cached)) return cached;

  const gen = generateRoomCode();
  localStorage.setItem('lastRoomId', gen);
  return gen;
}

function loadMe(roomId: string): RealtimeIdentity {
  const key = `me:${roomId}`;
  const str = localStorage.getItem(key);
  if (str) {
    try {
      const parsed = JSON.parse(str) as RealtimeIdentity;
      if (parsed?.playerId && parsed?.name) return parsed;
    } catch {
      /* ignore parse error and regenerate */
    }
  }
  const playerId = newId();
  const name = `Player-${playerId.slice(0, 4)}`;
  const me = { playerId, name } satisfies RealtimeIdentity;
  localStorage.setItem(key, JSON.stringify(me));
  return me;
}

// --------------------
// Ably client & Bus factory (runtime optional)
// --------------------
let ablyClient: AblyClient | undefined;
if (ABLY_API_KEY) {
  ablyClient = createAblyClient(
    { apiKey: ABLY_API_KEY, appName: APP_NAME },
    // clientId MUST match playerId per README; we set the final value after we compute `me`
    // We will re-create if playerId differs (safe in this small app)
    'bootstrap'
  );
}

/**
 * Create a bus factory bound to Ably. Throws if Ably is not configured.
 */
function makeBusFactory(me: RealtimeIdentity): BusFactory {
  // Ensure clientId matches playerId (Host election depends on this)
  if (!ablyClient) {
    throw new Error('Ably is not configured. Set VITE_ABLY_API_KEY in .env to enable realtime.');
  }
  // If bootstrap clientId differs from me.playerId, re-create with correct clientId
  if ((ablyClient as unknown as { clientId?: string }).clientId !== me.playerId) {
    // Close old client and create a new one with correct clientId
    void ablyClient.close();
    ablyClient = createAblyClient({ apiKey: ABLY_API_KEY, appName: APP_NAME }, me.playerId);
  }

  const factory: BusFactory = (roomId: string) => {
    const channel = ablyClient!.getChannel(`game-${roomId}`);
    return createAblyBroadcast(channel);
  };
  return factory;
}

// --------------------
// Bootstrap
// --------------------
const roomId = resolveRoomId();
const me = loadMe(roomId);

// Optional: show room in title for convenience
document.title = `${APP_NAME} — ${roomId}`;

const app = createApp(App);
app.use(createPinia());

// Provide room & identity
app.provide(RoomIdKey, roomId);
app.provide(MeKey, me);

// Provide BusFactory when Ably is configured; if not, leave it undefined
if (ABLY_API_KEY) {
  const busFactory = makeBusFactory(me);
  app.provide(BusFactoryKey, busFactory);
}

app.mount('#app');

// --------------------
// (Optional) Types consumed elsewhere; kept here for import convenience
// --------------------
export type { GameState, Animal };
