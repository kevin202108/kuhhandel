// src/composables/useRealtimeGame.ts
import { ref, type Ref, onMounted, onBeforeUnmount } from 'vue';
import { Msg, type MsgType, type Envelope, type PayloadByType, envelope as makeEnvelope } from '@/networking/protocol';
import type { GameState } from '@/types/game';
import type { IBroadcast, PresenceMember } from '@/services/broadcast';
import { getHostId } from '@/services/host-election';
import { createDedupBuffer } from '@/services/dedup-buffer';
import { newId } from '@/utils/id';
import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
// Cow Trade 的 reducers 於 Phase 4 才會接線；此檔先預留 import：
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
const DEDUP_PERSIST_PREFIX = 'dedup:'; // 可選：若要抗 Host reload，可序列化保存

// 型別守門：簡易驗證外部送來的 payload 至少具備必要欄位
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

// 從 presence members 取出所有 playerId（以 member.id 為準；若底層不同，adapter 需確保一致）
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

  // —— 工具：persist / restore（Host 端使用） ——
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
    const env = makeEnvelope(Msg.State.Update, roomId, me.playerId, { state: snapshot }, { stateVersion: snapshot.stateVersion });
    await bus!.publish<Envelope<typeof Msg.State.Update>>(Msg.State.Update, env);
    persistHostSnapshot(snapshot);
  }

  // —— Host：處理 action（去重、驗證、reducer、bump、廣播） ——
  async function handleActionAsHost<T extends keyof PayloadByType>(
    type: T,
    env: Envelope<T>
  ): Promise<void> {
    // 去重：所有 action.* 必帶 actionId
    if (!env.actionId) return;
    const isNew = dedup.add(env.actionId);
    if (!isNew) return;

    // 僅處理本房間
    if (env.roomId !== roomId) return;

    // reducers：依 SSoT 事件對應表
    switch (type) {
      case Msg.Action.ChooseAuction: {
        // 抽牌進入拍賣
        game.drawCardForAuction();
        auction.enterBidding();
        break;
      }
      case Msg.Action.PlaceBid: {
        const p = env.payload as PayloadByType[typeof Msg.Action.PlaceBid];
        auction.placeBid(p.playerId, p.moneyCardIds, env.actionId);
        break;
      }
      case Msg.Action.PassBid: {
        const p = env.payload as PayloadByType[typeof Msg.Action.PassBid];
        auction.passBid(p.playerId);
        break;
      }
      case Msg.Action.HostAward: {
        // 直接進結算（award）
        auction.settle('award');
        break;
      }
      // Phase 3：HostBuyback 在下一階段完成
      // Phase 4：Cow Trade 相關在下一階段接上
      default:
        // 未支援的 action 於當前 Phase 忽略
        break;
    }

    // 版本遞增與廣播快照
    game.bumpVersion();
    await broadcastStateUpdate();
  }

  // —— Host：回應請求快照 ——
  async function handleRequestState<T extends keyof PayloadByType>(
    _type: T,
    env: Envelope<T>
  ): Promise<void> {
    // 僅 Host 回應，且同房間才回
    if (!isHost.value || env.roomId !== roomId) return;
    await broadcastStateUpdate();
  }

  // —— Client/Host：套用 state.update ——（丟棄舊版本）
  function applyStateUpdate<T extends keyof PayloadByType>(env: Envelope<T>): void {
    const p = env.payload as PayloadByType[typeof Msg.State.Update];
    const incoming = (p as { state: GameState }).state;
    if (incoming.stateVersion <= game.stateVersion) {
      return; // 舊包丟棄
    }
    game.applySnapshot(incoming);
  }

  async function recomputeHostAndMaybeAssume(): Promise<void> {
    if (!bus) return;
    const members = await bus.presence().getMembers();
    const ids = memberIds(members);
    const newHostId = getHostId(ids.map((id) => ({ id })));
    const nowHost = newHostId === me.playerId;

    const previouslyHost = isHost.value;
    isHost.value = nowHost;

    // 若剛成為 Host，立即廣播 hostChanged 與最新快照
    if (!previouslyHost && nowHost) {
      const hostChanged = makeEnvelope(Msg.System.HostChanged, roomId, me.playerId, { newHostId: me.playerId });
      await bus.publish<Envelope<typeof Msg.System.HostChanged>>(Msg.System.HostChanged, hostChanged);
      await broadcastStateUpdate();
    }
  }

  // —— 連線與訂閱 —— //
  async function connect(): Promise<void> {
    if (destroyed) return;
    if (bus) return;

    bus = busFactory(roomId);

    // presence 進房
    await bus.presence().enter({ playerId: me.playerId, name: me.name });

    // 計算是否為 Host
    await recomputeHostAndMaybeAssume();

    // 訂閱所有 action.*（逐一註冊）
    const actionTopics = Object.values(Msg.Action);
    for (const t of actionTopics) {
      const off = bus.subscribe<unknown>(t, async (payload: unknown) => {
        if (!isEnvelopeOfType(payload, t)) return;
        const env = payload as Envelope<typeof t>;
        // 僅 Host 執行 reducers；非 Host 忽略
        if (isHost.value) {
          await handleActionAsHost(t, env);
        }
        // 收到任何訊息時嘗試重新評估 Host（保險策略）
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
          await handleRequestState(Msg.System.RequestState, payload as Envelope<typeof Msg.System.RequestState>);
        }
        void recomputeHostAndMaybeAssume();
      });
      unsubscribers.push(off);
    }

    // 訂閱 system.hostChanged（更新 Host 狀態）
    {
      const off = bus.subscribe<unknown>(Msg.System.HostChanged, async () => {
        await recomputeHostAndMaybeAssume();
      });
      unsubscribers.push(off);
    }

    // 非 Host 主動請求一次快照
    if (!isHost.value) {
      const req = makeEnvelope(Msg.System.RequestState, roomId, me.playerId, { requesterId: me.playerId });
      await bus.publish<Envelope<typeof Msg.System.RequestState>>(Msg.System.RequestState, req);
    }
  }

  async function disconnect(): Promise<void> {
    if (!bus) return;
    try {
      for (const off of unsubscribers.splice(0, unsubscribers.length)) {
        try {
          off();
        } catch {
          // ignore
        }
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

    // 僅允許透過 dispatch 送 Action（System 訊息由內部送）
    const isAction =
      (Object.values(Msg.Action) as string[]).includes(type as unknown as string);

    if (!isAction) {
      // 允許內部使用，但若外部嘗試送非 action，直接忽略
      return;
    }

    if (isHost.value) {
      // Host 直接 reducer → 廣播快照
      const env = makeEnvelope(type, roomId, me.playerId, payload, { actionId: newId() });
      await handleActionAsHost(type, env);
    } else {
      // 非 Host 封包後送給 Host
      const env = makeEnvelope(type, roomId, me.playerId, payload, { actionId: newId() });
      await bus.publish<Envelope<T>>(type, env);
    }
  }

  // —— 自動掛載／卸載（供 App.vue 也能手動呼叫 connect/discount） —— //
  onMounted(() => {
    // 可由外部手動呼叫 connect；此處不強制自動連線
  });
  onBeforeUnmount(() => {
    destroyed = true;
    void disconnect();
  });

  return { connect, disconnect, dispatch, isHost };
}
