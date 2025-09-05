// src/main.ts
import { createApp, type App as VueApp, toRaw  } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';

import { useGameStore } from '@/store/game';
import { useAuctionStore } from '@/store/auction';
import { useCowStore } from '@/store/cow';

import { Msg, type PayloadByType } from '@/networking/protocol';
import { createBroadcast, type IBroadcast } from '@/services/broadcast';
import { getHostId, shouldReelect } from '@/services/host-election';
import { mountHostDispatcher } from '@/networking/host-dispatcher';

/* ----------------------------- 小工具與常數 ----------------------------- */

const ROOM_FALLBACK = 'dev';
const NAME_FALLBACK_PREFIX = 'Player-';

function normalizePlayerId(raw: string | null): string | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  return /^[a-z0-9_-]{1,24}$/.test(id) ? id : null;
}
// 取代原本 snapshot<T>(v) 的實作
function snapshot<T>(v: T): T {
  // 先把 Proxy 拆掉，再走 JSON 來確保純資料
  // （所有 state 都應只包含可 JSON 化的值，符合 README Phase 2）
  return JSON.parse(JSON.stringify(toRaw(v)));
}

async function listMemberIds(b: IBroadcast): Promise<string[]> {
  const members = await b.presence().getMembers();
  return members.map((m) => m.id).sort();
}

/* ----------------------------- URL 參數解析 ----------------------------- */

// 支援 ?player= 與相容舊參數 ?pid=
const url = new URL(window.location.href);
const roomId = url.searchParams.get('room')?.trim() || ROOM_FALLBACK;
const rawPid = url.searchParams.get('player') ?? url.searchParams.get('pid');
const normalizedPlayerId = normalizePlayerId(rawPid);
if (!normalizedPlayerId) {
  throw new Error(
    'Invalid or missing ?player. Expected [a-z0-9_-]{1,24}. Example: ?room=dev&player=a&name=Alice'
  );
}
const playerId = normalizedPlayerId;
const playerName =
  url.searchParams.get('name')?.trim() ||
  `${NAME_FALLBACK_PREFIX}${playerId.slice(0, Math.max(1, Math.min(4, playerId.length)))}`;

/* ----------------------------- Vue 啟動 ----------------------------- */

const pinia = createPinia();
const app: VueApp = createApp(App);
app.use(pinia);

// 取得 stores
const game = useGameStore();
const auction = useAuctionStore();
const cow = useCowStore();

// 提供 selfId 給組件（hostId/phase 由 store 直接讀）
app.provide('selfId', playerId);

const broadcast = createBroadcast(roomId, playerId);

// ⚠️ 這行你漏掉了
app.provide('broadcast', broadcast);

// 先掛 App（UI 會依 store 自動切換 Name/Lobby/Game）
app.mount('#app');

/* ----------------------------- 即時連線與 Presence ----------------------------- */
let unmountDispatcher: (() => void) | null = null;
let hasAppliedStateOnce = false;

const PRESENCE_POLL_MS = 1200;
let presencePollTimer: number | undefined;

/* ----------------------------- 二登守門（同 room 同 playerId） ----------------------------- */

