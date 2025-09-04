// src/networking/ablyClient.ts
import * as Ably from 'ably';

/**
 * Phase 2 連線層規範：
 * - 必須以 clientId = playerId 建立 Realtime（嚴禁先連再改 id）。
 * - presence.id (=clientId) 必須等於 presence.data.playerId。
 * - 單頁單例；不同 playerId 二次初始化會拋錯。
 * - 所有重要連線/頻道/Presence 狀態都打 log。
 */

type PresenceMeta = { playerId: string; name: string };

// --- env key（以型別守衛保證 string） ---
function getAblyKey(): string {
  const raw = import.meta.env.VITE_ABLY_API_KEY as unknown;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('[ablyClient] Missing/invalid VITE_ABLY_API_KEY');
  }
  return raw;
}

// ---- Module-singleton state ----
let realtime: Ably.Realtime | null = null;
let activeClientId: string | null = null;

const channels = new Map<string, Ably.Types.RealtimeChannelCallbacks>();
let activeChannel: Ably.Types.RealtimeChannelCallbacks | null = null;

// ---- Internal helpers ----
function isPresenceMeta(x: unknown): x is PresenceMeta {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.playerId === 'string' && typeof o.name === 'string';
}

function logConnectionChange(change: Ably.Types.ConnectionStateChange, clientId: string) {
  const details = {
    prev: change.previous,
    curr: change.current,
    reason: change.reason?.message ?? null,
    clientId,
    connectionId: realtime?.connection.id ?? null
  };
  // eslint-disable-next-line no-console
  console.info('[ably][connection]', details);
}

function logChannelChange(
  roomId: string,
  change: Ably.Types.ChannelStateChange,
  clientId: string
) {
  const details = {
    roomId,
    prev: change.previous,
    curr: change.current,
    reason: change.reason?.message ?? null,
    clientId,
    connectionId: realtime?.connection.id ?? null
  };
  // eslint-disable-next-line no-console
  console.info('[ably][channel]', details);
}

function assertClientId(expected: string): void {
  const actual = realtime?.auth.clientId;
  if (!actual) {
    throw new Error('[ablyClient] Realtime not authenticated with a clientId');
  }
  if (actual !== expected) {
    throw new Error(
      `[ablyClient] clientId mismatch. expected=${expected} actual=${actual}. ` +
        'Instantiate Ably with clientId=playerId.'
    );
  }
}

