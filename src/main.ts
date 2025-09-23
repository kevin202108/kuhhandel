import { createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import App from './App.vue';
import './assets/main.css';

import {
  initAbly,
  getChannel,
  publishRaw,
  subscribeRaw,
  presence,
  closeAbly,
} from '@/networking/ablyClient';
import { makeEnvelope, Msg, type MsgType } from '@/networking/protocol';
import broadcast from '@/services/broadcast';
import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import { useCowStore } from '@/store/cow';
import { getHostId } from '@/services/host-election';

// ---- URL flags嚗? README 閬?銝?湛?
const url = new URL(location.href);
const ROOM = (url.searchParams.get('room') ?? 'dev').toLowerCase().trim();
const DEBUG = url.searchParams.get('debug') === '1';

// Session-scoped player identity (auto-generated), independent from URL
function generatePlayerId(len = 12): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789_-';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function ensurePlayerId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.__PLAYER__ === 'string' && g.__PLAYER__) return g.__PLAYER__;
  let fromSession = '';
  try { fromSession = sessionStorage.getItem('playerId') || ''; } catch { /* ignore */ }
  if (fromSession) { g.__PLAYER__ = fromSession; return fromSession; }
  const id = generatePlayerId();
  try { sessionStorage.setItem('playerId', id); } catch { /* ignore */ }
  g.__PLAYER__ = id;
  return id;
}

function readDisplayName(): string {
  try { return (sessionStorage.getItem('displayName') || '').slice(0, 12); } catch { return ''; }
}

const PLAYER = ensurePlayerId();

// ?迂摮???README嚗[a-z0-9_-]{1,24}$嚗?
const ID_RE = /^[a-z0-9_-]{1,24}$/;
function assertIdOrThrow(id: string, kind: 'roomId' | 'playerId') {
  if (!ID_RE.test(id)) {
    throw new Error(`[main] Invalid ${kind} "${id}". Must match ${ID_RE.source}`);
  }
}

// ---- ?? Vue
const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.mount('#app');
setActivePinia(pinia);

// ---- 狀態一致性驗證函數
function validateStateConsistency(serverState: any) {
  if (!serverState) return;

  const game = useGameStore();
  const auction = useAuctionStore();
  const cow = useCowStore();

  // 驗證核心狀態
  if (serverState.phase !== game.phase) {
    console.warn('[CONSISTENCY] Phase mismatch:', {
      server: serverState.phase,
      client: game.phase
    });
  }

  if (serverState.turnOwnerId !== game.turnOwnerId) {
    console.warn('[CONSISTENCY] Turn owner mismatch:', {
      server: serverState.turnOwnerId,
      client: game.turnOwnerId
    });
  }

  // 驗證 cow 狀態
  const serverCow = serverState.cow;
  const clientCow = {
    initiatorId: cow.initiatorId,
    targetPlayerId: cow.targetPlayerId,
    targetAnimal: cow.targetAnimal
  };

  if (serverCow) {
    const differences: string[] = [];
    if (serverCow.initiatorId !== clientCow.initiatorId) differences.push('initiatorId');
    if (serverCow.targetPlayerId !== clientCow.targetPlayerId) differences.push('targetPlayerId');
    if (serverCow.targetAnimal !== clientCow.targetAnimal) differences.push('targetAnimal');

    if (differences.length > 0) {
      console.warn('[CONSISTENCY] Cow state mismatch:', {
        differences,
        serverCow,
        clientCow
      });
    }
  }
}

