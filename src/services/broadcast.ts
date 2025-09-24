// src/services/broadcast.ts
// Phase 2: IBroadcast + Envelope 包裝（對齊 README 與你現有的 ablyClient.ts 介面）
//
// 關鍵對齊點：
// - ablyClient.publishRaw(roomId, type, envelope)
// - ablyClient.subscribeRaw(roomId, type, cb)
// - ablyClient.presence 是物件，方法簽名需傳 roomId
// - 不依賴 getClientId/getRoomId（因為 ablyClient.ts 未輸出）
// - senderId ≡ playerId（取自全域 __PLAYER__ 或 sessionStorage）
// - roomId 來源：globalThis.__ROOM__ 或 sessionStorage.roomId（由 Setup 輸入），允許任意字元，長度 12
//
// Debug（可選）：?debug=1（或 globalThis.__DEBUG__ = true）時輸出 [PUB]/[RECV]

import { nanoid } from 'nanoid';
import {
  makeEnvelope,
  type MsgType,
  type PayloadByType,
  type Envelope,
} from '@/networking/protocol';
import {
  publishRaw,
  subscribeRaw,
  presence as ablyPresence,
} from '@/networking/ablyClient';

/** IBroadcast 介面（與 README 對齊） */
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
    enter(meta: { playerId: string; name: string }): Promise<void>;
    leave(): Promise<void>;
    getMembers(): Promise<Array<{ id: string; data: { playerId: string; name: string } }>>;
  };
}

/** 讀取 debug 旗標（不得使用 any） */
function isDebug(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;
  return Boolean(g.__DEBUG__ === true || readQuery('debug') === '1');
}

/** 保留任意字元，只裁切長度（room: 最多 12；player: 另見 resolvePlayerId） */
function clampLen(raw: string | undefined, max = 12): string {
  return (raw ?? '').slice(0, max);
}

function readQuery(key: string): string | undefined {
  try {
    // 在 SSR 環境 location 可能不存在，包 try/catch
    const url = new URL(globalThis.location?.href ?? '', 'http://local.invalid');
    return url.searchParams.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** roomId 來源：globalThis.__ROOM__ > sessionStorage.roomId；允許任意字元，僅裁切到 12。 */
function resolveRoomId(): string {
  const g = globalThis as unknown as Record<string, unknown>;
  const fromGlobal = typeof g.__ROOM__ === 'string' ? (g.__ROOM__ as string) : undefined;
  let fromSession: string | undefined;
  try { fromSession = sessionStorage.getItem('roomId') || undefined; } catch { fromSession = undefined; }
  const room = clampLen(fromGlobal ?? fromSession, 12);
  if (!room) throw new Error('[Broadcast] Missing roomId (__ROOM__ or sessionStorage.roomId)');
  return room;
}

function resolvePlayerId(): string {
  const g = globalThis as unknown as Record<string, unknown>;
  const fromGlobal = typeof g.__PLAYER__ === 'string' ? (g.__PLAYER__ as string) : undefined;
  let fromSession: string | undefined;
  try {
    fromSession = sessionStorage.getItem('playerId') || undefined;
  } catch {
    fromSession = undefined;
  }

  // PlayerId 仍採安全字元集，長度 24（與現有流程一致）。
  const raw = fromGlobal ?? fromSession;
  const id = (raw ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  if (!id) {
    // 缺 playerId 代表流程未就緒（ensurePlayerId 尚未執行）
    throw new Error('[Broadcast] Missing playerId (__PLAYER__ or sessionStorage.playerId)');
  }
  return id;
}

/** 判斷是否為 Action.* 訊息 */
function isActionType(type: MsgType): boolean {
  return String(type).startsWith('action.');
}

/** 單例：broadcast */
export const broadcast: IBroadcast = {
  async publish<T extends MsgType>(
    type: T,
    payload: PayloadByType[T],
    opts?: { actionId?: string; stateVersion?: number }
  ): Promise<void> {
    const roomId = resolveRoomId();
    const senderId = resolvePlayerId();

    const actionId = opts?.actionId ?? (isActionType(type) ? nanoid() : undefined);

    const env = makeEnvelope<T>(type, roomId, senderId, payload, {
      actionId,
      stateVersion: opts?.stateVersion,
    });

    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.debug('[PUB]', String(type), payload, {
        actionId: env.actionId,
        stateVersion: env.stateVersion,
        roomId,
        senderId,
      });
    }

    await publishRaw<T>(roomId, type, env);
  },

  subscribe<T extends MsgType>(
    type: T,
    handler: (envelope: Envelope<PayloadByType[T]>) => void
  ): () => void {
    const roomId = resolveRoomId();

    // 類型參數顯式化，避免 TS 推斷 any
    const unsubscribe = subscribeRaw<PayloadByType[T]>(
      roomId,
      String(type),
      (env: Envelope<PayloadByType[T]>) => {
        if (isDebug()) {
          // eslint-disable-next-line no-console
          console.debug('[RECV]', env);
        }
        handler(env);
      }
    );
    return unsubscribe;
  },

  presence() {
    const roomId = resolveRoomId();
    return {
      enter(meta: { playerId: string; name: string }) {
        return ablyPresence.enter(roomId, meta);
      },
      leave() {
        return ablyPresence.leave(roomId);
      },
      async getMembers() {
        return ablyPresence.getMembers(roomId);
      },
    };
  },
};

export default broadcast;
