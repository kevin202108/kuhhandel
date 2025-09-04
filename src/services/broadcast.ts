// src/services/broadcast.ts
import type { Types as AblyTypes } from 'ably';
import {
  Msg,
  type MsgType,
  type PayloadByType,
  type Envelope,
  makeEnvelope,
} from '@/networking/protocol';
import { getRealtime, getChannel } from '@/networking/ablyClient';

/**
 * Presence 資料型別（廣播層也要定義一次，避免 any）
 */
export interface PresenceMeta {
  playerId: string;
  name: string;
}

/**
 * 廣播介面：供 main.ts、host-dispatcher、UI 使用
 */
export interface IBroadcast {
  publish<T extends MsgType>(
    type: T,
    payload: PayloadByType[T],
    opts?: { actionId?: string; stateVersion?: number }
  ): Promise<void>;

  subscribe<T extends MsgType>(
    type: T,
    handler: (envelope: Envelope<PayloadByType[T]>) => void
  ): () => void;

  presence(): {
    enter(meta: PresenceMeta): Promise<void>;
    leave(): Promise<void>;
    getMembers(): Promise<Array<{ id: string; data: PresenceMeta }>>;
  };
}

/** ────────────────────────────────────────────────────────────────────────────
 *  內部小工具
 *  ────────────────────────────────────────────────────────────────────────────
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isPresenceMeta(v: unknown): v is PresenceMeta {
  return (
    isRecord(v) &&
    typeof v.playerId === 'string' &&
    v.playerId.length > 0 &&
    typeof v.name === 'string'
  );
}

function isEnvelopeOfType<T extends MsgType>(
  v: unknown,
  type: T
): v is Envelope<PayloadByType[T]> {
  if (!isRecord(v)) return false;
  return v.type === type && 'payload' in v && 'ts' in v && 'schemaVersion' in v;
}

function getEnv(key: string): string {
  // Null Guard：遇到 string | null/undefined 時以 'unknown' 退回或直接擲錯
  const val = (import.meta as unknown as { env: Record<string, string | undefined> }).env[key];
  if (!val) {
    // 這裡直接 throw，以避免把 undefined 傳給 Ably 或後續流程
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

/** ────────────────────────────────────────────────────────────────────────────
 *  工廠：建立 Ably 版廣播
 *  ────────────────────────────────────────────────────────────────────────────
 */

export function createBroadcast(roomId: string, playerId: string): IBroadcast {
  // 檢查 API Key（禁止把 undefined 傳給 Ably）
  // 即使 ablyClient 也會檢查，這裡再次把關，避免錯誤來源不明。
  // 讀取後不使用其值，只為確保存在。
  getEnv('VITE_ABLY_API_KEY');

  const realtime = getRealtime(playerId);
  const clientId = realtime.auth.clientId ?? 'unknown';
  if (clientId !== playerId) {
    // Identity contract：clientId 必須等於 playerId
    throw new Error(
      `[broadcast] clientId (${clientId}) !== playerId (${playerId}); aborting.`
    );
  }

  const channel = getChannel(roomId);

  async function publish<T extends MsgType>(
    type: T,
    payload: PayloadByType[T],
    opts?: { actionId?: string; stateVersion?: number }
  ): Promise<void> {
    const env = makeEnvelope(type, roomId, playerId, payload, opts);
    // 額外的防呆：避免把錯的 senderId 或 type 廣播出去
    if (env.senderId !== playerId || env.type !== type) {
      throw new Error(
        `[broadcast.publish] envelope mismatch: senderId=${env.senderId}, type=${env.type}`
      );
    }

    // 日誌：有助追查
    // eslint-disable-next-line no-console
    console.debug('[broadcast.publish]', { type, roomId, playerId, stateVersion: opts?.stateVersion });

    await channel.publish({ name: type, data: env });
  }

  function subscribe<T extends MsgType>(
    type: T,
    handler: (envelope: Envelope<PayloadByType[T]>) => void
  ): () => void {
    // Ably 的 subscribe 回呼非必須 async；若需要 await，請用 void 包裝避免 no-misused-promises
    const listener = (msg: AblyTypes.Message): void => {
      try {
        const data: unknown = msg.data;
        if (!isEnvelopeOfType(data, type)) {
          // eslint-disable-next-line no-console
          console.warn('[broadcast.subscribe] drop message: not a valid envelope or type mismatch', {
            expected: type,
            gotName: msg.name ?? 'unknown',
          });
          return;
        }
        // eslint-disable-next-line no-console
        console.debug('[broadcast.recv]', {
          type,
          senderId: (data as Envelope<unknown>).senderId ?? 'unknown',
          ts: (data as Envelope<unknown>).ts ?? 0,
        });
        handler(data);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[broadcast.subscribe] handler error', err);
      }
    };

    channel.subscribe(type, listener);
    return () => {
      channel.unsubscribe(type, listener);
      // eslint-disable-next-line no-console
      console.debug('[broadcast.unsubscribe]', { type });
    };
  }

  function presence() {
    return {
      async enter(meta: PresenceMeta): Promise<void> {
        // type guard + Identity contract
        if (!isPresenceMeta(meta)) {
          throw new Error('[broadcast.presence.enter] invalid meta');
        }
        if (meta.playerId !== playerId) {
          throw new Error(
            `[broadcast.presence.enter] meta.playerId (${meta.playerId}) !== playerId (${playerId})`
          );
        }
        // eslint-disable-next-line no-console
        console.debug('[presence.enter]', { clientId: clientId ?? 'unknown', meta });

        await channel.presence.enter(meta);
        // 進房後廣播 system.join（由上層決定是否要送；此層只做 presence.enter）
      },

      async leave(): Promise<void> {
        // eslint-disable-next-line no-console
        console.debug('[presence.leave]', { clientId: clientId ?? 'unknown' });
        await channel.presence.leave();
      },

      async getMembers(): Promise<Array<{ id: string; data: PresenceMeta }>> {
        const list: AblyTypes.PresenceMessage[] = await new Promise((resolve, reject) => {
          channel.presence.get((err?: Error | null, members?: AblyTypes.PresenceMessage[] | null) =>
            err ? reject(err) : resolve(members ?? [])
          );
        });

        // 以 map() 直接回傳物件（不要 push）
        const members = list.map((m) => {
          // Ably 可能回傳 null/undefined，做 Null Guard
          const id = (m.clientId ?? 'unknown') as string;
          const rawData: unknown = m.data;

          let data: PresenceMeta;
          if (isPresenceMeta(rawData)) {
            data = rawData;
          } else {
            // eslint-disable-next-line no-console
            console.warn('[presence.getMembers] invalid meta; coercing', {
              clientId: id,
              data: rawData,
            });
            data = { playerId: id, name: 'unknown' };
          }

          // Identity contract：clientId 必須等於 data.playerId
          if (data.playerId !== id) {
            // eslint-disable-next-line no-console
            console.warn('[presence.getMembers] playerId mismatch; coercing', {
              clientId: id,
              dataPlayerId: data.playerId ?? 'unknown',
            });
            data = { ...data, playerId: id };
          }

          // 也避免 name 為空或 null
          const safeName = (data.name ?? 'unknown').trim();
          return { id, data: { playerId: id, name: safeName.length > 0 ? safeName : 'unknown' } };
        });

        // eslint-disable-next-line no-console
        console.debug('[presence.members]', {
          roomId,
          count: members.length,
          ids: members.map((m) => m.id),
        });
        return members;
      },
    };
  }

  return { publish, subscribe, presence };
}
