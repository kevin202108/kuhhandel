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

// ---- URL flags（�? README 規�?一?��?
const url = new URL(location.href);
const ROOM = (url.searchParams.get('room') ?? 'dev').toLowerCase().trim();
const PLAYER = (url.searchParams.get('player') ?? '').toLowerCase().trim();
const DEBUG = url.searchParams.get('debug') === '1';

// ?�許字�??��?README：^[a-z0-9_-]{1,24}$�?
const ID_RE = /^[a-z0-9_-]{1,24}$/;
function assertIdOrThrow(id: string, kind: 'roomId' | 'playerId') {
  if (!ID_RE.test(id)) {
    throw new Error(`[main] Invalid ${kind} "${id}". Must match ${ID_RE.source}`);
  }
}

// ---- ?��? Vue
const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.mount('#app');
setActivePinia(pinia);

// ---- Step 2：�?小可測接線�??��????player= ?��??��??��??�入 presence�?
void (async function bootstrapPhase2() {
  try {
    if (!PLAYER) {
      if (DEBUG) console.debug('[main] No ?player provided ??skip Ably init for now.');
      exposeDebugHelpers(false); // ?��? debug 工具（未????�?��?，方便�?後�???init
      return;
    }

    assertIdOrThrow(ROOM, 'roomId');
    assertIdOrThrow(PLAYER, 'playerId');

    // 1) ?��???Ably（clientId === playerId；normalize ??ablyClient.ts 也�??��??��?次�?
    await initAbly(PLAYER);
    if (DEBUG) console.debug('[main] Ably initialized as clientId=', PLAYER);

    // 2) ?��??��?（game-v1-{roomId}�?
    await getChannel(ROOM);
    if (DEBUG) console.debug('[main] Channel attached:', `game-v1-${ROOM}`);

    // 3) presence.enter（name ?�用 playerId；NameEntry 之�??��?寫�?
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

      // StartGame ??build players from presence and setup
      broadcast.subscribe(Msg.Action.StartGame, async (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const ms = await presence.getMembers(ROOM);
        const players = ms.map((m) => ({ id: m.id, name: (m.data as any)?.name || m.id }));
        game.setupGame(players);
        game.startTurn();
      });

      // ChooseAuction ??enter bidding (host validates phase/turn)
      broadcast.subscribe(Msg.Action.ChooseAuction, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        auction.enterBidding();
      });

      // PlaceBid / PassBid
      broadcast.subscribe(Msg.Action.PlaceBid, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId, moneyCardIds } = env.payload;
        auction.placeBid(playerId, moneyCardIds, env.actionId || `${env.senderId}-${Date.now()}`);
      });
      broadcast.subscribe(Msg.Action.PassBid, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
        const { playerId } = env.payload;
        auction.passBid(playerId);
      });

      // HostAward
      broadcast.subscribe(Msg.Action.HostAward, (env) => {
        if (!accept(env.type, env.senderId, env.actionId, env.ts)) return;
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

    // 4) ?��? debug 工具（已????��?
    exposeDebugHelpers(true);

    // 5) ?�面?��??�離�?
    window.addEventListener('beforeunload', () => {
      void presence.leave(ROOM);
      // closeAbly() ?�選；通常不�???beforeunload ?�叫
    });

    // 6) DEBUG：�??��???
    if (DEBUG) {
      const members = await presence.getMembers(ROOM);
      console.table(members);
    }
  } catch (err) {
    console.error('[main] Ably bootstrap failed:', err);
  }
})();

// ---- Debug 工具：在 Console ??window.__ably ?�叫
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
    // ?��?訂閱?��?�?Envelope??
    publishRaw: async <T extends MsgType>(type: T, payload: unknown) => {
      // 使用 README ??makeEnvelope；senderId ?�目?��??��? PLAYER
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


// ?�在?��??�叫 initAbly(playerId)（Step 2 完�??�那?��?；否??ablyClient.assertClient ?��???
// 例�?：initAbly((globalThis as any).__PLAYER__ ?? 'alice');

// (removed) dev-only demo subscribe

// (removed) dev-only demo publish

