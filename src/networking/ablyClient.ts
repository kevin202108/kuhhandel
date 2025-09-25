// src/networking/ablyClient.ts
import * as Ably from 'ably';
import type { Envelope, MsgType } from '@/networking/protocol';

/**
 * 單例 Realtime client（使用 Promise 版 API）
 * Identity Contract：clientId === playerId
 */
let client: Ably.Types.RealtimePromise | null = null;

function maybeApiKey(): string | undefined {
  const key = import.meta.env.VITE_ABLY_API_KEY as string | undefined;
  return key;
}

/** 將 playerId 正規化（[a-z0-9_-]{1,24}） */
function normalizeId(raw: string): string {
  const s = (raw ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  return s || 'dev';
}

function channelName(roomId: string): string {
  // Room 允許任意字元，但僅限 12 字；為避免 Ably 將特殊符號誤判為參數，這裡以 encodeURIComponent 安全嵌入。
  const safe = encodeURIComponent((roomId ?? '').slice(0, 12));
  return `game-v1-${safe}`;
}

/** 初始化（若已建立則直接回傳現有實例） */
export function initAbly(playerId: string, roomId?: string): Ably.Types.RealtimePromise {
  if (client) return client;

  const pid = normalizeId(playerId);
  const key = maybeApiKey();

  // Prefer Token Auth via Netlify Function. Fallback to key only if provided.
  const cfg: Ably.Types.ClientOptions = key
    ? { key, clientId: pid }
    : (() => {
        const authParams: Record<string, string> = { clientId: pid };
        if (roomId) authParams.roomId = normalizeId(roomId);
        return {
          clientId: pid,
          authUrl: '/.netlify/functions/ably-token',
          authMethod: 'POST',
          authParams,
        } as Ably.Types.ClientOptions;
      })();

  client = new Ably.Realtime.Promise(cfg);
  return client!;
}

function assertClient(): void {
  if (!client) throw new Error('[Ably] initAbly(playerId) must be called first');
}

/** 取得頻道 */
export function getChannel(roomId: string): Ably.Types.RealtimeChannelPromise {
  assertClient();
  return client!.channels.get(channelName(roomId));
}

/** 發送原始 Envelope（不幫你包） */
export async function publishRaw<T extends MsgType>(
  roomId: string,
  type: T,
  envelope: Envelope
): Promise<void> {
  const ch = getChannel(roomId);
  await ch.publish(type, envelope);
}

/**
 * 訂閱原始 Envelope（不解析，直接給你 Envelope<T>）
 * 回傳取消訂閱函式
 *
 * 注意：
 * - 為了同時相容 Ably v1 / v2 的型別差異，使用了輕量型別斷言來呼叫 subscribe/unsubscribe。
 * - 你若在別處直接使用 `Ably.Types.messageCallback`，記得在 v2 需補型參 <Ably.Types.Message>。
 */
export function subscribeRaw<T>(
  roomId: string,
  type: string,
  cb: (envelope: Envelope<T>) => void
): () => void {
  const ch = getChannel(roomId);

  // 明確註記 msg 的型別，解掉 TS7006
  const handler = (msg: Ably.Types.Message) => {
    cb(msg.data as Envelope<T>);
  };

  // 兼容 v1/v2：兩個版本對 subscribe 的型別不完全相同
  type SubscribeFn = (name: string, cb: (m: Ably.Types.Message) => void) => void | Promise<void>;
  type UnsubscribeFn = (name: string, cb: (m: Ably.Types.Message) => void) => void;

  (ch.subscribe as unknown as SubscribeFn)(type, handler);
  return () => (ch.unsubscribe as unknown as UnsubscribeFn)(type, handler);
}

/** Presence 代理：id 一律對齊 clientId（= playerId） */
export const presence = {
  async enter(roomId: string, meta: { playerId: string; name: string }) {
    const ch = getChannel(roomId);
    await ch.presence.enter(meta);
  },
  async leave(roomId: string) {
    const ch = getChannel(roomId);
    await ch.presence.leave();
  },
  async getMembers(roomId: string) {
    const ch = getChannel(roomId);
    const members = await ch.presence.get(); // Ably => PresenceMessage[]
    // 去重：同一 clientId 可能因為上一次連線未及時離場而暫時出現多筆
    // 取 timestamp 較新的那筆，避免 UI/邏輯將同一玩家視為多人
    const byId = new Map<string, Ably.Types.PresenceMessage>();
    for (const m of members) {
      const id = m.clientId ?? '';
      if (!id) continue;
      const prev = byId.get(id);
      if (!prev || ((m.timestamp || 0) > (prev.timestamp || 0))) {
        byId.set(id, m);
      }
    }
    return Array.from(byId.values()).map((m) => ({
      id: m.clientId ?? '', // 我們的 Identity Contract：id === clientId
      data: (m.data ?? {}) as { playerId: string; name: string },
    }));
  },
  subscribePresenceEvents(roomId: string, onEvent: (action: 'enter' | 'leave', member: { id: string; data: { playerId: string; name: string } }) => void): () => void {
    const ch = getChannel(roomId);
    const handler = (msg: Ably.Types.PresenceMessage) => {
      onEvent(msg.action as 'enter' | 'leave', {
        id: msg.clientId ?? '',
        data: (msg.data ?? {}) as { playerId: string; name: string },
      });
    };
    ch.presence.subscribe(handler);
    return () => ch.presence.unsubscribe(handler);
  },
};

/** 關閉連線（測試/離場可用） */
export function closeAbly() {
  if (client) {
    client.connection.close();
    client = null;
  }
}
