// src/networking/host-dispatcher.ts
import type { IBroadcast } from '@/services/broadcast';
import type { Animal, GameState, Player } from '@/types/game';
import {
  Msg,
  type MsgType,
  type PayloadByType,
  type Envelope
} from '@/networking/protocol';

export interface HostMutators {
  game: {
    setupGameFromCurrentPlayers: () => void;
    startTurn: () => void;
    appendLog: (msg: string) => void;
  };
  auction: {
    enterBidding: () => void;
    placeBid: (playerId: string, moneyCardIds: string[], actionId: string) => void; // ★ 三參數
    passBid: (playerId: string) => void;
    hostAward: () => void;
    hostBuyback: () => void;
    settle: (mode: 'award' | 'buyback') => void;
  };
  cow: {
    selectTarget: (targetPlayerId: string) => void;
    selectAnimal: (animal: Animal) => void;
    commitSecret: (playerId: string, moneyCardIds: string[]) => void;
    revealAndResolve: () => void;
  };
  players: {
    addOnSetup: (playerId: string, name: string) => void;
    removeOnSetup: (playerId: string) => void;
  };
  bumpStateVersion: () => void;
}

/** LRU + TTL deduper（Map 插入順序淘汰最舊） */
class ActionDeduper {
  private readonly map = new Map<string, number>();
  constructor(private readonly cap: number, private readonly ttlMs: number) {}
  public seen(id: string, now: number): boolean {
    this.prune(now);
    const prev = this.map.get(id);
    if (prev !== undefined && now - prev <= this.ttlMs) return true;
    this.map.set(id, now);
    while (this.map.size > this.cap) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
    return false;
  }
  private prune(now: number): void {
    for (const [key, ts] of this.map) {
      if (now - ts > this.ttlMs) this.map.delete(key);
    }
  }
  public clear(): void {
    this.map.clear();
  }
}

/** 收 Envelope 的 Type Guard */
function isEnvelopeOfType<K extends MsgType>(
  value: unknown,
  expectedType: K
): value is Envelope<PayloadByType[K]> {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Partial<Envelope<unknown>>;
  return obj.type === expectedType && typeof obj.roomId === 'string';
}

