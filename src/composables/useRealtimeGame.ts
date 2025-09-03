// src/composables/useRealtimeGame.ts
import { ref, Ref, onBeforeUnmount } from 'vue';
import { nanoid } from 'nanoid';
import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import type { GameState } from '@/types/game';
import { Msg, type MsgType } from '@/networking/protocol';
import type { Envelope } from '@/networking/protocol';
import type { IBroadcast } from '@/services/broadcast';
import { getHostId } from '@/services/host-election';

/** ---- Payload 型別映射（避免 any） ---- */
type ChooseAuctionPayload = { playerId: string };
type ChooseCowTradePayload = { playerId: string };
type PlaceBidPayload = { playerId: string; moneyCardIds: string[] };
type PassBidPayload = { playerId: string };
type HostAwardPayload = { playerId: string };

type StateUpdatePayload = { state: GameState };
type SystemRequestStatePayload = { requesterId: string };
type SystemHostChangedPayload = { newHostId: string };
type SystemJoinPayload = { playerId: string; name: string };
type SystemLeavePayload = { playerId: string };

/** 將所有訊息 type 對應到 payload 型別 */
type PayloadMap = {
  [Msg.Action.ChooseAuction]: ChooseAuctionPayload;
  [Msg.Action.ChooseCowTrade]: ChooseCowTradePayload;
  [Msg.Action.PlaceBid]: PlaceBidPayload;
  [Msg.Action.PassBid]: PassBidPayload;
  [Msg.Action.HostAward]: HostAwardPayload;

  [Msg.State.Update]: StateUpdatePayload;

  [Msg.System.RequestState]: SystemRequestStatePayload;
  [Msg.System.HostChanged]: SystemHostChangedPayload;
  [Msg.System.Join]: SystemJoinPayload;
  [Msg.System.Leave]: SystemLeavePayload;
};

/** 工具：從 MsgType 取得對應 payload 型別 */
type PayloadOf<T extends MsgType> = T extends keyof PayloadMap ? PayloadMap[T] : never;

/** LRU 去重緩衝（固定容量） */
class DedupBuffer {
  private set: Set<string>;
  private queue: string[];
  private readonly cap: number;
  constructor(capacity: number) {
    this.cap = capacity;
    this.set = new Set<string>();
    this.queue = [];
  }
  /** 回傳 true 表示是新的（可處理），false 表示重覆（應丟棄） */
  add(id: string): boolean {
    if (this.set.has(id)) return false;
    this.set.add(id);
    this.queue.push(id);
    if (this.queue.length > this.cap) {
      const old = this.queue.shift();
      if (old) this.set.delete(old);
    }
    return true;
  }
  clear(): void {
    this.set.clear();
    this.queue = [];
  }
}

/** useRealtimeGame 輸出介面 */
export interface RealtimeGame {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  dispatch: <T extends MsgType>(type: T, payload: PayloadOf<T>) => Promise<void>;
  isHost: Ref<boolean>;
  hostId: Ref<string | null>;
  lastError: Ref<string | null>;
}

/** 建構參數 */
export interface RealtimeOptions {
  broadcast: IBroadcast;
  /** presence 輪詢毫秒數（用於偵測 Host 遷移）；預設 2000 */
  presencePollMs?: number;
  /** localStorage key 前綴，預設 'game'（Host 端持久化快照） */
  storagePrefix?: string;
}

/** 玩家識別 */
export interface PlayerIdentity {
  playerId: string;
  name: string;
}