// ---- Step 2嚗?撠皜祆蝺??芣????player= ?????芸?? presence嚗?
void (async function bootstrapPhase2() {
  try {
    if (!PLAYER) {
      if (DEBUG) console.debug('[main] No ?player provided ??skip Ably init for now.');
      exposeDebugHelpers(false); // ?? debug 撌亙嚗??????嚗靘蹂?敺???init
      return;
    }

    assertIdOrThrow(ROOM, 'roomId');

    // 1) ????Ably嚗lientId === playerId嚗ormalize ??ablyClient.ts 銋?????甈∴?
    await initAbly(PLAYER);
    if (DEBUG) console.debug('[main] Ably initialized as clientId=', PLAYER);

    // 2) ???駁?嚗ame-v1-{roomId}嚗?
    await getChannel(ROOM);
    if (DEBUG) console.debug('[main] Channel attached:', `game-v1-${ROOM}`);

    // 3) presence.enter嚗ame ? playerId嚗ameEntry 銋??航?撖恬?
    // Wait for displayName to be available before joining presence
    const NAME = readDisplayName();
    if (!NAME) {
      if (DEBUG) console.debug('[main] No displayName yet — waiting for Setup to submit.');
      exposeDebugHelpers(false);
      return;
    }
    await presence.enter(ROOM, { playerId: PLAYER, name: NAME });
    if (DEBUG) console.debug('[main] presence.enter ok');

    // Phase 2 wiring: publish join, elect host, and set up snapshot sync
    await broadcast.publish(Msg.System.Join, { playerId: PLAYER, name: NAME });

    const game = useGameStore();
    const auction = useAuctionStore();
    const cow = useCowStore();

    // Get current members and elect initial host
    let members = await presence.getMembers(ROOM);
    let elected = getHostId(members);
    if (elected) {
      game.setHostId(elected);
    }

    // Monitor presence changes to re-elect host
    const offPresence = presence.subscribePresenceEvents(ROOM, async (action, member) => {
      if (action === 'enter' || action === 'leave') {
        // Refresh members list
        members = await presence.getMembers(ROOM);
        const newHost = getHostId(members);
        if (newHost && newHost !== game.hostId) {
          const oldHost = game.hostId;
          game.setHostId(newHost);
          // Broadcast host changed message
          await broadcast.publish(Msg.System.HostChanged, { newHostId: newHost });
          if (DEBUG) console.debug('[host] Host changed from', oldHost, 'to:', newHost);
          // Handle game state transition if necessary
          handleHostChange(oldHost, newHost!);
        }
      }
    });

    // Helper function to handle host change transitions
    function handleHostChange(oldHost: string | undefined, newHost: string) {
      // Log host changes for transparency
      if (game.phase !== 'setup' && oldHost && newHost !== oldHost) {
        game.appendLog(`Host changed from ${oldHost} to ${newHost}.`);
      }
      // Game state continues automatically as all logic checks game.hostId dynamically
    }

    const amHost = () => game.hostId === PLAYER;
    if (DEBUG) {
      console.debug('[presence] members');
      console.table(members);
      console.debug('[host] elected =', elected, 'amHost =', amHost());
    }

    // Subscribe to HostChanged messages to update local state
    broadcast.subscribe(Msg.System.HostChanged, (env) => {
      const { newHostId } = env.payload as { newHostId: string };
      if (newHostId && newHostId !== game.hostId) {
        const oldHost = game.hostId;
        game.setHostId(newHostId);
        if (DEBUG) console.debug('[host] Received HostChanged from', oldHost, 'to:', newHostId);
        handleHostChange(oldHost, newHostId!);
      }
    });

    if (amHost()) {
      // Host: route action.* to store mutations with simple dedupe
      const seen = new Map<string, number>();
      function accept(type: string, senderId: string, actionId?: string, ts?: number): boolean {
        const id = actionId ?? 'noid';
        const key = `${senderId}|${type}|${id}`;
        if (seen.has(key)) return false;
        seen.set(key, ts ?? Date.now());
        // prune oldest if too many
        if (seen.size > 600) {
          const entries = Array.from(seen.entries()).sort((a, b) => a[1] - b[1]);
          for (let i = 0; i < entries.length - 500; i++) seen.delete(entries[i]![0]!);
        }
        return true;
      }

      // StartGame → build players from presence and setup (host-only)
      const offStart = broadcast.subscribe(Msg.Action.StartGame, async (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        if (env.senderId !== game.hostId) return;
        const ms = await presence.getMembers(ROOM);
        const players = ms.map((m) => ({ id: m.id, name: (m.data as any)?.name || m.id }));
        game.setupGame(players);
        game.startTurn();
      });

      // ChooseAuction → enter bidding (only turn owner)
      const offChoose = broadcast.subscribe(Msg.Action.ChooseAuction, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const pid = (env.payload as any)?.playerId as string | undefined;
        if (game.phase !== 'turn.choice') return;
        if (!pid || pid !== game.turnOwnerId) return;
        if (env.senderId !== pid) return;
        auction.enterBidding();
      });

      // PlaceBid / PassBid (bidders only, not auctioneer)
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

      // HostAward (host-only)
      const offAward = broadcast.subscribe(Msg.Action.HostAward, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        if (game.phase !== 'auction.closing' || !game.auction) return;
        const auctioneer = game.auction?.auctioneerId;
        if (env.senderId !== auctioneer) return;
        auction.hostAward();
      });

      // HostBuyback (host-only, auctioneer only)
      const offBuyback = broadcast.subscribe(Msg.Action.HostBuyback, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        if (game.phase !== 'auction.closing' || !game.auction) return;
        const auctioneer = game.auction?.auctioneerId;
        if (env.senderId !== auctioneer) return;

        console.log('[DEBUG] Host processing HostBuyback');
        auction.hostBuyback();
      });

      // ConfirmBuyback (host-only, auctioneer only)
      const offConfirmBuyback = broadcast.subscribe(Msg.Action.ConfirmBuyback, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        if (game.phase !== 'auction.buyback' || !game.auction) return;
        const auctioneer = game.auction?.auctioneerId;
        if (env.senderId !== auctioneer) return;

        const { moneyCardIds } = env.payload as { moneyCardIds: string[] };
        console.log('[DEBUG] Host processing ConfirmBuyback', { moneyCardIds });
        auction.confirmBuyback(moneyCardIds);
      });

      // CancelBuyback (host-only, supports both auction and cow trade cancelling)
      const offCancelBuyback = broadcast.subscribe(Msg.Action.CancelBuyback, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;

        // Handle auction buyback cancellation
        if (game.phase === 'auction.buyback') {
          const auctioneer = game.auction?.auctioneerId;
          if (env.senderId !== auctioneer) return;

          console.log('[DEBUG] Host processing Auction CancelBuyback');
          game.phase = 'auction.closing';
          game.appendLog('Auctioneer cancelled buyback.');
          auction.syncGameAuction();
          return;
        }

        // Handle cow trade cancellation
        const cowPhases = ['cow.selectTarget', 'cow.selectAnimal', 'cow.commit', 'cow.choose', 'cow.selectMoney', 'cow.reveal', 'cow.settlement'];
        if (cowPhases.includes(game.phase)) {
          // Only initiator can cancel cow trade
          if (!cow.initiatorId || env.senderId !== cow.initiatorId) return;

          console.log('[DEBUG] Host processing Cow Trade Cancel');

          // Clear cow trade state
          cow.initiatorId = undefined;
          cow.targetPlayerId = undefined;
          cow.targetAnimal = undefined;
          cow.initiatorSecret = undefined;
          cow.targetSecret = undefined;
          cow.initiatorCardCount = undefined;
          cow.targetCardCount = undefined;

          // Return to turn.choice
          game.phase = 'turn.choice';
          game.appendLog('Cow trade cancelled, returning to turn choice.');
          game.bumpVersion();
          return;
        }
      });

      // Cow Trade actions (host-only processing)
      const offChooseCowTrade = broadcast.subscribe(Msg.Action.ChooseCowTrade, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId } = env.payload as { playerId: string };
        if (game.phase !== 'turn.choice' || env.senderId !== game.turnOwnerId) return;
        if (env.senderId !== playerId) return;
        console.log('[DEBUG] Host processing ChooseCowTrade for', playerId);
        cow.initiateCowTrade();
      });

      const offSelectCowTarget = broadcast.subscribe(Msg.Action.SelectCowTarget, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId, targetId } = env.payload as { playerId: string; targetId: string };
        if (game.phase !== 'cow.selectTarget' || env.senderId !== playerId || playerId !== cow.initiatorId) return;
        console.log('[DEBUG] Host processing SelectCowTarget', { playerId, targetId });
        cow.selectTarget(targetId);
      });

      const offSelectCowAnimal = broadcast.subscribe(Msg.Action.SelectCowAnimal, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId, animal } = env.payload as { playerId: string; animal: import('@/types/game').Animal };
        if (game.phase !== 'cow.selectAnimal' || env.senderId !== playerId || playerId !== cow.initiatorId) return;
        console.log('[DEBUG] Host processing SelectCowAnimal', { playerId, animal });
        cow.selectAnimal(animal);
      });

      const offCommitCowTrade = broadcast.subscribe(Msg.Action.CommitCowTrade, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId, moneyCardIds } = env.payload as { playerId: string; moneyCardIds: string[] };
        if (game.phase !== 'cow.commit' || env.senderId !== playerId) return;
        if (playerId === cow.initiatorId) {
          console.log('[DEBUG] Host processing CommitCowTrade for initiator', { playerId, moneyCardIds });
          cow.commitInitiator(moneyCardIds);
        } else {
          console.log('[DEBUG] Host ignoring CommitCowTrade for non-initiator', playerId);
        }
      });

      const offAcceptCowOffer = broadcast.subscribe(Msg.Action.AcceptCowOffer, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId } = env.payload as { playerId: string };
        if (game.phase !== 'cow.choose' || env.senderId !== playerId || playerId !== cow.targetPlayerId) return;
        console.log('[DEBUG] Host processing AcceptCowOffer', { playerId });
        cow.acceptOffer();
      });

      const offCounterCowOffer = broadcast.subscribe(Msg.Action.CounterCowOffer, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId } = env.payload as { playerId: string };
        if (game.phase !== 'cow.choose' || env.senderId !== playerId || playerId !== cow.targetPlayerId) return;
        console.log('[DEBUG] Host processing CounterCowOffer', { playerId });
        cow.counterOffer();
      });

      const offCommitCowCounter = broadcast.subscribe(Msg.Action.CommitCowCounter, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId, moneyCardIds } = env.payload as { playerId: string; moneyCardIds: string[] };
        if (game.phase !== 'cow.selectMoney' || env.senderId !== playerId || playerId !== cow.targetPlayerId) return;
        console.log('[DEBUG] Host processing CommitCowCounter', { playerId, moneyCardIds });
        cow.commitCounter(moneyCardIds);
      });
      
      const offCancelCowCounter = broadcast.subscribe(Msg.Action.CancelCowCounter, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId } = env.payload as { playerId: string };
        if (game.phase !== 'cow.selectMoney' || env.senderId !== playerId || playerId !== cow.targetPlayerId) return;
        console.log('[DEBUG] Host processing CancelCowCounter', { playerId });
        cow.cancelCounter();
      });

      const offProceedCowReveal = broadcast.subscribe(Msg.Action.ProceedCowReveal, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId } = env.payload as { playerId: string };
        if (game.phase !== 'cow.reveal' || env.senderId !== playerId || playerId !== game.hostId) return;
        console.log('[DEBUG] Host processing ProceedCowReveal', { playerId });
        if (cow.initiatorSecret && cow.targetSecret) {
          cow.revealAndSettle();
        } else if (cow.initiatorSecret) {
          cow.revealAcceptedAndSettle();
        } else {
          // no data to settle; fail-safe cancel
          cow.cancelCowTrade();
        }
      });
      // Host: broadcast full snapshot on any mutation
      game.$subscribe((_mutation, state) => {
        const plain = JSON.parse(JSON.stringify(state));
        void broadcast.publish(Msg.State.Update, { state: plain as never }, {
          stateVersion: state.stateVersion,
        });
      });

      // Reply to state requests
      broadcast.subscribe(Msg.System.RequestState, () => {
        const plain = JSON.parse(JSON.stringify(game.$state));
        void broadcast.publish(Msg.State.Update, { state: plain as never }, {
          stateVersion: game.stateVersion,
        });
      });
    } else {
      // Client: apply snapshots from host; request one after a short grace
      let gotSnapshot = false;
      const off = broadcast.subscribe(Msg.State.Update, (env) => {
        if (env.senderId !== game.hostId) return;
        const incoming = env.stateVersion ?? 0;
        if (incoming <= game.stateVersion) return;

        console.log('[DEBUG] Client receiving state update:', {
          stateVersion: incoming,
          phase: env.payload.state?.phase,
          turnOwnerId: env.payload.state?.turnOwnerId,
          auction: env.payload.state?.auction,
          cow: env.payload.state?.cow,
          playersCount: env.payload.state?.players?.length,
          deckCount: env.payload.state?.deck?.length,
          logCount: env.payload.state?.log?.length
        });

        // 1. 同步核心 Game 狀態
        game.applySnapshot(env.payload.state as never);

        // 2. 同步 Auction 狀態
        if (env.payload.state?.auction) {
          console.log('[DEBUG] Syncing auction state:', env.payload.state.auction);
          auction.auction = env.payload.state.auction;
        } else {
          console.log('[DEBUG] Clearing auction state');
          auction.auction = null;
        }

        // 3. 同步 Cow 狀態
        if (env.payload.state?.cow) {
          console.log('[DEBUG] Syncing cow state:', env.payload.state.cow);
          cow.initiatorId = env.payload.state.cow.initiatorId;
          cow.targetPlayerId = env.payload.state.cow.targetPlayerId;
          cow.targetAnimal = env.payload.state.cow.targetAnimal;
          cow.initiatorCardCount = env.payload.state.cow.initiatorCardCount;
          cow.targetCardCount = env.payload.state.cow.targetCardCount;
          // 注意：secret 字段不會同步，因為它們是 Host-only

          console.log('[DEBUG] Cow state synchronized:', {
            initiatorId: cow.initiatorId,
            targetPlayerId: cow.targetPlayerId,
            targetAnimal: cow.targetAnimal,
            initiatorCardCount: cow.initiatorCardCount,
            targetCardCount: cow.targetCardCount,
            hostId: game.hostId,
            myId: PLAYER
          });
        } else {
          console.log('[DEBUG] Clearing cow state');
          cow.initiatorId = undefined;
          cow.targetPlayerId = undefined;
          cow.targetAnimal = undefined;
          cow.initiatorCardCount = undefined;
          cow.targetCardCount = undefined;
        }

        // 4. 驗證狀態一致性
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

    // 4) ?? debug 撌亙嚗歇?????
    exposeDebugHelpers(true);

    // 5) ????蝺?
    window.addEventListener('beforeunload', () => {
      void presence.leave(ROOM);
      // closeAbly() ?舫嚗虜銝???beforeunload ?澆
    });

    // 6) DEBUG嚗??箸???
    if (DEBUG) {
      const members = await presence.getMembers(ROOM);
      console.table(members);
    }
  } catch (err) {
    console.error('[main] Ably bootstrap failed:', err);
  }
})();

