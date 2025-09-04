// src/services/broadcast.ts
// SSoT: 定義 IBroadcast 介面與 Ably Adapter。
// 規範重點：PresenceMember.id（= clientId）必須等於 playerId；若 SDK 回傳不同，adapter 需將 data.playerId 修正為 id。
// 本檔不使用 any。

import type { AblyChannelLike } from '@/networking/ablyClient';

/** Presence 中廣播的成員資料（由我們規範） */
export interface PresenceMeta {
  playerId: string;
  name: string;
}

/** Presence 成員（id 必須等於 playerId） */
export interface PresenceMember {
  id: string;        // == playerId（以底層 clientId 為準）
  data: PresenceMeta;
}

/** 對應 README 的抽象事件匯流排（可由 Ably、記憶體等實作） */
export interface IBroadcast {
  publish<TPayload>(topic: string, payload: TPayload): Promise<void>;
  subscribe<TPayload>(topic: string, handler: (payload: TPayload) => void): () => void;
  presence(): {
    enter(meta: PresenceMeta): Promise<void>;
    leave(): Promise<void>;
    getMembers(): Promise<PresenceMember[]>;
  };
}

/* ------------------------------------------------------- */
/* 小工具（型別守門＆log）                                  */
/* ------------------------------------------------------- */
function isPresenceMeta(u: unknown): u is PresenceMeta {
  if (typeof u !== 'object' || u === null) return false;
  const r = u as Record<string, unknown>;
  return typeof r['playerId'] === 'string' && typeof r['name'] === 'string';
}

function isString(u: unknown): u is string {
  return typeof u === 'string';
}

/* eslint-disable no-console */
function log(tag: string, ctx?: Record<string, unknown>): void {
  console.log(`[BUS] ${tag}`, { ...(ctx ?? {}) });
}
function warn(tag: string, ctx?: Record<string, unknown>): void {
  console.warn(`[BUS] ${tag}`, { ...(ctx ?? {}) });
}
/* eslint-enable no-console */

/* ------------------------------------------------------- */
/* Ably Adapter                                             */
/* ------------------------------------------------------- */
/**
 * Ably Adapter：將 AblyChannelLike 封裝成 IBroadcast。
 * 注意：
 *  - PresenceMember.id 一律使用 Ably PresenceMessage 的 clientId
 *  - PresenceMember.data.playerId 若與 id 不同，將覆寫為 id（並印出警告）
 */
export function createAblyBroadcast(channel: AblyChannelLike): IBroadcast {
  // 將 Ably presence.get() 的回傳正規化為 PresenceMember[]
  const normalizeMembers = (members: unknown): PresenceMember[] => {
    if (!Array.isArray(members)) return [];
    const out: PresenceMember[] = [];

    for (const m of members) {
      if (typeof m !== 'object' || m === null) continue;
      const raw = m as Record<string, unknown>;

      // Ably PresenceMessage 常見欄位：clientId, data
      const clientId = raw['clientId'];
      const dataRaw = raw['data'];

      // 允許某些 SDK 變體把 id 放在 id 欄位（備援）
      const fallbackId = raw['id'];

      const id = isString(clientId)
        ? clientId
        : isString(fallbackId)
        ? fallbackId
        : '';

      if (!id) continue; // 沒 id（clientId）不採計

      let meta: PresenceMeta;
      if (isPresenceMeta(dataRaw)) {
        meta = { playerId: dataRaw.playerId, name: dataRaw.name };
      } else {
        // 沒有 meta 就以 id 補 playerId，name 空字串
        meta = { playerId: id, name: '' };
      }

      // 強制一致：id === meta.playerId；若不同，以 id 覆寫並警告
      if (meta.playerId !== id) {
        warn('presence.meta-mismatch', { id, metaPlayerId: meta.playerId });
        meta = { playerId: id, name: meta.name };
      }

      out.push({ id, data: meta });
    }

    return out;
  };

  return {
    async publish<TPayload>(topic: string, payload: TPayload): Promise<void> {
      log('publish', { topic });
      await channel.publish(topic, payload as unknown);
    },

    subscribe<TPayload>(topic: string, handler: (payload: TPayload) => void): () => void {
      log('subscribe', { topic });
      const off = channel.subscribe(topic, (msg: { name: string; data: unknown }) => {
        // 我們只把 data 交給上層；型別由呼叫者帶入 TPayload
        handler(msg.data as TPayload);
      });
      return () => {
        off();
        log('unsubscribe', { topic });
      };
    },

    presence() {
      return {
        async enter(meta: PresenceMeta): Promise<void> {
          log('presence.enter', { meta });
          await channel.presence.enter(meta);
        },
        async leave(): Promise<void> {
          log('presence.leave');
          await channel.presence.leave();
        },
        async getMembers(): Promise<PresenceMember[]> {
          const raw = await channel.presence.get();
          const mapped = normalizeMembers(raw);
          log('presence.get', {
            count: mapped.length,
            ids: mapped.map((m) => m.id)
          });
          return mapped;
        }
      };
    }
  };
}

/* ------------------------------------------------------- */
/* 記憶體版 IBroadcast（測試/開發用，不依賴 Ably）            */
/* ------------------------------------------------------- */

type Unsub = () => void;

export function createMemoryBroadcast(): IBroadcast {
  const subs = new Map<string, Array<(payload: unknown) => void>>();
  const members: PresenceMember[] = [];

  const publishSync = (topic: string, payload: unknown): void => {
    const list = subs.get(topic);
    if (!list || list.length === 0) return;
    for (const h of list) h(payload);
  };

  return {
    async publish<TPayload>(topic: string, payload: TPayload): Promise<void> {
      publishSync(topic, payload as unknown);
    },

    subscribe<TPayload>(topic: string, handler: (payload: TPayload) => void): Unsub {
      const wrapped = (p: unknown) => handler(p as TPayload);
      const list = subs.get(topic) ?? [];
      list.push(wrapped);
      subs.set(topic, list);

      return () => {
        const arr = subs.get(topic);
        if (!arr) return;
        const idx = arr.indexOf(wrapped);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },

    presence() {
      return {
        async enter(meta: PresenceMeta): Promise<void> {
          const existingIndex = members.findIndex((m) => m.id === meta.playerId);
          if (existingIndex === -1) {
            members.push({ id: meta.playerId, data: { playerId: meta.playerId, name: meta.name } });
          } else {
            members[existingIndex] = {
              id: meta.playerId,
              data: { playerId: meta.playerId, name: meta.name }
            };
          }
        },
        async leave(): Promise<void> {
          // 簡化：不追蹤呼叫者，外層若要模擬離線可重建此 adapter
        },
        async getMembers(): Promise<PresenceMember[]> {
          return members.slice();
        }
      };
    }
  };
}