/** 依規格建立 Realtime 邏輯（與 Ably 解耦，透過 IBroadcast 注入） */
export function useRealtimeGame(
  roomId: string,
  me: PlayerIdentity,
  opts: RealtimeOptions
): RealtimeGame {
  const game = useGameStore();
  const auction = useAuctionStore();

  const isHost = ref<boolean>(false);
  const hostId = ref<string | null>(null);
  const lastError = ref<string | null>(null);

  const dedup = new DedupBuffer(500);
  const unsubscribers: Array<() => void> = [];
  const presencePollMs = opts.presencePollMs ?? 2000;
  const storagePrefix = opts.storagePrefix ?? 'game';
  let presenceTimer: number | null = null;

  /** ---- 小工具 ---- */

  /** 只在 Host 廣播的完整快照（去除 Cow 秘密欄位） */
  function buildBroadcastState(): GameState {
    // 深拷貝：我們的型別都是可 JSON 化（Set 已改成 string[]）
    const raw = JSON.parse(JSON.stringify(game.$state)) as GameState;

    // Cow 秘密只存在 Host 記憶體，不應廣播/持久化
    if (raw.cow) {
      delete raw.cow.initiatorSecret;
      delete raw.cow.targetSecret;
    }
    return raw;
  }

  function persistHostSnapshot(state: GameState): void {
    try {
      localStorage.setItem(`${storagePrefix}:${roomId}`, JSON.stringify(state));
    } catch {
      // 忽略持久化失敗，不影響遊戲
    }
  }

  function applySnapshotFromNetwork(state: GameState): void {
    // 僅接受較新的快照
    if (typeof game.stateVersion === 'number' && state.stateVersion <= game.stateVersion) {
      return;
    }
    // 由 store 提供的原子函式（建議 Phase 2 實作），若尚未提供，退而求其次覆蓋 $state
    if (typeof (game as unknown as { applySnapshot: (s: GameState) => void }).applySnapshot === 'function') {
      (game as unknown as { applySnapshot: (s: GameState) => void }).applySnapshot(state);
    } else {
      // 型別保守處理：直接覆寫
      (game.$state as unknown as GameState) = state;
    }
  }

  async function electHost(): Promise<void> {
    const members = await opts.broadcast.presence().getMembers();
    const ids = members.map((m) => m.id);
    const newHostId = getHostId(members.map((m) => ({ id: m.id })));
    hostId.value = newHostId;
    isHost.value = newHostId === me.playerId;

    // 若我接任 Host，立即廣播最新快照（若已有）
    if (isHost.value) {
      const snapshot = buildBroadcastState();
      await opts.broadcast.publish<Envelope<StateUpdatePayload>>(Msg.State.Update, {
        type: Msg.State.Update,
        roomId,
        senderId: me.playerId,
        stateVersion: snapshot.stateVersion,
        ts: Date.now(),
        payload: { state: snapshot },
        schemaVersion: 1,
      });
      // 通知 hostChanged（資訊性）
      await opts.broadcast.publish<Envelope<SystemHostChangedPayload>>(Msg.System.HostChanged, {
        type: Msg.System.HostChanged,
        roomId,
        senderId: me.playerId,
        ts: Date.now(),
        payload: { newHostId },
        schemaVersion: 1,
      });
    }
  }

  /** Host 路徑：將 action 應用在 Stores，再廣播快照 */
  async function handleActionAsHost<T extends MsgType>(
    type: T,
    payload: PayloadOf<T>,
    actionId: string
  ): Promise<void> {
    // 去重
    if (!dedup.add(actionId)) return;

    try {
      switch (type) {
        case Msg.Action.ChooseAuction: {
          // 驗證當前 phase / 回合玩家等可在 store 內處理或在此先行檢查
          game.drawCardForAuction();
          auction.enterBidding();
          game.stateVersion += 1;
          break;
        }
        case Msg.Action.PlaceBid: {
          const p = payload as PlaceBidPayload;
          auction.placeBid(p.playerId, p.moneyCardIds, actionId);
          game.stateVersion += 1;
          break;
        }
        case Msg.Action.PassBid: {
          const p = payload as PassBidPayload;
          auction.passBid(p.playerId);
          game.stateVersion += 1;
          break;
        }
        case Msg.Action.HostAward: {
          // Host 結標（買回會在 Phase 3 加入）
          auction.hostAward();
          auction.settle('award');
          game.stateVersion += 1;
          break;
        }
        case Msg.System.RequestState: {
          // 直接回覆最新快照
          const snapshot = buildBroadcastState();
          await opts.broadcast.publish<Envelope<StateUpdatePayload>>(Msg.State.Update, {
            type: Msg.State.Update,
            roomId,
            senderId: me.playerId,
            stateVersion: snapshot.stateVersion,
            ts: Date.now(),
            payload: { state: snapshot },
            schemaVersion: 1,
          });
          return;
        }
        default:
          // 其他 action（如 Cow Trade）會在後續 Phase 實作
          break;
      }

      // 廣播快照（Host 專用）
      const broadcastState = buildBroadcastState();
      await opts.broadcast.publish<Envelope<StateUpdatePayload>>(Msg.State.Update, {
        type: Msg.State.Update,
        roomId,
        senderId: me.playerId,
        stateVersion: broadcastState.stateVersion,
        ts: Date.now(),
        payload: { state: broadcastState },
        schemaVersion: 1,
      });

      // Host 持久化
      persistHostSnapshot(broadcastState);
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : 'Unknown error in host reducer';
    }
  }

  /** ---- 訂閱處理 ---- */

  function subscribeAll(): void {
    const { subscribe } = opts.broadcast;

    // 1) 接收 action.* → 僅 Host 處理
    const actionTypes: Array<keyof PayloadMap> = [
      Msg.Action.ChooseAuction,
      Msg.Action.ChooseCowTrade, // 預留，暫不處理
      Msg.Action.PlaceBid,
      Msg.Action.PassBid,
      Msg.Action.HostAward,
      Msg.System.RequestState, // 當作「動作請求」
    ];

    actionTypes.forEach((t) => {
      const off = subscribe<Envelope<PayloadMap[typeof t]>>(t, async (env) => {
        if (!isHost.value) return; // 非 Host 不處理
        // 僅接受本房間
        if (env.roomId !== roomId) return;
        // action 需帶 actionId（RequestState 除外）
        const mustHaveActionId =
          t === Msg.Action.ChooseAuction ||
          t === Msg.Action.ChooseCowTrade ||
          t === Msg.Action.PlaceBid ||
          t === Msg.Action.PassBid ||
          t === Msg.Action.HostAward;

        if (mustHaveActionId && !env.actionId) return;

        const actionId = env.actionId ?? nanoid();
        await handleActionAsHost(t, env.payload, actionId);
      });
      unsubscribers.push(off);
    });

    // 2) 接收 state.update → 所有人套用（含 Host 自己）
    const offUpdate = subscribe<Envelope<StateUpdatePayload>>(Msg.State.Update, (env) => {
      if (env.roomId !== roomId) return;
      applySnapshotFromNetwork(env.payload.state);
    });
    unsubscribers.push(offUpdate);

    // 3) 接收 system.hostChanged → 更新 hostId 顯示（資訊性）
    const offHostChanged = subscribe<Envelope<SystemHostChangedPayload>>(
      Msg.System.HostChanged,
      (env) => {
        if (env.roomId !== roomId) return;
        hostId.value = env.payload.newHostId;
        isHost.value = env.payload.newHostId === me.playerId;
      }
    );
    unsubscribers.push(offHostChanged);
  }

  /** presence 輪詢以偵測 Host 遷移 */
  function startPresencePolling(): void {
    stopPresencePolling();
    // 以 window.setInterval 型別，避免 Node 與瀏覽器差異
    presenceTimer = window.setInterval(async () => {
      try {
        await electHost();
      } catch (err) {
        lastError.value = err instanceof Error ? err.message : 'Presence polling error';
      }
    }, presencePollMs);
  }

  function stopPresencePolling(): void {
    if (presenceTimer !== null) {
      window.clearInterval(presenceTimer);
      presenceTimer = null;
    }
  }

  /** ---- 對外 API ---- */

  async function connect(): Promise<void> {
    try {
      // 進入房間 presence
      await opts.broadcast.presence().enter({ playerId: me.playerId, name: me.name });

      // 初次選舉（含設定 isHost / hostId，並在接任時廣播快照）
      await electHost();

      // 建立所有訂閱
      subscribeAll();

      // 啟動 presence 輪詢（用於 Host 遷移）
      startPresencePolling();

      // 非 Host 要求一次快照（可容忍 Host 稍後才回）
      if (!isHost.value) {
        const env: Envelope<SystemRequestStatePayload> = {
          type: Msg.System.RequestState,
          roomId,
          senderId: me.playerId,
          ts: Date.now(),
          payload: { requesterId: me.playerId },
          schemaVersion: 1,
        };
        await opts.broadcast.publish<Envelope<SystemRequestStatePayload>>(
          Msg.System.RequestState,
          env
        );
      }
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : 'Connect failed';
      throw err;
    }
  }

  async function disconnect(): Promise<void> {
    try {
      stopPresencePolling();
      unsubscribers.splice(0).forEach((off) => {
        try {
          off();
        } catch {
          /* ignore */
        }
      });
      await opts.broadcast.presence().leave();
      dedup.clear();
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : 'Disconnect failed';
    }
  }

  /** 統一入口：UI 呼叫此函式發動動作 */
  async function dispatch<T extends MsgType>(type: T, payload: PayloadOf<T>): Promise<void> {
    // Host：直接本地處理（不發 action），僅廣播快照
    if (isHost.value) {
      const localActionId =
        type === Msg.System.RequestState ? nanoid() /* 不用 */ : nanoid();
      await handleActionAsHost(type, payload, localActionId);
      return;
    }

    // 非 Host：送 action 封包，由 Host 處理
    const actionId = nanoid();
    const env: Envelope<PayloadOf<T>> = {
      type,
      roomId,
      senderId: me.playerId,
      actionId,
      ts: Date.now(),
      payload,
      schemaVersion: 1,
    };
    await opts.broadcast.publish<Envelope<PayloadOf<T>>>(type, env);
  }

  onBeforeUnmount(() => {
    void disconnect();
  });

  return {
    connect,
    disconnect,
    dispatch,
    isHost,
    hostId,
    lastError,
  };
}
