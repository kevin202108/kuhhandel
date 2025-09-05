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
    placeBid: (playerId: string, moneyCardIds: string[], actionId: string, ts: number) => void;
    passBid: (playerId: string) => void;
    hostAward: () => void;
    hostBuyback: () => void;
    settle: (mode: 'award' | 'buyback') => void;
  };
  cow: {
    // ★ 已移除 startCowTrade：依 README，流程從 chooseCowTrade → 選 target → 選 animal → commit → reveal
    selectTarget: (targetPlayerId: string) => void;
    selectAnimal: (animal: Animal) => void;
    commitSecret: (playerId: string, moneyCardIds: string[]) => void;
    revealAndResolve: () => void;
  };
  players: {
    addOnSetup: (playerId: string, name: string) => void;
    removeOnSetup: (playerId: string) => void;
  };
  /** Host 成功處理 action 後由 dispatcher 呼叫以遞增 stateVersion */
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

/** 型別守門：判斷 unknown 是否為特定 MsgType 的 Envelope */
function isEnvelopeOfType<K extends MsgType>(
  value: unknown,
  expectedType: K
): value is Envelope<PayloadByType[K]> {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Partial<Envelope<unknown>>;
  return typeof obj.type === 'string' && obj.type === expectedType;
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

  // --- 工具 ---

  /** 訂閱某訊息型別；用 unknown 收，內部以 type guard 窄化（這裡收的是 Envelope） */
  const sub = <T extends MsgType>(
    type: T,
    handler: (env: Envelope<PayloadByType[T]>) => void
  ): void => {
    const off = broadcast.subscribe(type, (raw: unknown) => {
      if (!isEnvelopeOfType(raw, type)) return;
      if (raw.roomId !== roomId) return; // 同房檢查
      handler(raw);
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
    // ★ 發 payload（非 Envelope），stateVersion 內含在 GameState
    const payload: PayloadByType[typeof Msg.State.Update] = { state: snapshot };
    await broadcast.publish(Msg.State.Update, payload);
  };

  const ensureActionId = (env: Envelope<unknown>): string | null => {
    return env.actionId ?? null;
  };

  const isTurnOwner = (playerId: string): boolean => getState().turnOwnerId === playerId;

  const findPlayer = (playerId: string): Player | undefined =>
    getState().players.find((p) => p.id === playerId);

  const phaseIs = (phase: GameState['phase']): boolean => getState().phase === phase;

  // --- Action handlers ---

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

    // ★ 依 README Phase 2：不新增 startCowTrade。
    //   這裡僅記 log + 發快照；進一步的 phase 轉移請由 store 在
    //   下一個 action（SelectCowTarget）時處理（允許從 turn.choice 進入）。
    mutate.game.appendLog(`ChooseCowTrade by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('chooseCowTrade');
  };

  const handlePlaceBid = (env: Envelope<PayloadByType[typeof Msg.Action.PlaceBid]>): void => {
    if (!phaseIs('auction.bidding')) return;
    const actionId = ensureActionId(env);
    if (actionId === null) return;
    if (deduper.seen(actionId, Date.now())) return; // ★ Host 時間決定先後

    mutate.auction.placeBid(env.payload.playerId, env.payload.moneyCardIds, actionId, Date.now());
    mutate.game.appendLog(`Bid by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('placeBid');
  };

  const handlePassBid = (env: Envelope<PayloadByType[typeof Msg.Action.PassBid]>): void => {
    if (!phaseIs('auction.bidding')) return;
    const actionId = ensureActionId(env);
    if (actionId === null) return;
    if (deduper.seen(actionId, Date.now())) return;

    mutate.auction.passBid(env.payload.playerId);
    mutate.game.appendLog(`Pass by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('passBid');
  };

  const handleHostAward = (env: Envelope<PayloadByType[typeof Msg.Action.HostAward]>): void => {
    if (!phaseIs('auction.closing')) return;
    const hostId = getHostIdOrThrow();
    if (env.senderId !== hostId) return;

    const actionId = ensureActionId(env);
    if (actionId === null) return;
    if (deduper.seen(actionId, Date.now())) return;

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

    const actionId = ensureActionId(env);
    if (actionId === null) return;
    if (deduper.seen(actionId, Date.now())) return;

    mutate.auction.hostBuyback();
    mutate.auction.settle('buyback');
    mutate.game.appendLog('Auction BUYBACK');
    mutate.bumpStateVersion();
    void publishStateUpdate('hostBuyback');
  };

  const handleSelectCowTarget = (
    env: Envelope<PayloadByType[typeof Msg.Action.SelectCowTarget]>
  ): void => {
    // ★ store 需允許從 turn.choice → selectTarget（Phase 2 不新增 start 動作）
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
    const actionId = ensureActionId(env);
    if (actionId === null) return;
    if (deduper.seen(actionId, Date.now())) return;

    mutate.cow.commitSecret(env.payload.playerId, env.payload.moneyCardIds);
    mutate.game.appendLog(`Cow commit by ${env.payload.playerId}`);
    mutate.bumpStateVersion();
    void publishStateUpdate('cowCommit');
  };

  // --- System handlers（Host 回應） ---

  const handleRequestState = (
    env: Envelope<PayloadByType[typeof Msg.System.RequestState]>
  ): void => {
    // eslint-disable-next-line no-console
    console.debug('[host-dispatcher] requestState from %s', env.payload.requesterId);
    void publishStateUpdate('requestState'); // 不遞增版本
  };

  const handleJoinOnSetup = (env: Envelope<PayloadByType[typeof Msg.System.Join]>): void => {
    if (!phaseIs('setup')) return;
    const { playerId, name } = env.payload;
    const exists = findPlayer(playerId) !== undefined;
    if (!exists) {
      mutate.players.addOnSetup(playerId, name);
      mutate.game.appendLog(`Join: ${playerId} (${name})`);
      mutate.bumpStateVersion();
      void publishStateUpdate('join@setup');
    }
  };

  const handleLeaveOnSetup = (env: Envelope<PayloadByType[typeof Msg.System.Leave]>): void => {
    if (!phaseIs('setup')) return;
    const { playerId } = env.payload;
    const exists = findPlayer(playerId) !== undefined;
    if (exists) {
      mutate.players.removeOnSetup(playerId);
      mutate.game.appendLog(`Leave: ${playerId}`);
      mutate.bumpStateVersion();
      void publishStateUpdate('leave@setup');
    }
  };

  // --- 註冊訂閱（Envelope-based for actions/system） ---

  sub(Msg.Action.StartGame, handleStartGame);
  sub(Msg.Action.ChooseAuction, handleChooseAuction);
  sub(Msg.Action.ChooseCowTrade, handleChooseCowTrade);
  sub(Msg.Action.PlaceBid, handlePlaceBid);
  sub(Msg.Action.PassBid, handlePassBid);
  sub(Msg.Action.HostAward, handleHostAward);
  sub(Msg.Action.HostBuyback, handleHostBuyback);
  sub(Msg.Action.SelectCowTarget, handleSelectCowTarget);
  sub(Msg.Action.SelectCowAnimal, handleSelectCowAnimal);
  sub(Msg.Action.CommitCowTrade, handleCommitCowTrade);

  sub(Msg.System.RequestState, handleRequestState);
  sub(Msg.System.Join, handleJoinOnSetup);
  sub(Msg.System.Leave, handleLeaveOnSetup);

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
