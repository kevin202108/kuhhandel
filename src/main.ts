import { createApp } from 'vue';
import { createPinia } from 'pinia';
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

// ---- URL flags（與 README 規範一致）
const url = new URL(location.href);
const ROOM = (url.searchParams.get('room') ?? 'dev').toLowerCase().trim();
const PLAYER = (url.searchParams.get('player') ?? '').toLowerCase().trim();
const DEBUG = url.searchParams.get('debug') === '1';

// 允許字元集（README：^[a-z0-9_-]{1,24}$）
const ID_RE = /^[a-z0-9_-]{1,24}$/;
function assertIdOrThrow(id: string, kind: 'roomId' | 'playerId') {
  if (!ID_RE.test(id)) {
    throw new Error(`[main] Invalid ${kind} "${id}". Must match ${ID_RE.source}`);
  }
}

// ---- 啟動 Vue
const app = createApp(App);
app.use(createPinia());
app.mount('#app');

// ---- Step 2：最小可測接線（只有在 ?player= 提供時才自動加入 presence）
void (async function bootstrapAblyForDev() {
  try {
    if (!PLAYER) {
      if (DEBUG) console.debug('[main] No ?player provided → skip Ably init for now.');
      exposeDebugHelpers(false); // 先掛 debug 工具（未連線狀態），方便之後手動 init
      return;
    }

    assertIdOrThrow(ROOM, 'roomId');
    assertIdOrThrow(PLAYER, 'playerId');

    // 1) 初始化 Ably（clientId === playerId；normalize 由 ablyClient.ts 也會再把關一次）
    await initAbly(PLAYER);
    if (DEBUG) console.debug('[main] Ably initialized as clientId=', PLAYER);

    // 2) 附掛頻道（game-v1-{roomId}）
    await getChannel(ROOM);
    if (DEBUG) console.debug('[main] Channel attached:', `game-v1-${ROOM}`);

    // 3) presence.enter（name 先用 playerId；NameEntry 之後可覆寫）
    await presence.enter(ROOM, { playerId: PLAYER, name: PLAYER });
    if (DEBUG) console.debug('[main] presence.enter ok');

    // 4) 掛上 debug 工具（已連線版）
    exposeDebugHelpers(true);

    // 5) 頁面關閉時離線
    window.addEventListener('beforeunload', () => {
      void presence.leave(ROOM);
      // closeAbly() 可選；通常不必在 beforeunload 呼叫
    });

    // 6) DEBUG：列出成員
    if (DEBUG) {
      const members = await presence.getMembers(ROOM);
      console.table(members);
    }
  } catch (err) {
    console.error('[main] Ably bootstrap failed:', err);
  }
})();

// ---- Debug 工具：在 Console 用 window.__ably 呼叫
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
    // 發送/訂閱「原始 Envelope」
    publishRaw: async <T extends MsgType>(type: T, payload: unknown) => {
      // 使用 README 的 makeEnvelope；senderId 用目前頁面的 PLAYER
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