/** 僅當前 client 為 Host 時才掛載；降級時請呼叫回傳的卸載函式。 */
export function mountHostDispatcher(
  broadcast: IBroadcast,
  roomId: string,
  getState: () => GameState,
  mutate: HostMutators
): () => void {
  const unsubscribers: Array<() => void> = [];
  const deduper = new ActionDeduper(500, 10 * 60 * 1000); // 500 entries / 10 minutes

  // ---------- Subscribe 工具：Envelope 版（action/system.reqState） ----------
  const subEnv = <T extends MsgType>(
    type: T,
    handler: (env: Envelope<PayloadByType[T]>) => void
  ): void => {
    const off = broadcast.subscribe(type, (raw: unknown) => {
      if (!isEnvelopeOfType(raw, type)) return;
      if (raw.roomId !== roomId) return;
      handler(raw);
    });
    unsubscribers.push(off);
  };

  // ---------- Subscribe 工具：Payload 版（system.join/leave） ----------
  const subPayload = <T extends MsgType>(
    type: T,
    handler: (payload: PayloadByType[T]) => void
  ): void => {
    const off = broadcast.subscribe(type, (payload: unknown) => {
      // 輕量檢查：payload 需為物件
      if (typeof payload !== 'object' || payload === null) return;
      handler(payload as PayloadByType[T]);
    });
    unsubscribers.push(off);
  };

  const getHostIdOrThrow = (): string => {
    const s = getState();
    if (s.hostId === undefined) throw new Error('[host-dispatcher] hostId is undefined.');
    return s.hostId;
  };

  const structuredCloneSafe = <T>(obj: T): T => {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj)) as T;
  };

  const sanitizeSnapshot = (state: GameState): GameState => {
    const snapshot = structuredCloneSafe(state);
    if (snapshot.cow) {
      delete snapshot.cow.initiatorSecret;
      delete snapshot.cow.targetSecret;
    }
    return snapshot;
  };

  const publishStateUpdate = async (why: string): Promise<void> => {
    const snapshot = sanitizeSnapshot(getState());
    // eslint-disable-next-line no-console
    console.debug('[host-dispatcher] broadcast state.update (%s) v%d', why, snapshot.stateVersion);
    const payload: PayloadByType[typeof Msg.State.Update] = { state: snapshot }; // ★ payload-only
    await broadcast.publish(Msg.State.Update, payload);
  };

  const actionIdOf = (env: Envelope<unknown>): string | null => env.actionId ?? null;

  const isTurnOwner = (playerId: string): boolean => getState().turnOwnerId === playerId;

  const findPlayer = (playerId: string): Player | undefined =>
    getState().players.find((p) => p.id === playerId);

  const phaseIs = (phase: GameState['phase']): boolean => getState().phase === phase;

  // -------------------- Action handlers（Envelope） --------------------

  const handleStartGame = (env: Envelope<PayloadByType[typeof Msg.Action.StartGame]>): void => {
    const hostId = getHostIdOrThrow();
    if (env.senderId !== hostId) return;
    if (!phaseIs('setup')) return;

    mutate.game.setupGameFromCurrentPlayers();
    mutate.game.startTurn();
    mutate.game.appendLog(`Game started by ${env.senderId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('startGame');
  };

  const handleChooseAuction = (
    env: Envelope<PayloadByType[typeof Msg.Action.ChooseAuction]>
  ): void => {
    if (!phaseIs('turn.choice')) return;
    if (!isTurnOwner(env.payload.playerId)) return;

    mutate.auction.enterBidding();
    mutate.game.appendLog(`ChooseAuction by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('chooseAuction');
  };

  const handleChooseCowTrade = (
    env: Envelope<PayloadByType[typeof Msg.Action.ChooseCowTrade]>
  ): void => {
    if (!phaseIs('turn.choice')) return;
    if (!isTurnOwner(env.payload.playerId)) return;

    // Phase 2：不中斷流程；下一步由 SelectCowTarget 進入
    mutate.game.appendLog(`ChooseCowTrade by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('chooseCowTrade');
  };

  const handlePlaceBid = (env: Envelope<PayloadByType[typeof Msg.Action.PlaceBid]>): void => {
    if (!phaseIs('auction.bidding')) return;
    const aid = actionIdOf(env);
    if (aid === null) return;
    if (deduper.seen(aid, Date.now())) return;

    mutate.auction.placeBid(env.payload.playerId, env.payload.moneyCardIds, aid);
    mutate.game.appendLog(`Bid by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('placeBid');
  };

  const handlePassBid = (env: Envelope<PayloadByType[typeof Msg.Action.PassBid]>): void => {
    if (!phaseIs('auction.bidding')) return;
    const aid = actionIdOf(env);
    if (aid === null) return;
    if (deduper.seen(aid, Date.now())) return;

    mutate.auction.passBid(env.payload.playerId);
    mutate.game.appendLog(`Pass by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('passBid');
  };

  const handleHostAward = (env: Envelope<PayloadByType[typeof Msg.Action.HostAward]>): void => {
    if (!phaseIs('auction.closing')) return;
    const hostId = getHostIdOrThrow();
    if (env.senderId !== hostId) return;

    const aid = actionIdOf(env);
    if (aid === null) return;
    if (deduper.seen(aid, Date.now())) return;

    mutate.auction.hostAward();
    mutate.auction.settle('award');
    mutate.game.appendLog('Auction AWARD');
    mutate.bumpStateVersion();
    void publishStateUpdate('hostAward');
  };

  const handleHostBuyback = (
    env: Envelope<PayloadByType[typeof Msg.Action.HostBuyback]>
  ): void => {
    if (!phaseIs('auction.closing')) return;
    const hostId = getHostIdOrThrow();
    if (env.senderId !== hostId) return;

    const aid = actionIdOf(env);
    if (aid === null) return;
    if (deduper.seen(aid, Date.now())) return;

    mutate.auction.hostBuyback();
    mutate.auction.settle('buyback');
    mutate.game.appendLog('Auction BUYBACK');
    mutate.bumpStateVersion();
    void publishStateUpdate('hostBuyback');
  };

  const handleSelectCowTarget = (
    env: Envelope<PayloadByType[typeof Msg.Action.SelectCowTarget]>
  ): void => {
    if (!(phaseIs('cow.selectTarget') || phaseIs('turn.choice'))) return;
    if (!isTurnOwner(env.payload.playerId)) return;

    mutate.cow.selectTarget(env.payload.targetId);
    mutate.game.appendLog(`Cow target=${env.payload.targetId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('cowSelectTarget');
  };

  const handleSelectCowAnimal = (
    env: Envelope<PayloadByType[typeof Msg.Action.SelectCowAnimal]>
  ): void => {
    if (!phaseIs('cow.selectAnimal')) return;
    if (!isTurnOwner(env.payload.playerId)) return;

    mutate.cow.selectAnimal(env.payload.animal);
    mutate.game.appendLog(`Cow animal=${env.payload.animal}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('cowSelectAnimal');
  };

  const handleCommitCowTrade = (
    env: Envelope<PayloadByType[typeof Msg.Action.CommitCowTrade]>
  ): void => {
    if (!phaseIs('cow.commit')) return;
    const aid = actionIdOf(env);
    if (aid === null) return;
    if (deduper.seen(aid, Date.now())) return;

    mutate.cow.commitSecret(env.payload.playerId, env.payload.moneyCardIds);
    mutate.game.appendLog(`Cow commit by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('cowCommit');
  };

  // -------------------- System handlers --------------------

  // RequestState：為了辨識 requester 與防刷，保留 Envelope
  const handleRequestState = (
    env: Envelope<PayloadByType[typeof Msg.System.RequestState]>
  ): void => {
    // eslint-disable-next-line no-console
    console.debug('[host-dispatcher] requestState from %s', env.payload.requesterId);
    void publishStateUpdate('requestState'); // 不遞增版本
  };

  // setup 期間的 Join/Leave：你的 main.ts 以 payload-only 發送 → 這裡也以 payload 接
  const handleJoinOnSetup = (payload: PayloadByType[typeof Msg.System.Join]): void => {
    if (!phaseIs('setup')) return;
    const { playerId, name } = payload;
    const exists = findPlayer(playerId) !== undefined;
    if (!exists) {
      mutate.players.addOnSetup(playerId, name);
      mutate.game.appendLog(`Join: ${playerId} (${name})`);
      mutate.bumpStateVersion();
      void publishStateUpdate('join@setup');
    }
  };

  const handleLeaveOnSetup = (payload: PayloadByType[typeof Msg.System.Leave]): void => {
    if (!phaseIs('setup')) return;
    const { playerId } = payload;
    const exists = findPlayer(playerId) !== undefined;
    if (exists) {
      mutate.players.removeOnSetup(playerId);
      mutate.game.appendLog(`Leave: ${playerId}`);
      mutate.bumpStateVersion();
      void publishStateUpdate('leave@setup');
    }
  };

  // -------------------- 註冊所有訂閱 --------------------

  // action.*（Envelope）
  subEnv(Msg.Action.StartGame, handleStartGame);
  subEnv(Msg.Action.ChooseAuction, handleChooseAuction);
  subEnv(Msg.Action.ChooseCowTrade, handleChooseCowTrade);
  subEnv(Msg.Action.PlaceBid, handlePlaceBid);
  subEnv(Msg.Action.PassBid, handlePassBid);
  subEnv(Msg.Action.HostAward, handleHostAward);
  subEnv(Msg.Action.HostBuyback, handleHostBuyback);
  subEnv(Msg.Action.SelectCowTarget, handleSelectCowTarget);
  subEnv(Msg.Action.SelectCowAnimal, handleSelectCowAnimal);
  subEnv(Msg.Action.CommitCowTrade, handleCommitCowTrade);

  // system.*（混合：requestState 用 Envelope，其餘 payload-only）
  subEnv(Msg.System.RequestState, handleRequestState);
  subPayload(Msg.System.Join, handleJoinOnSetup);
  subPayload(Msg.System.Leave, handleLeaveOnSetup);

  // 卸載
  return () => {
    for (const off of unsubscribers) {
      try {
        off();
      } catch {
        // ignore
      }
    }
    deduper.clear();
    // eslint-disable-next-line no-console
    console.debug('[host-dispatcher] unmounted.');
  };
}
