// src/networking/ablyClient.ts
// Ably 初始化與 IBroadcast 實作（依 README 規範：presence 成員 id == playerId）

import type { IBroadcast } from '@/services/broadcast';
import { Realtime, Types } from 'ably';

type SelfMeta = { playerId: string; name: string };

// -- 讀取環境變數 -------------------------------------------------------------
const ABLY_API_KEY = (import.meta as any).env?.VITE_ABLY_API_KEY as string | undefined;
const APP_NAME = ((import.meta as any).env?.VITE_APP_NAME as string | undefined) ?? 'MyVueGame';

if (!ABLY_API_KEY) {
  // 在應用啟動時就能發現設定錯誤
  throw new Error(
    '[ablyClient] Missing VITE_ABLY_API_KEY in environment (.env). ' +
      'Please set VITE_ABLY_API_KEY=YOUR-ABLY-API-KEY'
  );
}

// -- Realtime 客戶端（以 playerId 為 clientId 建立） ---------------------------
// Ably 連線的 clientId 需與我們的 playerId 完全相同（README 規範）
function createRealtimeForPlayer(playerId: string): Types.RealtimePromise {
  return new Realtime.Promise({
    key: ABLY_API_KEY!,
    clientId: playerId,
    echoMessages: true, // 同步接收自己送出的訊息，方便單機/除錯
    transportParams: { remainPresentFor: 15 }, // 連線斷開後 presence 殘留秒數（微調容錯）
    // NOTE: 如需 dev 調試可開啟：log: { level: 2 }
  });
}

// 等待連線進入 connected（或失敗）
async function waitConnected(rt: Types.RealtimePromise): Promise<void> {
  // 若已連線則直接返回
  if (rt.connection.state === 'connected') return;
  await new Promise<void>((resolve, reject) => {
    const onConnected = () => {
      rt.connection.off('connected', onConnected);
      rt.connection.off('failed', onFailed);
      rt.connection.off('suspended', onFailed);
      resolve();
    };
    const onFailed = (sc: Types.ConnectionStateChange) => {
      rt.connection.off('connected', onConnected);
      rt.connection.off('failed', onFailed);
      rt.connection.off('suspended', onFailed);
      reject(
        new Error(
          `[ablyClient] Connection ${sc.current} ${
            sc.reason ? `: ${sc.reason.message}` : ''
          }`
        )
      );
    };
    rt.connection.on('connected', onConnected);
    rt.connection.on('failed', onFailed);
    rt.connection.on('suspended', onFailed);
  });
}

// -- Channel 名稱（遵循 README） ----------------------------------------------
function channelNameForRoom(roomId: string): string {
  return `game-${roomId}`; // 單一頻道，≤5 人
}

// -- IBroadcast 工廠 -----------------------------------------------------------
/**
 * 建立一個 Ably-backed 的 IBroadcast 實例。
 * - 使用 playerId 作為 Ably clientId（presence.id 與 playerId 對齊）
 * - 以 `game-{roomId}` 為頻道名稱
 * @param roomId 房間代碼
 * @param self   本人資訊（playerId / name）
 */
export async function createAblyBroadcast(
  roomId: string,
  self: SelfMeta
): Promise<IBroadcast> {
  const rt = createRealtimeForPlayer(self.playerId);
  await waitConnected(rt);

  const ch = rt.channels.get(channelNameForRoom(roomId));
  // 也可帶上 appName 做為 channel meta（純註解／除錯用途）
  ch.setOptions({ params: { app: APP_NAME } });

  // -- 發布 -------------------------------------------------------------------
  async function publish<T>(topic: string, payload: T): Promise<void> {
    // Ably 會自動附帶 clientId = self.playerId
    await ch.publish(topic, payload as any);
  }

  // -- 訂閱（回傳取消訂閱函式） ------------------------------------------------
  function subscribe<T>(topic: string, handler: (payload: T) => void): () => void {
    const cb = (msg: Types.Message) => {
      // 僅派送指定 topic 的訊息；資料以 msg.data 承載
      try {
        handler(msg.data as T);
      } catch (err) {
        // 保護性處理，避免使用者 handler 丟例外導致 Ably 退訂
        // eslint-disable-next-line no-console
        console.error('[ablyClient] subscriber threw:', err);
      }
    };
    ch.subscribe(topic, cb);
    return () => ch.unsubscribe(topic, cb);
  }

  // -- Presence ---------------------------------------------------------------
  const presence = () => ({
    /**
     * 進入 presence：Ably 會用連線 clientId（= playerId）作為成員 id。
     * 我們同時把 {playerId, name} 放進 data，供 UI 與 Host 選舉使用。
     */
    async enter(meta: { playerId: string; name: string }): Promise<void> {
      // 依規範：presence 的 id(=clientId) 必須等於 playerId
      if (meta.playerId !== self.playerId) {
        throw new Error(
          `[ablyClient] presence.enter: meta.playerId(${meta.playerId}) must equal self.playerId(${self.playerId})`
        );
      }
      // 確保頻道已 attach（enter 會隱式 attach，但顯式做能更早同步）
      await ch.attach();
      await ch.presence.enter({ playerId: meta.playerId, name: meta.name });
    },

    /** 離開 presence */
    async leave(): Promise<void> {
      try {
        await ch.presence.leave();
      } finally {
        // 若需要，可選擇在此不關閉連線，因為同房間後續仍可能使用
      }
    },

    /**
     * 取得目前 presence 成員清單。
     * 回傳格式：[{ id: playerId, data: { playerId, name } }]
     */
    async getMembers(): Promise<Array<{ id: string; data: { playerId: string; name: string } }>> {
      // waitForSync: 確保已和後端同步完整清單（避免只看到本地暫存）
      const members = (await ch.presence.get({ waitForSync: true })) as Types.PresenceMessage[];
      return members.map((m) => {
        // Ably 的成員識別為 clientId；我們規範 clientId === playerId
        const id = (m.clientId ?? '') as string;
        const data = (m.data ?? {}) as { playerId: string; name: string };
        // 最保守檢查：若底層 clientId 與 data.playerId 不一致，仍以 clientId 為準
        if (data && data.playerId && data.playerId !== id) {
          // eslint-disable-next-line no-console
          console.warn(
            `[ablyClient] presence.getMembers: data.playerId(${data.playerId}) !== clientId(${id}); using clientId`
          );
          data.playerId = id;
        }
        return { id, data: { playerId: data.playerId ?? id, name: data.name ?? '' } };
      });
    },
  });

  // -- 回傳符合 IBroadcast 的實例 ---------------------------------------------
  const bus: IBroadcast = { publish, subscribe, presence };
  return bus;
}

// （可選）輔助：關閉整個 Realtime 連線（測試或頁面卸載時可用）
export async function disposeBroadcastForRoom(
  roomId: string,
  playerId: string
): Promise<void> {
  // 注意：這裡我們每次 create 都新建 Realtime，因此只需關閉當前 rt
  // 若你改為全域單例，請管理好「不同 playerId 需重建 client」的情況。
  const rt = createRealtimeForPlayer(playerId);
  try {
    const ch = rt.channels.get(channelNameForRoom(roomId));
    if (ch) await ch.detach();
  } finally {
    rt.close(); // 關閉連線
  }
}