// ---- Promisified wrappers for callback-style API ----
function attachAsync(ch: Ably.Types.RealtimeChannelCallbacks): Promise<void> {
  return new Promise((resolve, reject) => {
    ch.attach((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

function presenceEnterAsync(
  ch: Ably.Types.RealtimeChannelCallbacks,
  data: PresenceMeta
): Promise<void> {
  return new Promise((resolve, reject) => {
    ch.presence.enter(data, (err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

function presenceLeaveAsync(ch: Ably.Types.RealtimeChannelCallbacks): Promise<void> {
  return new Promise((resolve, reject) => {
    ch.presence.leave((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

function presenceGetAsync(
  ch: Ably.Types.RealtimeChannelCallbacks
): Promise<Ably.Types.PresenceMessage[]> {
  return new Promise((resolve, reject) => {
    ch.presence.get((err?: Error | null, members?: Ably.Types.PresenceMessage[] | null) =>
      err ? reject(err) : resolve(members ?? [])
    );
  });
}

// ---- Public API ----

/**
 * 以 clientId = playerId 建立單一 Realtime 實例。
 * 同頁多次以相同 playerId 呼叫會回傳同一實例；不同 playerId 會拋錯。
 */
export function getRealtime(playerId: string): Ably.Realtime {
  if (!playerId || typeof playerId !== 'string') {
    throw new Error('[ablyClient] Invalid playerId');
  }

  if (realtime) {
    if (activeClientId !== playerId) {
      throw new Error(
        `[ablyClient] Already initialised with clientId=${activeClientId}; ` +
          `refusing to reinitialise with playerId=${playerId}.`
      );
    }
    return realtime;
  }

  // 建立 Realtime：立刻綁定 clientId=playerId
  realtime = new Ably.Realtime({
    key: getAblyKey(),
    clientId: playerId,
    // 偵錯友善選項（可視需要調整）
    echoMessages: true,
    realtimeRequestTimeout: 10_000
  });

  activeClientId = playerId;

  // 連線狀態日誌
  realtime.connection.on((change: Ably.Types.ConnectionStateChange) =>
    logConnectionChange(change, playerId)
  );

  realtime.connection.once('connected', () => {
    // eslint-disable-next-line no-console
    console.info('[ably][connected]', {
      clientId: realtime?.auth.clientId,
      connectionId: realtime?.connection.id
    });
  });

  return realtime;
}

/**
 * 取得/附掛一個頻道，並註冊狀態變化日誌。
 * 建議 roomId 已含版本前綴，如：game-v1-{roomId}
 */
export function getChannel(roomId: string): Ably.Types.RealtimeChannelCallbacks {
  if (!realtime || !activeClientId) {
    throw new Error('[ablyClient] Call getRealtime(playerId) before getChannel(roomId)');
  }
  assertClientId(activeClientId);

  if (channels.has(roomId)) {
    const ch = channels.get(roomId)!;
    activeChannel = ch;
    return ch;
  }

  const ch = realtime.channels.get(roomId);
  const clientId: string = activeClientId; // 捕獲已窄化的 clientId

  // 頻道狀態日誌
  ch.on((change: Ably.Types.ChannelStateChange) => logChannelChange(roomId, change, clientId));

  // 主動 attach 以更快拿到 presence 成員
  attachAsync(ch)
    .then(() => {
      // eslint-disable-next-line no-console
      console.info('[ably][channel][attached]', { roomId, clientId });
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[ably][channel][attach:error]', { roomId, err });
    });

  channels.set(roomId, ch);
  activeChannel = ch;
  return ch;
}

/**
 * presence.enter(meta)：要求 meta.playerId 必須等於 clientId。
 * 會印出 enter 結果與目前 snapshot（id, data.playerId）。
 */
export async function presenceEnter(meta: PresenceMeta): Promise<void> {
  if (!activeChannel || !realtime || !activeClientId) {
    throw new Error('[ablyClient] No active channel. Call getChannel(roomId) first.');
  }
  assertClientId(activeClientId);

  if (meta.playerId !== activeClientId) {
    throw new Error(
      `[ablyClient] presence.enter mismatch: meta.playerId=${meta.playerId} != clientId=${activeClientId}`
    );
  }

  await presenceEnterAsync(activeChannel, meta);
  // eslint-disable-next-line no-console
  console.info('[ably][presence][enter]', {
    roomId: activeChannel.name,
    clientId: activeClientId,
    connectionId: realtime.connection.id,
    meta
  });

  // 印出 snapshot（方便核對重複 id）
  const members = await presenceMembers();
  // eslint-disable-next-line no-console
  console.info('[ably][presence][snapshot]', members);
}

/** presence.leave()：離開當前頻道。 */
export async function presenceLeave(): Promise<void> {
  if (!activeChannel || !realtime) return;
  const roomId = activeChannel.name;
  await presenceLeaveAsync(activeChannel);
  // eslint-disable-next-line no-console
  console.info('[ably][presence][leave]', {
    roomId,
    clientId: realtime.auth.clientId,
    connectionId: realtime.connection.id
  });
}

/**
 * 取得當前頻道的 presence 成員列表（id=clientId）。
 * 若成員帶有 data.playerId，將檢查其是否等於 id；不一致則拋錯（違反 Identity Contract）。
 */
export async function presenceMembers(): Promise<
  Array<{ id: string; data: PresenceMeta | null }>
> {
  if (!activeChannel) {
    throw new Error('[ablyClient] No active channel. Call getChannel(roomId) first.');
  }
  const list = await presenceGetAsync(activeChannel); // PresenceMessage[]
  const mapped: Array<{ id: string; data: PresenceMeta | null }> = [];

  for (const m of list) {
    const id = (m.clientId ?? '').toString();
    const dataUnknown = m.data as unknown;
    let data: PresenceMeta | null = null;

    if (dataUnknown !== undefined && dataUnknown !== null) {
      if (!isPresenceMeta(dataUnknown)) {
        // eslint-disable-next-line no-console
        console.warn('[ably][presence][warn] data shape invalid', { id, data: dataUnknown });
      } else {
        data = dataUnknown;
      }
    }

    if (data && data.playerId !== id) {
      // 嚴格違規：clientId 與 data.playerId 不一致
      // eslint-disable-next-line no-console
      console.error('[ably][presence][ERROR] clientId != data.playerId', { id, data });
      throw new Error(
        `[ablyClient] Presence invariant violated: clientId(${id}) != data.playerId(${data.playerId})`
      );
    }

    mapped.push({ id, data });
  }

  return mapped;
}

// （可選）提供目前 activeChannel 名稱，方便外界 debug
export function getActiveChannelName(): string | null {
  return activeChannel?.name ?? null;
}
