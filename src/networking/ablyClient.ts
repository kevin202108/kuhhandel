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

/**
 * 建立 Ably Realtime Client
 * - 依 README：presence 的 clientId 必須等於 playerId（由呼叫端保證）
 */
export function createAblyClient(env: AblyEnv, clientId: string): AblyClient {
  const realtime = new Ably.Realtime({
    key: env.apiKey,
    clientId
  });

  /** 將 appName 作為 namespace（存在才使用） */
  const makeChannelName = (roomId: string): string =>
    env.appName && env.appName.trim().length > 0
      ? `${env.appName}:game-${roomId}`
      : `game-${roomId}`;

  /** 將 Ably 的 callback API 轉為 Promise<void>，允許 err 為 undefined */
  type ErrorCb = (err?: AblyTypes.ErrorInfo | null) => void;
  const promisifyVoid = (register: (cb: ErrorCb) => void): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      register((err) => {
        if (err) {
          reject(new Error(err.message ?? 'Ably operation failed'));
        } else {
          resolve();
        }
      });
    });

  /** 將 Presence 列表映射為我們的 PresenceMember 型別 */
  const mapPresenceMembers = (
    list: AblyTypes.PaginatedResult<AblyTypes.PresenceMessage> | AblyTypes.PresenceMessage[]
  ): PresenceMember[] => {
    const arr: AblyTypes.PresenceMessage[] = Array.isArray(list) ? list : list.items;
    return arr.map((m) => {
      const raw = m.data;
      const d: Partial<PresenceMeta> =
        typeof raw === 'object' && raw !== null ? (raw as Partial<PresenceMeta>) : {};
      const playerId =
        typeof d.playerId === 'string' && d.playerId.length > 0 ? d.playerId : m.clientId;
      const name = typeof d.name === 'string' && d.name.length > 0 ? d.name : playerId;
      return { id: playerId, data: { playerId, name } };
    });
  };

  const getChannel = (roomId: string): AblyChannelLike => {
    const ch = realtime.channels.get(makeChannelName(roomId));

    const publish = (name: string, data: unknown): Promise<void> =>
      promisifyVoid((cb) => {
        // 直接傳 unknown 給 Ably（目標型別為 any，unknown 可賦值給 any）
        ch.publish(name, data, cb as AblyTypes.errorCallback);
      });

    const subscribe = (
      name: string,
      cb: (msg: { name: string; data: unknown }) => void
    ): (() => void) => {
      const listener = (m: AblyTypes.Message): void => {
        cb({ name: m.name, data: m.data as unknown });
      };
      ch.subscribe(name, listener);
      return () => {
        ch.unsubscribe(name, listener);
      };
    };

    const presenceEnter = (meta: PresenceMeta): Promise<void> =>
      promisifyVoid((cb) => ch.presence.enter(meta, cb as AblyTypes.errorCallback));

    const presenceLeave = (): Promise<void> =>
      promisifyVoid((cb) => ch.presence.leave(cb as AblyTypes.errorCallback));

    const presenceGet = async (): Promise<PresenceMember[]> =>
      new Promise<PresenceMember[]>((resolve, reject) => {
        ch.presence.get((err?: AblyTypes.ErrorInfo | null, members?: AblyTypes.PresenceMessage[]) => {
          if (err) {
            reject(new Error(err.message ?? 'Ably presence.get failed'));
            return;
          }
          if (!members) {
            resolve([]);
            return;
          }
          resolve(mapPresenceMembers(members));
        });
      });

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

  const close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      realtime.close(); // Ably 不提供 close 回呼；直接 resolve
      resolve();
    });

  return { getChannel, close };
}