async function guardDuplicateLogin(): Promise<void> {
  const ids = await listMemberIds(broadcast);
  const dupCount = ids.filter((id) => id === playerId).length;
  if (dupCount > 1) {
    try {
      await broadcast.presence().leave();
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-alert
    alert(`PlayerId "${playerId}" is already present in room "${roomId}". Please use another id.`);
    throw new Error('Duplicate playerId presence detected');
  }
}

/* ----------------------------- 加入房間（presence + system.join） ----------------------------- */

async function joinRoom(): Promise<void> {
  await broadcast.presence().enter({ playerId, name: playerName });
  await guardDuplicateLogin();

  // 系統 join 僅傳 payload（非 Envelope）
  const payload: PayloadByType[typeof Msg.System.Join] = { playerId, name: playerName };
  await broadcast.publish(Msg.System.Join, payload);
}

/* ----------------------------- 是否接受快照（payload-only 版） ----------------------------- */

async function shouldAcceptState(payload: PayloadByType[typeof Msg.State.Update]): Promise<boolean> {
  const incoming = payload.state;

  // 版本必須較新
  if (incoming.stateVersion <= game.stateVersion) return false;

  // 已鎖 Host：只接受 hostId 一致的快照（senderId 無法得知，只能以 hostId 一致 + 版本遞增保障）
  if (typeof game.hostId !== 'undefined') {
    return incoming.hostId === game.hostId;
  }

  // 未鎖 Host（setup 期）：僅暫信「presence 最小 id」所帶快照（payload 沒有 senderId，因此以 hostId===minId 判斷）
  const ids = await listMemberIds(broadcast);
  const minId = ids.length > 0 ? ids[0] : null;
  if (!minId) return false;

  // 若 incoming.hostId 仍未填（初期有可能），則保守拒收；由最小 id 來「主動鎖定 + 廣播」
  if (!incoming.hostId) return false;

  return incoming.hostId === minId;
}

/* ----------------------------- 套用 Host 發來的快照 ----------------------------- */

function applyFullSnapshot(payload: PayloadByType[typeof Msg.State.Update]): void {
  (game as unknown as { $state: typeof game.$state }).$state = payload.state;
  hasAppliedStateOnce = true;
}

/* ----------------------------- Host 首次鎖定（setup） ----------------------------- */

async function tryLockHostAtSetup(): Promise<void> {
  if (game.phase !== 'setup') return;
  if (typeof game.hostId !== 'undefined') return; // 已鎖

  const ids = await listMemberIds(broadcast);
  const minId = ids.length > 0 ? ids[0] : null;

  if (minId && minId === playerId) {
    // 我是最小 id -> 鎖 hostId 並廣播首包快照
    game.setHostAtSetup(playerId);
    game.stateVersion += 1;

    const payload: PayloadByType[typeof Msg.State.Update] = { state: snapshot(game.$state) };
    await broadcast.publish(Msg.State.Update, payload);

    mountDispatcherIfHost(); // 成為 Host 後掛載 dispatcher
  }
}

/* ----------------------------- Host 遷移（舊 Host 離線） ----------------------------- */

async function handleHostMigrationIfNeeded(): Promise<void> {
  const memberIds = await listMemberIds(broadcast);
  const oldHostId = game.hostId;
  if (typeof oldHostId === 'undefined') return; // 尚未鎖定 Host

  if (!shouldReelect(oldHostId, memberIds)) return;

  const newHostId = getHostId(memberIds.map((id) => ({ id })));
  if (!newHostId) return; // 房裡空了

  if (newHostId === playerId) {
    // 我接任 Host：Phase 2 規範，若在 cow.commit / cow.reveal，取消該回合並回 turn.choice
    if (game.phase === 'cow.commit' || game.phase === 'cow.reveal') {
      game.cow = null;
      game.phase = 'turn.choice';
    }
    game.hostId = newHostId;
    game.stateVersion += 1;

    const hostChangedPayload: PayloadByType[typeof Msg.System.HostChanged] = { newHostId };
    await broadcast.publish(Msg.System.HostChanged, hostChangedPayload);

    const statePayload: PayloadByType[typeof Msg.State.Update] = { state: snapshot(game.$state) };
    await broadcast.publish(Msg.State.Update, statePayload);

    mountDispatcherIfHost();
  } else {
    // 我不是新 Host，確保卸載 dispatcher
    unmountDispatcherIfMounted();
  }
}

/* ----------------------------- Host Dispatcher 掛/卸 ----------------------------- */

// src/main.ts（替換 mountDispatcherIfHost 內傳入 mutate 的那段）
function mountDispatcherIfHost(): void {
  if (game.hostId !== playerId) {
    unmountDispatcherIfMounted();
    return;
  }
  if (!unmountDispatcher) {
    const mutate = {
      game: {
        setupGameFromCurrentPlayers: () => game.setupGameFromCurrentPlayers(),
        startTurn: () => game.startTurn(),
        appendLog: (msg: string) => game.appendLog(msg)
      },
      auction: {
        enterBidding: () => auction.enterBidding(),
        placeBid: (pid: string, ids: string[], actionId: string) =>
          auction.placeBid(pid, ids, actionId),
        passBid: (pid: string) => auction.passBid(pid),
        hostAward: () => auction.hostAward(),
        hostBuyback: () => auction.hostBuyback(),
        settle: (mode: 'award' | 'buyback') => auction.settle(mode)
      },
      cow: {
        selectTarget: (targetPlayerId: string) => cow.selectTarget(targetPlayerId),
        selectAnimal: (animal: import('@/types/game').Animal) => cow.selectAnimal(animal),
        commitSecret: (pid: string, ids: string[]) => cow.commitSecret(pid, ids),
        revealAndResolve: () => cow.revealAndResolve()
      },
      // 若你的 HostMutators 沒有 players/bumpStateVersion，就把這兩段移除
      players: {
        addOnSetup: (pid: string, name: string) => {
          // 若 store 沒有這支，請移除此段並同步改 host-dispatcher
          // 例如：game.addPlayerOnSetup(pid, name)
        },
        removeOnSetup: (pid: string) => {
          // 若 store 沒有這支，請移除此段並同步改 host-dispatcher
          // 例如：game.removePlayerOnSetup(pid)
        }
      },
      bumpStateVersion: () => {
        game.stateVersion += 1;
      }
    } as const;

    unmountDispatcher = mountHostDispatcher(
      broadcast,
      roomId,
      () => snapshot(game.$state),
      mutate
    );
  }
}

function unmountDispatcherIfMounted(): void {
  if (unmountDispatcher) {
    unmountDispatcher();
    unmountDispatcher = null;
  }
}

/* ----------------------------- 訂閱 state.update（payload-only） ----------------------------- */

const unsubscribeStateUpdate = broadcast.subscribe(Msg.State.Update, async (payload) => {
  // 若我是 Host，自然不接受別人的快照（避免互踩）
  if (game.hostId === playerId) return;

  if (!(await shouldAcceptState(payload.payload))) return;

  applyFullSnapshot(payload.payload);

  // 一旦換 Host（或我成為 Host），同步掛/卸 dispatcher
  mountDispatcherIfHost();
});

/* ----------------------------- 重連快照請求（保險機制） ----------------------------- */

window.setTimeout(async () => {
  if (!hasAppliedStateOnce) {
    const req: PayloadByType[typeof Msg.System.RequestState] = { requesterId: playerId };
    await broadcast.publish(Msg.System.RequestState, req);
  }
}, 1000);

/* ----------------------------- Presence 輪詢（事件備援） ----------------------------- */

function startPresencePolling(): void {
  stopPresencePolling();
  presencePollTimer = window.setInterval(async () => {
    try {
      await guardDuplicateLogin();
    } catch {
      stopPresencePolling();
      return;
    }
    await tryLockHostAtSetup();
    await handleHostMigrationIfNeeded();
  }, PRESENCE_POLL_MS);
}

function stopPresencePolling(): void {
  if (typeof presencePollTimer !== 'undefined') {
    window.clearInterval(presencePollTimer);
    presencePollTimer = undefined;
  }
}

/* ----------------------------- 啟動流程 ----------------------------- */

(async () => {
  try {
    await joinRoom();
    startPresencePolling();
    await tryLockHostAtSetup();
  } catch (err: unknown) {
    // 你可以把錯誤寫入 Pinia，讓 App.vue 顯示錯誤畫面
    // eslint-disable-next-line no-console
    console.error('[main] join failed:', err);
  }
})();

/* ----------------------------- 卸載與清理 ----------------------------- */

window.addEventListener('beforeunload', async () => {
  try {
    stopPresencePolling();
    unmountDispatcherIfMounted();
    await broadcast.presence().leave();

    const leavePayload: PayloadByType[typeof Msg.System.Leave] = { playerId };
    await broadcast.publish(Msg.System.Leave, leavePayload);
  } catch {
    // ignore
  }
});

// 可選：在 HMR 卸載時也做清理（取決於你的 dev 需求）
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopPresencePolling();
    unmountDispatcherIfMounted();
  });
}
