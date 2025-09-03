// src/services/broadcast.ts
// SSoT: 定義 IBroadcast 介面與 Ably Adapter。
// 規範重點：presence 的 id（或底層 clientId）必須等於 playerId；若不同，data.playerId 必須存在且相等。
// 本檔不使用 `any`（已由 ESLint/TS 嚴格禁止）。

import type { AblyChannelLike } from '@/networking/ablyClient';

/** Presence 中廣播的成員資料（由我們規範） */
export interface PresenceMeta {
  playerId: string;
  name: string;
}

/** Presence 成員（id 應等於 playerId） */
export interface PresenceMember {
  id: string;
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

/**
 * Ably Adapter：將 AblyChannelLike 封裝成 IBroadcast。
 * 注意：此處假設 Ably 層已以 room 綁定 channel，且 Realtime clientId=playerId（理想狀態）。
 */
export function createAblyBroadcast(channel: AblyChannelLike): IBroadcast {
  // 驗證 presence 物件 shape（防止外部 SDK 回傳形狀不符合）
  const normalizeMembers = (members: unknown): PresenceMember[] => {
    if (!Array.isArray(members)) return [];
    const result: PresenceMember[] = [];
    for (const m of members) {
      if (
        typeof m === 'object' &&
        m !== null &&
        'id' in m &&
        'data' in m &&
        typeof (m as { id: unknown }).id === 'string'
      ) {
        const id = (m as { id: unknown }).id as string;
        const dataRaw = (m as { data: unknown }).data;
        if (
          typeof dataRaw === 'object' &&
          dataRaw !== null &&
          'playerId' in dataRaw &&
          'name' in dataRaw &&
          typeof (dataRaw as { playerId: unknown }).playerId === 'string' &&
          typeof (dataRaw as { name: unknown }).name === 'string'
        ) {
          const data = {
            playerId: (dataRaw as { playerId: string }).playerId,
            name: (dataRaw as { name: string }).name
          };
          // 規範：presence.id 應等於 data.playerId（若不等，仍回傳但發警告）
          if (id !== data.playerId && typeof console !== 'undefined') {
            // 非致命，但提醒開發者
            console.warn(
              `[broadcast] presence id (${id}) != data.playerId (${data.playerId}). Please align clientId with playerId.`
            );
          }
          result.push({ id, data });
        }
      }
    }
    return result;
  };

  return {
    async publish<TPayload>(topic: string, payload: TPayload): Promise<void> {
      // 對外型別安全，對內用 unknown 承接
      await channel.publish(topic, payload as unknown);
    },

    subscribe<TPayload>(topic: string, handler: (payload: TPayload) => void): () => void {
      // Ably 回傳 { name, data }；我們只把 data 轉交給使用端
      const off = channel.subscribe(topic, (msg: { name: string; data: unknown }) => {
        // 呼叫端自帶 TPayload 型別，這裡僅將 unknown 交給 handler
        handler(msg.data as TPayload);
      });
      return off;
    },

    presence() {
      return {
        async enter(meta: PresenceMeta): Promise<void> {
          // 交由 Ably 層處理 clientId 與 presence.enter
          await channel.presence.enter(meta);
        },

        async leave(): Promise<void> {
          await channel.presence.leave();
        },

        async getMembers(): Promise<PresenceMember[]> {
          const raw = await channel.presence.get();
          return normalizeMembers(raw);
        }
      };
    }
  };
}

/* -------------------------------------------------------------------------- */
/* 可選：記憶體版 IBroadcast（測試/開發用，不依賴 Ably）                       */
/* -------------------------------------------------------------------------- */

type Unsub = () => void;

export function createMemoryBroadcast(): IBroadcast {
  const subs = new Map<string, Array<(payload: unknown) => void>>();
  let members: PresenceMember[] = [];

  const publishSync = (topic: string, payload: unknown): void => {
    const list = subs.get(topic);
    if (!list || list.length === 0) return;
    // 逐一呼叫（同步）；若需要非同步可用 queueMicrotask
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
          const existing = members.find((m) => m.id === meta.playerId);
          if (!existing) {
            members.push({ id: meta.playerId, data: { playerId: meta.playerId, name: meta.name } });
          } else {
            existing.data = { playerId: meta.playerId, name: meta.name };
          }
        },
        async leave(): Promise<void> {
          // 簡化：測試環境下不追蹤 caller 身分，外層可自行重建 broadcast 以模擬離線
          // 若需要可擴充為傳入 playerId
        },
        async getMembers(): Promise<PresenceMember[]> {
          // 回傳淺拷貝避免外部改動內部陣列
          return members.slice();
        }
      };
    }
  };
}
