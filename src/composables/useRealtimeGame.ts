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

export interface RealtimeIdentity { playerId: string; name: string; }
export interface UseRealtimeGame {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  dispatch: <T extends MsgType>(type: T, payload: PayloadByType[T]) => Promise<void>;
  isHost: Ref<boolean>;
}

const STATE_PERSIST_PREFIX = 'game:';

function isEnvelopeOfType<T extends MsgType>(input: unknown, expected: T): input is Envelope<T> {
  if (typeof input !== 'object' || input === null) return false;
  const o = input as Record<string, unknown>;
  return typeof o.type === 'string' && (o.type as string) === expected &&
         typeof o.roomId === 'string' && typeof o.senderId === 'string' &&
         typeof o.ts === 'number' && typeof o.schemaVersion === 'number' &&
         Object.prototype.hasOwnProperty.call(o, 'payload');
}

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

  let bus: IBroadcast | null = null;
  let destroyed = false;
  let hasEnteredPresence = false;
  let duplicateMitigated = false; // 自救只做一次

  // —— 工具：persist（Host） ——
  function persistHostSnapshot(state: GameState): void {
    try {
      localStorage.setItem(`${STATE_PERSIST_PREFIX}${roomId}`, JSON.stringify(state));
    } catch { /* ignore */ }
  }

  // —— Host：廣播完整快照 ——
  async function broadcastStateUpdate(): Promise<void> {
    const snapshot: GameState = game.serializeForPersist();
    const env = makeEnvelope(Msg.State.Update, roomId, me.playerId, { state: snapshot }, { stateVersion: snapshot.stateVersion });
    // eslint-disable-next-line no-console
    console.log('[NET] broadcast state.update', { sv: snapshot.stateVersion });
    await bus!.publish<Envelope<typeof Msg.State.Update>>(Msg.State.Update, env);
    persistHostSnapshot(snapshot);
  }

  // —— 自救：若 presence 有兩個以上同 me.playerId，直接換 pid 並重載 —— //
  function autoSelfHealOnDuplicate(ids: string[]): void {
    if (duplicateMitigated) return;
    const countMe = ids.filter((x) => x === me.playerId).length;
    if (countMe > 1) {
      duplicateMitigated = true;
      // eslint-disable-next-line no-console
      console.warn('[NET] self-heal: duplicate playerId; regenerating pid and reloading', { old: me.playerId, ids });
      const url = new URL(window.location.href);
      url.searchParams.set('pid', newId());
      // 使用 replace 避免歷史紀錄堆疊
      window.location.replace(url.toString());
    }
  }

  // —— Host：處理 action —— //
  async function handleActionAsHost<T extends keyof PayloadByType>(type: T, env: Envelope<T>): Promise<void> {
    if (!env.actionId) return;
    const isNew = dedup.add(env.actionId);
    if (!isNew) return;
    if (env.roomId !== roomId) return;

    switch (type) {
      case Msg.Action.ChooseAuction: {
        game.drawCardForAuction();
        auction.enterBidding();
        break;
      }
      case Msg.Action.PlaceBid: {
        const p = env.payload as PayloadByType[typeof Msg.Action.PlaceBid];
        // **修正：補上 env.ts，避免「Expected 4 arguments, but got 3」**
        auction.placeBid(p.playerId, p.moneyCardIds, env.actionId, env.ts);
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
      default: break;
    }

    game.bumpVersion();
    await broadcastStateUpdate();
  }

  // —— Host：回應請求快照 —— //
  async function handleRequestState<T extends keyof PayloadByType>(_type: T, env: Envelope<T>): Promise<void> {
    if (!isHost.value || env.roomId !== roomId) return;
    await broadcastStateUpdate();
  }

  // —— 套用 state.update（丟舊留新） —— //
  function applyStateUpdate<T extends keyof PayloadByType>(env: Envelope<T>): void {
    const p = env.payload as PayloadByType[typeof Msg.State.Update];
    const incoming = (p as { state: GameState }).state;
    // eslint-disable-next-line no-console
    console.log('[NET] recv state.update', { incoming: incoming.stateVersion, local: game.stateVersion });
    if (incoming.stateVersion <= game.stateVersion) {
      // eslint-disable-next-line no-console
      console.log('[NET] drop stale state.update', { reason: 'older-or-equal' });
      return;
    }
    game.applySnapshot(incoming);
  }

  // —— Host 選舉 —— //
  function hasDuplicateIds(ids: string[]): boolean {
    return new Set(ids).size !== ids.length;
  }

  async function recomputeHostAndMaybeAssume(): Promise<void> {
    if (!bus) return;
    const members = await bus.presence().getMembers();
    const ids = memberIds(members);

    if (hasDuplicateIds(ids)) {
      // eslint-disable-next-line no-console
      console.warn(' [NET] duplicate playerId detected; two tabs may share the same id.', { ids });
      autoSelfHealOnDuplicate(ids);
    }

    const newHostId = getHostId(ids.map((id) => ({ id })));
    const nowHost = newHostId === me.playerId;

    const wasHost = isHost.value;
    isHost.value = nowHost;

    // eslint-disable-next-line no-console
    console.log('[NET] host check', { wasHost, nowHost, newHostId, members: ids });

    if (!wasHost && nowHost) {
      // eslint-disable-next-line no-console
      console.log('[NET] assume host', { me: me.playerId });
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
    // eslint-disable-next-line no-console
    console.log('[NET] connect start', { roomId, me });

    // presence 進房（防重入）
    if (!hasEnteredPresence) {
      await bus.presence().enter({ playerId: me.playerId, name: me.name });
      hasEnteredPresence = true;
      const afterEnter = await bus.presence().getMembers();
      // eslint-disable-next-line no-console
      console.log('[NET] presence after enter', { members: afterEnter.map((m) => m.id) });
    } else {
      // eslint-disable-next-line no-console
      console.log('[NET] skip duplicate presence.enter');
    }

    await recomputeHostAndMaybeAssume();

    // 訂閱 action.*
    const actionTopics = Object.values(Msg.Action);
    for (const t of actionTopics) {
      const off = bus.subscribe<unknown>(t, async (payload: unknown) => {
        if (!isEnvelopeOfType(payload, t)) return;
        const env = payload as Envelope<typeof t>;
        if (isHost.value) await handleActionAsHost(t, env);
        void recomputeHostAndMaybeAssume();
      });
      unsubscribers.push(off);
    }

    // 訂閱 state.update
    unsubscribers.push(
      bus.subscribe<unknown>(Msg.State.Update, (payload: unknown) => {
        if (!isEnvelopeOfType(payload, Msg.State.Update)) return;
        applyStateUpdate(payload as Envelope<typeof Msg.State.Update>);
        void recomputeHostAndMaybeAssume();
      })
    );

    // 訂閱 system.requestState
    unsubscribers.push(
      bus.subscribe<unknown>(Msg.System.RequestState, async (payload: unknown) => {
        if (!isEnvelopeOfType(payload, Msg.System.RequestState)) return;
        if (isHost.value) await handleRequestState(Msg.System.RequestState, payload as Envelope<typeof Msg.System.RequestState>);
        void recomputeHostAndMaybeAssume();
      })
    );

    // 訂閱 system.hostChanged
    unsubscribers.push(
      bus.subscribe<unknown>(Msg.System.HostChanged, async () => {
        // eslint-disable-next-line no-console
        console.log('[NET] recv hostChanged', { newHostId: 'unknown (see next host check)' });
        await recomputeHostAndMaybeAssume();
      })
    );

    // 非 Host 主動請快照
    if (!isHost.value) {
      const req = makeEnvelope(Msg.System.RequestState, roomId, me.playerId, { requesterId: me.playerId });
      await bus.publish<Envelope<typeof Msg.System.RequestState>>(Msg.System.RequestState, req);
    }

    // eslint-disable-next-line no-console
    console.log('[NET] connect done', { roomId, me });
  }

  async function disconnect(): Promise<void> {
    if (!bus) return;
    try {
      for (const off of unsubscribers.splice(0, unsubscribers.length)) {
        try { off(); } catch { /* ignore */ }
      }
      await bus.presence().leave();
    } finally {
      bus = null;
      isHost.value = false;
      hasEnteredPresence = false;
    }
  }

  async function dispatch<T extends MsgType>(type: T, payload: PayloadByType[T]): Promise<void> {
    if (!bus) throw new Error('Realtime bus is not connected');
    const isAction = (Object.values(Msg.Action) as string[]).includes(type as unknown as string);
    if (!isAction) return;

    const env = makeEnvelope(type, roomId, me.playerId, payload, { actionId: newId() });
    if (isHost.value) {
      await handleActionAsHost(type, env);
    } else {
      await bus.publish<Envelope<T>>(type, env);
    }
  }

  onMounted(() => { /* 手動 connect 即可；不自動 */ });
  onBeforeUnmount(() => { destroyed = true; void disconnect(); });

  return { connect, disconnect, dispatch, isHost };
}
