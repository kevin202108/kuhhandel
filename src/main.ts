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
import { getHostId } from '@/services/host-election';

// ---- URL flags嚗? README 閬?銝?湛?
const url = new URL(location.href);
const ROOM = (url.searchParams.get('room') ?? 'dev').toLowerCase().trim();
const PLAYER = (url.searchParams.get('player') ?? '').toLowerCase().trim();
const DEBUG = url.searchParams.get('debug') === '1';

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

// ---- Step 2嚗?撠皜祆蝺??芣????player= ?????芸?? presence嚗?
void (async function bootstrapPhase2() {
  try {
    if (!PLAYER) {
      if (DEBUG) console.debug('[main] No ?player provided ??skip Ably init for now.');
      exposeDebugHelpers(false); // ?? debug 撌亙嚗??????嚗靘蹂?敺???init
      return;
    }

    assertIdOrThrow(ROOM, 'roomId');
    assertIdOrThrow(PLAYER, 'playerId');

    // 1) ????Ably嚗lientId === playerId嚗ormalize ??ablyClient.ts 銋?????甈∴?
    await initAbly(PLAYER);
    if (DEBUG) console.debug('[main] Ably initialized as clientId=', PLAYER);

    // 2) ???駁?嚗ame-v1-{roomId}嚗?
    await getChannel(ROOM);
    if (DEBUG) console.debug('[main] Channel attached:', `game-v1-${ROOM}`);

    // 3) presence.enter嚗ame ? playerId嚗ameEntry 銋??航?撖恬?
    await presence.enter(ROOM, { playerId: PLAYER, name: PLAYER });
    if (DEBUG) console.debug('[main] presence.enter ok');

    // Phase 2 wiring: publish join, elect host, and set up snapshot sync
    await broadcast.publish(Msg.System.Join, { playerId: PLAYER, name: PLAYER });

    const game = useGameStore();
    const auction = useAuctionStore();
    const members = await presence.getMembers(ROOM);
    const elected = getHostId(members);
    if (elected) game.setHostId(elected);

    const amHost = () => game.hostId === PLAYER;
    if (DEBUG) {
      console.debug('[presence] members');
      console.table(members);
      console.debug('[host] elected =', elected, 'amHost =', amHost());
    }

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
        if (game.phase !== 'auction.bidding' || !auction.auction) return;
        const { playerId, moneyCardIds } = env.payload as any;
        if (!playerId || env.senderId !== playerId) return;
        if (playerId === auction.auction.auctioneerId) return;
        auction.placeBid(playerId, moneyCardIds, env.actionId || `${env.senderId}-${Date.now()}`);
      });
      const offPass = broadcast.subscribe(Msg.Action.PassBid, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        if (game.phase !== 'auction.bidding' || !auction.auction) return;
        const { playerId } = env.payload as any;
        if (!playerId || env.senderId !== playerId) return;
        if (playerId === auction.auction.auctioneerId) return;
        auction.passBid(playerId);
      });

      // HostAward (host-only)
      const offAward = broadcast.subscribe(Msg.Action.HostAward, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        if (env.senderId !== game.hostId) return;
        if (game.phase !== 'auction.closing' && game.phase !== 'auction.bidding') return;
        auction.hostAward();
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
        game.applySnapshot(env.payload.state as never);
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


