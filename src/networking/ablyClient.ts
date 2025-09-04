// src/networking/ablyClient.ts
import Ably from 'ably';
import type { Types as AblyTypes } from 'ably';
import type { PresenceMember, PresenceMeta } from '@/services/broadcast';

/** 環境設定（由外部提供） */
export interface AblyEnv {
  apiKey: string;
  appName: string; // 可作為 channel namespace（選用）
}

/** 對外暴露的 Channel 抽象 */
export interface AblyChannelLike {
  publish: (name: string, data: unknown) => Promise<void>;
  subscribe: (
    name: string,
    cb: (msg: { name: string; data: unknown }) => void
  ) => () => void;
  presence: {
    enter: (meta: PresenceMeta) => Promise<void>;
    leave: () => Promise<void>;
    get: () => Promise<PresenceMember[]>;
  };
}

/** 對外暴露的 Client 抽象 */
export interface AblyClient {
  getChannel: (roomId: string) => AblyChannelLike;
  close: () => Promise<void>;
}

/* eslint-disable no-console */
function log(tag: string, ctx?: Record<string, unknown>): void {
  console.log(`[ABLY] ${tag}`, ctx ?? {});
}
function blog(tag: string, ctx?: Record<string, unknown>): void {
  console.log(`[BUS] ${tag}`, ctx ?? {});
}
/* eslint-enable no-console */

function isPresenceMeta(u: unknown): u is PresenceMeta {
  if (typeof u !== 'object' || u === null) return false;
  const r = u as Record<string, unknown>;
  return typeof r['playerId'] === 'string' && typeof r['name'] === 'string';
}

/**
 * 建立 Ably Realtime Client
 * - **關鍵**：presence 的 clientId 必須等於 playerId（由呼叫端保證）
 */
export function createAblyClient(env: AblyEnv, clientId: string): AblyClient {
  if (!env.apiKey) throw new Error('Ably apiKey is required');
  if (!clientId) throw new Error('Ably clientId (playerId) is required');

  // 使用 Promise 版 API
  const realtime = new Ably.Realtime.Promise({
    key: env.apiKey,
    clientId,
    echoMessages: true
  });

  // 連線狀態 log
  realtime.connection.on((s) => {
    log('conn', {
      current: s.current,
      previous: s.previous,
      retryIn: (s as { retryIn?: number }).retryIn ?? null,
      clientId
    });
  });
  realtime.connection.on('failed', () => {
    log('connection failed');
  });

  /** 將 appName 作為 namespace（存在才使用） */
  const makeChannelName = (roomId: string): string =>
    env.appName && env.appName.trim().length > 0
      ? `${env.appName}:game-${roomId}`
      : `game-${roomId}`;

  /** 只吃 PresenceMessage[] 的 mapper（更單純） */
  function mapPresenceMessages(list: AblyTypes.PresenceMessage[]): PresenceMember[] {
    return list.map((m) => {
      // **唯一真相**：PresenceMember.id = m.clientId
      const id = (m.clientId ?? '') as string;
      const meta: PresenceMeta = isPresenceMeta(m.data)
        ? (m.data as PresenceMeta)
        : { playerId: id, name: id };
      // 強制對齊：meta.playerId 必須等於 id
      const safeMeta: PresenceMeta = { playerId: id, name: meta.name || id };
      return { id, data: safeMeta };
    });
  }

  const getChannel = (roomId: string): AblyChannelLike => {
    const name = makeChannelName(roomId);
    const ch = realtime.channels.get(name);

    const publish = async (event: string, data: unknown): Promise<void> => {
      blog('publish', { channel: name, event });
      await ch.publish(event, data as unknown);
    };

    const subscribe = (
      event: string,
      cb: (msg: { name: string; data: unknown }) => void
    ): (() => void) => {
      blog('subscribe', { channel: name, event });
      const listener = (m: AblyTypes.Message): void => {
        cb({ name: m.name, data: m.data as unknown });
      };
      ch.subscribe(event, listener);
      return () => {
        ch.unsubscribe(event, listener);
        blog('unsubscribe', { channel: name, event });
      };
    };

    const presenceEnter = async (meta: PresenceMeta): Promise<void> => {
      blog('presence.enter', { channel: name, meta });
      await ch.presence.enter(meta);
    };

    const presenceLeave = async (): Promise<void> => {
      blog('presence.leave', { channel: name });
      await ch.presence.leave();
    };

    const presenceGet = async (): Promise<PresenceMember[]> => {
      // 不同版本型別可能是 PresenceMessage[] 或 PaginatedResult<PresenceMessage>
      const res =
        (await ch.presence.get()) as
          | AblyTypes.PresenceMessage[]
          | AblyTypes.PaginatedResult<AblyTypes.PresenceMessage>;

      const list: AblyTypes.PresenceMessage[] = Array.isArray(res) ? res : res.items;
      const members = mapPresenceMessages(list);
      blog('presence.get', { channel: name, ids: members.map((m) => m.id), count: members.length });
      return members;
    };

    return {
      publish,
      subscribe,
      presence: {
        enter: presenceEnter,
        leave: presenceLeave,
        get: presenceGet
      }
    };
  };

  const close = async (): Promise<void> => {
    try {
      await realtime.close();
    } catch {
      // ignore
    }
  };

  return { getChannel, close };
}
