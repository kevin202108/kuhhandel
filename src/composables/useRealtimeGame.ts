// src/composables/useRealtimeGame.ts
import { ref, type Ref, onMounted, onBeforeUnmount } from 'vue';
import {
  Msg,
  type MsgType,
  type Envelope,
  type PayloadByType,
  envelope as makeEnvelope
} from '@/networking/protocol';
import type { GameState } from '@/types/game';
import type { IBroadcast, PresenceMember } from '@/services/broadcast';
import { getHostId } from '@/services/host-election';
import { createDedupBuffer } from '@/services/dedup-buffer';
import { newId } from '@/utils/id';
import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
// Phase 4 再接 Cow Trade reducers：
// import { useCowStore } from '@/store/cow';

export interface RealtimeIdentity {
  playerId: string;
  name: string;
}

export interface UseRealtimeGame {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  dispatch: <T extends MsgType>(type: T, payload: PayloadByType[T]) => Promise<void>;
  isHost: Ref<boolean>;
}

const STATE_PERSIST_PREFIX = 'game:';

// ---- 型別守門：驗證 Envelope 形狀（零 any） ----
function isEnvelopeOfType<T extends MsgType>(input: unknown, expected: T): input is Envelope<T> {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  return (
    typeof obj.type === 'string' &&
    (obj.type as string) === expected &&
    typeof obj.roomId === 'string' &&
    typeof obj.senderId === 'string' &&
    typeof obj.ts === 'number' &&
    typeof obj.schemaVersion === 'number' &&
    Object.prototype.hasOwnProperty.call(obj, 'payload')
  );
}

// presence → 取 playerId（adapter 需保證 member.id === playerId）
function memberIds(members: PresenceMember[]): string[] {
  return members.map((m) => m.id);
}

