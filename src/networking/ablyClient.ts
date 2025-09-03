// src/networking/ablyClient.ts
import Ably from 'ably/promises'; // Promise 版 SDK
import type { IBroadcast } from '@/services/broadcast';

type SelfMeta = { playerId: string; name: string };

// -- 讀取環境變數（無 any、具型別） ------------------------------------------
const { VITE_ABLY_API_KEY, VITE_APP_NAME } = import.meta.env;
const ABLY_API_NAME = VITE_APP_NAME ?? 'MyVueGame';

if (!VITE_ABLY_API_KEY) {
  throw new Error(
    '[ablyClient] Missing VITE_ABLY_API_KEY in environment (.env). ' +
      'Please set VITE_ABLY_API_KEY=YOUR-ABLY-API-KEY'
  );
}

// -- Realtime 客戶端（以 playerId 為 clientId 建立） ---------------------------
function createRealtimeForPlayer(playerId: string): Ably.Types.RealtimePromise {
  return new Ably.Realtime({
    key: VITE_ABLY_API_KEY,
    clientId: playerId,
    echoMessages: true,
    transportParams: { remainPresentFor: 15 }
    // log: { level: 2 } // 開發除錯時可開
  });
}

async function waitConnected(rt: Ably.Types.RealtimePromise): Promise<void> {
  if (rt.connection.state === 'connected') return;
  await new Promise<void>((resolve, reject) => {
    const onConnected = () => {
      rt.connection.off('connected', onConnected);
      rt.connection.off('failed', onFailed);
      rt.connection.off('suspended', onFailed);
      resolve();
    };
    const onFailed = (sc: Ably.Types.ConnectionStateChange) => {
      rt.connection.off('connected', onConnected);
      rt.connection.off('failed', onFailed);
      rt.connection.off('suspended', onFailed);
      reject(
        new Error(
          `[ablyClient] Connection ${sc.current}${sc.reason ? `: ${sc.reason.message}` : ''}`
        )
      );
    };
    rt.connection.on('connected', onConnected);
    rt.connection.on('failed', onFailed);
    rt.connection.on('suspended', onFailed);
  });
}

function channelNameForRoom(roomId: string): string {
  return `game-${roomId}`;
}

export async function createAblyBroadcast(
  roomId: string,
  self: SelfMeta
): Promise<IBroadcast> {
  const rt = createRealtimeForPlayer(self.playerId);
  await waitConnected(rt);

  const ch = rt.channels.get(channelNameForRoom(roomId));
  ch.setOptions({ params: { app: ABLY_API_NAME } });

  // ✅ 不用 MessageData、不用 any
  async function publish<T>(topic: string, payload: T): Promise<void> {
    await ch.publish({ name: topic, data: payload as unknown });
  }

  function subscribe<T>(topic: string, handler: (payload: T) => void): () => void {
    const cb = (msg: Ably.Types.Message) => {
      try {
        handler(msg.data as T);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ablyClient] subscriber threw:', err);
      }
    };
    ch.subscribe(topic, cb);
    return () => ch.unsubscribe(topic, cb);
  }

  const presence = () => ({
    async enter(meta: { playerId: string; name: string }): Promise<void> {
      if (meta.playerId !== self.playerId) {
        throw new Error(
          `[ablyClient] presence.enter: meta.playerId(${meta.playerId}) must equal self.playerId(${self.playerId})`
        );
      }
      await ch.attach();
      await ch.presence.enter({ playerId: meta.playerId, name: meta.name });
    },
    async leave(): Promise<void> {
      await ch.presence.leave();
    },
    async getMembers(): Promise<
      Array<{ id: string; data: { playerId: string; name: string } }>
    > {
      const members = await ch.presence.get({ waitForSync: true });
      return members.map((m) => {
        const id = m.clientId ?? '';
        const data = (m.data as { playerId?: string; name?: string }) ?? {};
        if (data.playerId && data.playerId !== id) {
          // eslint-disable-next-line no-console
          console.warn(
            `[ablyClient] presence.getMembers: data.playerId(${data.playerId}) !== clientId(${id}); using clientId`
          );
        }
        return { id, data: { playerId: id, name: data.name ?? '' } };
      });
    }
  });

  const bus: IBroadcast = { publish, subscribe, presence };
  return bus;
}

export async function disposeBroadcastForRoom(
  roomId: string,
  playerId: string
): Promise<void> {
  const rt = createRealtimeForPlayer(playerId);
  try {
    const ch = rt.channels.get(channelNameForRoom(roomId));
    await ch.detach();
  } finally {
    rt.close();
  }
}