// ---- Debug 撌亙嚗 Console ??window.__ably ?澆
function exposeDebugHelpers(isConnected: boolean) {
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
      if (DEBUG) console.debug('[__ably.init] connected as', playerId);
    },
    getMembers: async () => {
      const m = await presence.getMembers(ROOM);
      console.table(m);
      return m;
    },
    // ?潮?閮??憪?Envelope??
    publishRaw: async <T extends MsgType>(type: T, payload: unknown) => {
      // 雿輻 README ??makeEnvelope嚗enderId ?函???Ｙ? PLAYER
      const env = makeEnvelope(type, ROOM, PLAYER || 'unknown', payload as never);
      await publishRaw(ROOM, type, env);
      if (DEBUG) console.debug('[PUB]', type, env);
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

  if (DEBUG) {
    console.debug(
      '[main] __ably ready. Try in console:\n' +
        '  await __ably.getMembers()\n' +
        '  const off = __ably.subscribeRaw("system.join")\n' +
        '  await __ably.publishRaw("system.join", { playerId: __ably.PLAYER, name: __ably.PLAYER })\n' +
        '  off()'
    );
  }
}
// (removed) duplicate import left from dev-only section


// ??亥??澆 initAbly(playerId)嚗tep 2 摰???荔?嚗??ablyClient.assertClient ????
// 靘?嚗nitAbly((globalThis as any).__PLAYER__ ?? 'alice');

// (removed) dev-only demo subscribe

// (removed) dev-only demo publish