export function useRealtimeGame(
  roomId: string,
  me: RealtimeIdentity,
  busFactory: (roomId: string) => IBroadcast
): UseRealtimeGame {
  const isHost = ref(false);
  const unsubscribers: Array<() => void> = [];
  const dedup = createDedupBuffer(500);

  const game = useGameStore();
  const auction = useAuctionStore();
  // const cow = useCowStore(); // Phase 4 再接

  let bus: IBroadcast | null = null;
  let destroyed = false;
  let hostPollTimer: number | null = null;

  // —— 工具：persist（Host 端） ——
  function persistHostSnapshot(state: GameState): void {
    try {
      localStorage.setItem(`${STATE_PERSIST_PREFIX}${roomId}`, JSON.stringify(state));
    } catch {
      // 忽略持久化失敗
    }
  }

  // —— Host：廣播完整快照 ——
  async function broadcastStateUpdate(): Promise<void> {
    const snapshot: GameState = game.serializeForPersist();
    // Log
    // eslint-disable-next-line no-console
    console.log('[NET] broadcast state.update', { stateVersion: snapshot.stateVersion });
    const env = makeEnvelope(
      Msg.State.Update,
      roomId,
      me.playerId,
      { state: snapshot },
      { stateVersion: snapshot.stateVersion }
    );
    await bus!.publish<Envelope<typeof Msg.State.Update>>(Msg.State.Update, env);
    persistHostSnapshot(snapshot);
  }

  // —— Host：處理 action（去重、驗證、reducer、bump、廣播） ——
  async function handleActionAsHost<T extends keyof PayloadByType>(
    type: T,
    env: Envelope<T>
  ): Promise<void> {
    // 去重：所有 action.* 必帶 actionId
    if (!env.actionId) {
      // eslint-disable-next-line no-console
      console.log('[NET] drop action (missing actionId)', { type, from: env.senderId });
      return;
    }
    const isNew = dedup.add(env.actionId);
    if (!isNew) {
      // eslint-disable-next-line no-console
      console.log('[NET] drop duplicate action', { type, actionId: env.actionId });
      return;
    }

    // 僅處理本房間
    if (env.roomId !== roomId) {
      // eslint-disable-next-line no-console
      console.log('[NET] drop action (wrong room)', { type, envRoom: env.roomId, roomId });
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[NET] host handle action', { type, from: env.senderId, actionId: env.actionId });

    // reducers：依 SSoT 事件對應表
    switch (type) {
      case Msg.Action.ChooseAuction: {
        game.drawCardForAuction();
        auction.enterBidding();
        break;
      }
      case Msg.Action.PlaceBid: {
        const p = env.payload as PayloadByType[typeof Msg.Action.PlaceBid];
        // **** 修正：placeBid 需要 ts（Host 接收時間）****
        const hostTs = Date.now();
        auction.placeBid(p.playerId, p.moneyCardIds, env.actionId, hostTs);
        break;
      }
      case Msg.Action.PassBid: {
        const p = env.payload as PayloadByType[typeof Msg.Action.PassBid];
        auction.passBid(p.playerId);
        break;
      }
      case Msg.Action.HostAward: {
        auction.settle('award');
        break;
      }
      // Phase 3：HostBuyback 會接上
      // Phase 4：Cow Trade 會接上
      default:
        // 當前 Phase 未支援的 action 忽略
        break;
    }

    // 版本遞增與廣播快照
    game.bumpVersion();
    // eslint-disable-next-line no-console
    console.log('[NET] state bumped', { nextStateVersion: game.stateVersion });
    await broadcastStateUpdate();
  }

  // —— Host：回應請求快照 ——
  async function handleRequestState<T extends keyof PayloadByType>(
    _type: T,
    env: Envelope<T>
  ): Promise<void> {
    if (!isHost.value || env.roomId !== roomId) return;
    // eslint-disable-next-line no-console
    console.log('[NET] recv requestState', { from: env.senderId });
    await broadcastStateUpdate();
  }

  // —— Client/Host：套用 state.update ——（丟棄舊版本）
  function applyStateUpdate<T extends keyof PayloadByType>(env: Envelope<T>): void {
    const payload = env.payload as PayloadByType[typeof Msg.State.Update];
    const incoming = (payload as { state: GameState }).state;
    // eslint-disable-next-line no-console
    console.log('[NET] recv state.update', {
      incoming: incoming.stateVersion,
      local: game.stateVersion
    });
    if (incoming.stateVersion <= game.stateVersion) {
      // eslint-disable-next-line no-console
      console.log('[NET] drop stale state.update', { reason: 'older-or-equal' });
      return;
    }
    game.applySnapshot(incoming);
  }

  async function recomputeHostAndMaybeAssume(): Promise<void> {
    if (!bus) return;
    const members = await bus.presence().getMembers();
    const ids = memberIds(members);
    const newHostId = getHostId(ids.map((id) => ({ id })));
    const nowHost = newHostId === me.playerId;

    const wasHost = isHost.value;
    isHost.value = nowHost;

    // eslint-disable-next-line no-console
    console.log('[NET] host check', { wasHost, nowHost, newHostId, members: ids });

    // 若剛成為 Host，立即廣播 hostChanged 與最新快照
    if (!wasHost && nowHost) {
      // eslint-disable-next-line no-console
      console.log('[NET] assume host', { me: me.playerId });
      const hostChanged = makeEnvelope(
        Msg.System.HostChanged,
        roomId,
        me.playerId,
        { newHostId: me.playerId }
      );
      await bus.publish<Envelope<typeof Msg.System.HostChanged>>(
        Msg.System.HostChanged,
        hostChanged
      );
      await broadcastStateUpdate();
    }
  }

  // —— 連線與訂閱 —— //
  async function connect(): Promise<void> {
    if (destroyed) return;
    if (bus) return;

    // eslint-disable-next-line no-console
    console.log('[NET] connect start', { roomId, me });

    bus = busFactory(roomId);

    // presence 進房
    await bus.presence().enter({ playerId: me.playerId, name: me.name });
    const afterEnter = await bus.presence().getMembers();
    // eslint-disable-next-line no-console
    console.log('[NET] presence after enter', { members: afterEnter.map((m) => m.id) });

    // 計算是否為 Host
    await recomputeHostAndMaybeAssume();

    // 訂閱所有 action.*（逐一註冊）
    const actionTopics = Object.values(Msg.Action);
    for (const t of actionTopics) {
      const off = bus.subscribe<unknown>(t, async (payload: unknown) => {
        if (!isEnvelopeOfType(payload, t)) return;
        const env = payload as Envelope<typeof t>;
        // eslint-disable-next-line no-console
        console.log('[NET] recv action', {
          type: env.type,
          from: env.senderId,
          actionId: env.actionId
        });
        // 僅 Host 執行 reducers；非 Host 忽略
        if (isHost.value) {
          await handleActionAsHost(t, env);
        }
        void recomputeHostAndMaybeAssume();
      });
      unsubscribers.push(off);
    }

    // 訂閱 state.update
    {
      const off = bus.subscribe<unknown>(Msg.State.Update, (payload: unknown) => {
        if (!isEnvelopeOfType(payload, Msg.State.Update)) return;
        applyStateUpdate(payload as Envelope<typeof Msg.State.Update>);
        void recomputeHostAndMaybeAssume();
      });
      unsubscribers.push(off);
    }

    // 訂閱 system.requestState（Host 需回傳最新快照）
    {
      const off = bus.subscribe<unknown>(Msg.System.RequestState, async (payload: unknown) => {
        if (!isEnvelopeOfType(payload, Msg.System.RequestState)) return;
        if (isHost.value) {
          await handleRequestState(
            Msg.System.RequestState,
            payload as Envelope<typeof Msg.System.RequestState>
          );
        }
        void recomputeHostAndMaybeAssume();
      });
      unsubscribers.push(off);
    }

    // 訂閱 system.hostChanged（更新 Host 狀態）
    {
      const off = bus.subscribe<unknown>(Msg.System.HostChanged, async (payload: unknown) => {
        if (!isEnvelopeOfType(payload, Msg.System.HostChanged)) return;
        const env = payload as Envelope<typeof Msg.System.HostChanged>;
        // eslint-disable-next-line no-console
        console.log('[NET] recv hostChanged', { newHostId: env.payload.newHostId });
        await recomputeHostAndMaybeAssume();
      });
      unsubscribers.push(off);
    }

    // 加上保底輪詢（每秒）避免漏掉 presence 事件
    if (hostPollTimer === null) {
      hostPollTimer = window.setInterval(() => {
        void recomputeHostAndMaybeAssume();
      }, 1000) as unknown as number;
      unsubscribers.push(() => {
        if (hostPollTimer !== null) {
          window.clearInterval(hostPollTimer);
          hostPollTimer = null;
        }
      });
    }

    // 非 Host 主動請求一次快照
    if (!isHost.value) {
      const req = makeEnvelope(
        Msg.System.RequestState,
        roomId,
        me.playerId,
        { requesterId: me.playerId }
      );
      // eslint-disable-next-line no-console
      console.log('[NET] send requestState', { to: 'host?' });
      await bus.publish<Envelope<typeof Msg.System.RequestState>>(Msg.System.RequestState, req);
    }

    // eslint-disable-next-line no-console
    console.log('[NET] connect done', { isHost: isHost.value });
  }

  async function disconnect(): Promise<void> {
    if (!bus) return;
    // eslint-disable-next-line no-console
    console.log('[NET] disconnect');
    try {
      for (const off of unsubscribers.splice(0, unsubscribers.length)) {
        try {
          off();
        } catch {
          // ignore
        }
      }
      if (hostPollTimer !== null) {
        window.clearInterval(hostPollTimer);
        hostPollTimer = null;
      }
      await bus.presence().leave();
    } finally {
      bus = null;
      isHost.value = false;
    }
  }

  // —— 對外 dispatch：UI 一律呼叫這個 —— //
  async function dispatch<T extends MsgType>(type: T, payload: PayloadByType[T]): Promise<void> {
    if (!bus) throw new Error('Realtime bus is not connected');

    const isAction = (Object.values(Msg.Action) as readonly string[]).includes(type as string);

    if (!isAction) {
      // 非 action.* 外部不允許送；system/state 由內部處理
      // eslint-disable-next-line no-console
      console.log('[NET] ignore non-action dispatch', { type });
      return;
    }

    const env = makeEnvelope(type, roomId, me.playerId, payload, { actionId: newId() });

    if (isHost.value) {
      // Host：直接執行 reducers → 廣播快照
      // eslint-disable-next-line no-console
      console.log('[NET] local action (host)', { type, actionId: env.actionId });
      await handleActionAsHost(type, env);
    } else {
      // Guest：送給 Host
      // eslint-disable-next-line no-console
      console.log('[NET] publish action (guest)', { type, actionId: env.actionId });
      await bus.publish<Envelope<T>>(type, env);
    }
  }

  // 自動掛載／卸載（可改由外部控制）
  onMounted(() => {
    // 可由外部手動呼叫 connect；此處不強制自動連線
  });
  onBeforeUnmount(() => {
    destroyed = true;
    void disconnect();
  });

  return { connect, disconnect, dispatch, isHost };
}
