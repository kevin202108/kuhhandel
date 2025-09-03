// src/services/broadcast.ts
/**
 * IBroadcast 抽象層 + Ably Adapter + Memory Adapter（測試用）
 * - 嚴格使用 unknown（不使用 any）
 * - 以型別守門縮小 unknown，避免 TS2339
 */

///////////////////////////////
// Public Interface
///////////////////////////////

export interface IBroadcast {
  publish<T>(topic: string, payload: T): Promise<void>;
  subscribe<T>(topic: string, handler: (payload: T) => void): () => void;
  presence(): {
    enter(meta: { playerId: string; name: string }): Promise<void>;
    leave(): Promise<void>;
    getMembers(): Promise<Array<{ id: string; data: { playerId: string; name: string } }>>;
  };
}

///////////////////////////////
// Minimal Ably-Like Channel Types (decoupled from SDK)
///////////////////////////////

type AblyMessage = { name?: string; data: unknown };
type AblyListener = (msg: AblyMessage) => void;

type AblyPresenceMember = {
  id: string;
  clientId?: string;
  data?: unknown;
};

type AblyPresence = {
  enter: (data: unknown) => Promise<void> | void;
  leave: () => Promise<void> | void;
  get: () => Promise<AblyPresenceMember[]> | AblyPresenceMember[];
};

export type AblyChannel = {
  publish: (name: string, data: unknown) => Promise<void> | void;
  subscribe: ((listener: AblyListener) => void) & ((name: string, listener: AblyListener) => void);
  unsubscribe: ((listener?: AblyListener) => void) & ((name: string, listener?: AblyListener) => void);
  presence: AblyPresence;
};

///////////////////////////////
// Ably Adapter → IBroadcast
///////////////////////////////

export function createAblyBroadcast(channel: AblyChannel): IBroadcast {
  return {
    async publish<T>(topic: string, payload: T): Promise<void> {
      try {
        await Promise.resolve(channel.publish(topic, payload as unknown));
      } catch (err) {
        console.error('[broadcast] publish failed:', topic, err);
        throw err;
      }
    },

    subscribe<T>(topic: string, handler: (payload: T) => void): () => void {
      const listener: AblyListener = (msg) => {
        try {
          // 呼叫端自己決定 T；這裡僅轉型，不做 runtime schema 驗證
          handler(msg.data as T);
        } catch (err) {
          console.error('[broadcast] subscriber handler error:', err);
        }
      };

      try {
        if (topic === '*') {
          channel.subscribe(listener);
          return () => channel.unsubscribe(listener);
        } else {
          channel.subscribe(topic, listener);
          return () => channel.unsubscribe(topic, listener);
        }
      } catch (err) {
        console.error('[broadcast] subscribe failed:', topic, err);
        return () => {};
      }
    },

    presence() {
      return {
        async enter(meta: { playerId: string; name: string }): Promise<void> {
          try {
            await Promise.resolve(channel.presence.enter({ playerId: meta.playerId, name: meta.name }));
          } catch (err) {
            console.error('[broadcast.presence] enter failed:', err);
            throw err;
          }
        },

        async leave(): Promise<void> {
          try {
            await Promise.resolve(channel.presence.leave());
          } catch (err) {
            console.error('[broadcast.presence] leave failed:', err);
          }
        },

        async getMembers(): Promise<Array<{ id: string; data: { playerId: string; name: string } }>> {
          try {
            const raw = await Promise.resolve(channel.presence.get());
            return raw.map(normalizePresenceMember);
          } catch (err) {
            console.error('[broadcast.presence] getMembers failed:', err);
            return [];
          }
        },
      };
    },
  };
}

///////////////////////////////
// Presence normalize with unknown-safe narrowing
///////////////////////////////

function normalizePresenceMember(
  m: AblyPresenceMember
): { id: string; data: { playerId: string; name: string } } {
  const id = toStringSafe(m.clientId ?? m.id ?? '');
  const meta = isObject(m.data) ? (m.data as Record<string, unknown>) : emptyRecord;

  const playerId = toStringSafe((meta['playerId'] as unknown) ?? m.clientId ?? m.id ?? '');
  const name = toStringSafe(meta['name']);

  if (!id || !playerId) {
    console.warn('[broadcast.presence] member missing id/playerId; raw:', m);
  }
  return { id: id || playerId, data: { playerId: playerId || id, name } };
}

const emptyRecord: Record<string, unknown> = Object.freeze({});

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toStringSafe(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  try {
    return String(v);
  } catch {
    return '';
  }
}

///////////////////////////////
// Memory Adapter (tests / offline)
///////////////////////////////

export function createMemoryBroadcast(): IBroadcast {
  type Handler = (payload: unknown) => void;

  const topicMap = new Map<string, Set<Handler>>();
  const starSet = new Set<Handler>();
  let members: Array<{ id: string; data: { playerId: string; name: string } }> = [];

  function add(topic: string, h: Handler) {
    if (topic === '*') {
      starSet.add(h);
      return () => starSet.delete(h);
    }
    let set = topicMap.get(topic);
    if (!set) {
      set = new Set<Handler>();
      topicMap.set(topic, set);
    }
    set.add(h);
    return () => {
      set!.delete(h);
      if (set!.size === 0) topicMap.delete(topic);
    };
  }

  async function publish(topic: string, payload: unknown): Promise<void> {
    const list = topicMap.get(topic);
    if (list && list.size) {
      for (const h of Array.from(list)) {
        try {
          h(payload);
        } catch (err) {
          console.error('[memory-broadcast] handler error:', err);
        }
      }
    }
    if (starSet.size) {
      for (const h of Array.from(starSet)) {
        try {
          h(payload);
        } catch (err) {
          console.error('[memory-broadcast] * handler error:', err);
        }
      }
    }
  }

  return {
    publish,
    subscribe<T>(topic: string, handler: (payload: T) => void): () => void {
      return add(topic, ((p: unknown) => handler(p as T)) as Handler);
    },
    presence() {
      return {
        async enter(meta: { playerId: string; name: string }): Promise<void> {
          const id = meta.playerId;
          const exists = members.some((m) => m.id === id);
          if (!exists) {
            members.push({ id, data: { playerId: meta.playerId, name: meta.name } });
          } else {
            members = members.map((m) =>
              m.id === id ? { id, data: { playerId: meta.playerId, name: meta.name } } : m
            );
          }
        },
        async leave(): Promise<void> {
          // 簡化：若需要可擴充 leave(playerId) 來準確移除
        },
        async getMembers(): Promise<Array<{ id: string; data: { playerId: string; name: string } }>> {
          return members.slice();
        },
      };
    },
  };
}

///////////////////////////////
// Optional helper
///////////////////////////////

export function assertClientIdMatchesPlayerId(
  actualClientId: string | undefined,
  expectedPlayerId: string | undefined
) {
  if (!expectedPlayerId) return;
  if (actualClientId && actualClientId !== expectedPlayerId) {
    console.warn(
      `[broadcast] clientId (${actualClientId}) != playerId (${expectedPlayerId}). ` +
        'Ensure Ably Realtime is created with clientId = playerId.'
    );
  }
}
