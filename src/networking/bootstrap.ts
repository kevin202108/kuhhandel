import {
  initAbly,
  getChannel,
  presence,
  closeAbly,
  publishRaw,
  subscribeRaw,
} from '@/networking/ablyClient';
import broadcast from '@/services/broadcast';
import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import { useCowStore } from '@/store/cow';
import { getHostId } from '@/services/host-election';
import { makeEnvelope, Msg, type MsgType } from '@/networking/protocol';

function readQuery(key: string): string | undefined {
  try {
    const url = new URL(globalThis.location?.href ?? '', 'http://local.invalid');
    return url.searchParams.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

const ID_RE = /^[a-z0-9_-]{1,24}$/;
function assertIdOrThrow(id: string, kind: 'roomId' | 'playerId') {
  if (!ID_RE.test(id)) {
    throw new Error(`[bootstrap] Invalid ${kind} "${id}". Must match ${ID_RE.source}`);
  }
}

function isDebug(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;
  return Boolean(g.__DEBUG__ === true || readQuery('debug') === '1');
}

export async function startNetworking(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const ROOM = (w.__ROOM__ as string | undefined) || 'dev';
  const PLAYER = (w.__PLAYER__ as string | undefined) || '';
  const DISPLAY_NAME = (w.__NAME__ as string | undefined) || PLAYER;
  const DEBUG = isDebug();

  if (!PLAYER) {
    if (DEBUG) console.debug('[bootstrap] Missing player id; skip networking');
    exposeDebugHelpers(false, ROOM, PLAYER);
    return;
  }

  assertIdOrThrow(ROOM, 'roomId');
  assertIdOrThrow(PLAYER, 'playerId');

  await initAbly(PLAYER);
  if (DEBUG) console.debug('[bootstrap] Ably initialized as clientId=', PLAYER);

  await getChannel(ROOM);
  if (DEBUG) console.debug('[bootstrap] Channel attached:', `game-v1-${ROOM}`);

  await presence.enter(ROOM, { playerId: PLAYER, name: DISPLAY_NAME });
  if (DEBUG) console.debug('[bootstrap] presence.enter ok');

  await broadcast.publish(Msg.System.Join, { playerId: PLAYER, name: DISPLAY_NAME });

  const game = useGameStore();
  const auction = useAuctionStore();
  const cow = useCowStore();

  // Initial election
  let members = await presence.getMembers(ROOM);
  const elected = getHostId(members);
  if (elected) game.setHostId(elected);

  // Re-elect on presence changes
  const offPresence = presence.subscribePresenceEvents(ROOM, async (action, member) => {
    if (action === 'enter' || action === 'leave') {
      members = await presence.getMembers(ROOM);
      const newHost = getHostId(members);
      if (newHost && newHost !== game.hostId) {
        const oldHost = game.hostId;
        game.setHostId(newHost);
        await broadcast.publish(Msg.System.HostChanged, { newHostId: newHost });
        if (DEBUG) console.debug('[host] Host changed from', oldHost, 'to:', newHost);
        handleHostChange(oldHost, newHost!);
      }
    }
  });

  function handleHostChange(oldHost: string | undefined, newHost: string) {
    if (game.phase !== 'setup' && oldHost && newHost !== oldHost) {
      game.appendLog(`Host changed from ${oldHost} to ${newHost}.`);
    }
  }

  const amHost = () => game.hostId === PLAYER;
  if (DEBUG) {
    console.debug('[presence] members');
    console.table(members);
    console.debug('[host] elected =', elected, 'amHost =', amHost());
  }

  // Keep hostId in sync when HostChanged is broadcast
  broadcast.subscribe(Msg.System.HostChanged, (env) => {
    const { newHostId } = env.payload as { newHostId: string };
    if (newHostId && newHostId !== game.hostId) {
      const oldHost = game.hostId;
      game.setHostId(newHostId);
      if (DEBUG) console.debug('[host] Received HostChanged from', oldHost, 'to:', newHostId);
      handleHostChange(oldHost, newHostId!);
    }
  });

  // Host routes action.* and answers state
  if (amHost()) {
    const seen = new Map<string, number>();
    function accept(type: string, senderId: string, actionId?: string, ts?: number): boolean {
      const id = actionId ?? 'noid';
      const key = `${senderId}|${type}|${id}`;
      if (seen.has(key)) return false;
      seen.set(key, ts ?? Date.now());
      if (seen.size > 600) {
        const entries = Array.from(seen.entries()).sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < entries.length - 500; i++) seen.delete(entries[i]![0]!);
      }
      return true;
    }

    const offStart = broadcast.subscribe(Msg.Action.StartGame, async (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      if (env.senderId !== game.hostId) return;
      const ms = await presence.getMembers(ROOM);
      const players = ms.map((m) => ({ id: m.id, name: (m.data as any)?.name || m.id }));
      game.setupGame(players);
      game.startTurn();
    });

    const offChoose = broadcast.subscribe(Msg.Action.ChooseAuction, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      const pid = (env.payload as any)?.playerId as string | undefined;
      if (game.phase !== 'turn.choice') return;
      if (!pid || pid !== game.turnOwnerId) return;
      if (env.senderId !== pid) return;
      auction.enterBidding();
    });

    const offPlace = broadcast.subscribe(Msg.Action.PlaceBid, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      if (game.phase !== 'auction.bidding' || !game.auction) return;
      const { playerId, moneyCardIds } = env.payload as any;
      if (!playerId || env.senderId !== playerId) return;
      if (playerId === game.auction?.auctioneerId) return;
      auction.placeBid(playerId, moneyCardIds, env.actionId || `${env.senderId}-${Date.now()}`);
    });
    const offPass = broadcast.subscribe(Msg.Action.PassBid, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      if (game.phase !== 'auction.bidding' || !game.auction) return;
      const { playerId } = env.payload as any;
      if (!playerId || env.senderId !== playerId) return;
      if (playerId === game.auction?.auctioneerId) return;
      auction.passBid(playerId);
    });

    const offAward = broadcast.subscribe(Msg.Action.HostAward, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      if (game.phase !== 'auction.closing' || !game.auction) return;
      const auctioneer = game.auction?.auctioneerId;
      if (env.senderId !== auctioneer) return;
      auction.hostAward();
    });

    const offBuyback = broadcast.subscribe(Msg.Action.HostBuyback, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      if (game.phase !== 'auction.closing' || !game.auction) return;
      const auctioneer = game.auction?.auctioneerId;
      if (env.senderId !== auctioneer) return;
      auction.hostBuyback();
    });

    const offConfirmBuyback = broadcast.subscribe(Msg.Action.ConfirmBuyback, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      if (game.phase !== 'auction.buyback' || !game.auction) return;
      const auctioneer = game.auction?.auctioneerId;
      if (env.senderId !== auctioneer) return;
      const { moneyCardIds } = env.payload as { moneyCardIds: string[] };
      auction.confirmBuyback(moneyCardIds);
    });

    const offCancelBuyback = broadcast.subscribe(Msg.Action.CancelBuyback, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      if (game.phase === 'auction.buyback') {
        const auctioneer = game.auction?.auctioneerId;
        if (env.senderId !== auctioneer) return;
        game.phase = 'auction.closing';
        game.appendLog('Auctioneer cancelled buyback.');
        auction.syncGameAuction();
        return;
      }
      const cowPhases = ['cow.selectTarget', 'cow.selectAnimal', 'cow.commit', 'cow.choose', 'cow.selectMoney', 'cow.reveal', 'cow.settlement'];
      if (cowPhases.includes(game.phase)) {
        if (!cow.initiatorId || env.senderId !== cow.initiatorId) return;
        cow.initiatorId = undefined;
        cow.targetPlayerId = undefined;
        cow.targetAnimal = undefined;
        cow.initiatorSecret = undefined;
        cow.targetSecret = undefined;
        cow.initiatorCardCount = undefined;
        cow.targetCardCount = undefined;
        game.phase = 'turn.choice';
        game.appendLog('Cow trade cancelled, returning to turn choice.');
        game.bumpVersion();
        return;
      }
    });

    const offChooseCowTrade = broadcast.subscribe(Msg.Action.ChooseCowTrade, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      const { playerId } = env.payload as { playerId: string };
      if (game.phase !== 'turn.choice' || env.senderId !== game.turnOwnerId) return;
      if (env.senderId !== playerId) return;
      cow.initiateCowTrade();
    });

    const offSelectCowTarget = broadcast.subscribe(Msg.Action.SelectCowTarget, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      const { playerId, targetId } = env.payload as { playerId: string; targetId: string };
      if (game.phase !== 'cow.selectTarget' || env.senderId !== playerId || playerId !== cow.initiatorId) return;
      cow.selectTarget(targetId);
    });

    const offSelectCowAnimal = broadcast.subscribe(Msg.Action.SelectCowAnimal, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      const { playerId, animal } = env.payload as { playerId: string; animal: import('@/types/game').Animal };
      if (game.phase !== 'cow.selectAnimal' || env.senderId !== playerId || playerId !== cow.initiatorId) return;
      cow.selectAnimal(animal);
    });

    const offCommitCowTrade = broadcast.subscribe(Msg.Action.CommitCowTrade, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      const { playerId, moneyCardIds } = env.payload as { playerId: string; moneyCardIds: string[] };
      if (game.phase !== 'cow.commit' || env.senderId !== playerId || playerId !== cow.initiatorId) return;
      cow.commitInitiator(moneyCardIds);
    });

    const offAcceptCowOffer = broadcast.subscribe(Msg.Action.AcceptCowOffer, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      const { playerId } = env.payload as { playerId: string };
      if (game.phase !== 'cow.choose' || env.senderId !== playerId || playerId !== cow.targetPlayerId) return;
      cow.acceptOffer();
    });

    const offCounterCowOffer = broadcast.subscribe(Msg.Action.CounterCowOffer, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      const { playerId } = env.payload as { playerId: string };
      if (game.phase !== 'cow.choose' || env.senderId !== playerId || playerId !== cow.targetPlayerId) return;
      cow.counterOffer();
    });

    const offCommitCowCounter = broadcast.subscribe(Msg.Action.CommitCowCounter, (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      const { playerId, moneyCardIds } = env.payload as { playerId: string; moneyCardIds: string[] };
      if (game.phase !== 'cow.selectMoney' || env.senderId !== playerId || playerId !== cow.targetPlayerId) return;
      cow.commitCounter(moneyCardIds);
    });

    // Host answers state requests and sends snapshots
    let stateVersion = 0;
    const offRequest = broadcast.subscribe(Msg.System.RequestState, async (env) => {
      if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
      // Build snapshot and publish
      const snapshot = game.$state as never;
      stateVersion++;
      await broadcast.publish(Msg.State.Update, { state: snapshot }, { stateVersion });
    });

    // Cleanups on unload
    const off = () => {
      offStart(); offChoose(); offPlace(); offPass(); offAward(); offBuyback();
      offConfirmBuyback(); offCancelBuyback(); offChooseCowTrade(); offSelectCowTarget();
      offSelectCowAnimal(); offCommitCowTrade(); offAcceptCowOffer(); offCounterCowOffer();
      offCommitCowCounter();
      offPresence();
    };
    window.addEventListener('beforeunload', off);
  } else {
    // Non-host clients: subscribe to state updates, request a snapshot if not received
    const auction = useAuctionStore();
    const cow = useCowStore();

    function validateStateConsistency(serverState: any) {
      if (!serverState) return;
      const game = useGameStore();
      if (serverState.phase !== game.phase) {
        console.warn('[CONSISTENCY] Phase mismatch:', { server: serverState.phase, client: game.phase });
      }
      if (serverState.turnOwnerId !== game.turnOwnerId) {
        console.warn('[CONSISTENCY] Turn owner mismatch:', { server: serverState.turnOwnerId, client: game.turnOwnerId });
      }
    }

    let gotSnapshot = false;
    const off = broadcast.subscribe(Msg.State.Update, (env) => {
      useGameStore().applySnapshot(env.payload.state as never);
      if (env.payload.state?.auction) {
        auction.auction = env.payload.state.auction;
      } else {
        auction.auction = null;
      }
      if (env.payload.state?.cow) {
        cow.initiatorId = env.payload.state.cow.initiatorId;
        cow.targetPlayerId = env.payload.state.cow.targetPlayerId;
        cow.targetAnimal = env.payload.state.cow.targetAnimal;
        cow.initiatorCardCount = env.payload.state.cow.initiatorCardCount;
        cow.targetCardCount = env.payload.state.cow.targetCardCount;
      } else {
        cow.initiatorId = undefined;
        cow.targetPlayerId = undefined;
        cow.targetAnimal = undefined;
        cow.initiatorCardCount = undefined;
        cow.targetCardCount = undefined;
      }
      validateStateConsistency(env.payload.state);
      gotSnapshot = true;
    });
    setTimeout(() => {
      if (!gotSnapshot) {
        void broadcast.publish(Msg.System.RequestState, { requesterId: PLAYER });
      }
    }, 1000);
    window.addEventListener('beforeunload', off);
  }

  // Before unload leave
  window.addEventListener('beforeunload', () => {
    void presence.leave(ROOM);
  });

  exposeDebugHelpers(true, ROOM, PLAYER);
}

function exposeDebugHelpers(isConnected: boolean, ROOM: string, PLAYER: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__ably) return;

  w.__ably = {
    ROOM,
    PLAYER,
    init: async (playerId: string) => {
      await initAbly(playerId);
      await getChannel(ROOM);
      await presence.enter(ROOM, { playerId, name: playerId });
      if (isDebug()) console.debug('[__ably.init] connected as', playerId);
    },
    getMembers: async () => {
      const m = await presence.getMembers(ROOM);
      console.table(m);
      return m;
    },
    publishRaw: async <T extends MsgType>(type: T, payload: unknown) => {
      const env = makeEnvelope(type, ROOM, PLAYER || 'unknown', payload as never);
      await publishRaw(ROOM, type, env);
      if (isDebug()) console.debug('[PUB]', type, env);
    },
    subscribeRaw: <T extends MsgType>(type: T) => {
      const off = subscribeRaw(ROOM, type, (env) => {
        console.debug('[RECV]', type, env);
      });
      return off;
    },
    leave: async () => presence.leave(ROOM),
    close: () => closeAbly(),
    _connected: isConnected,
  };
}
