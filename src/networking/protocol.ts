// src/networking/protocol.ts
// 協定層：訊息常數、Payload 型別映射、Envelope、工具方法。
// 不使用 any；預設泛型為 unknown。支援 exactOptionalPropertyTypes。

import type { Animal, GameState } from '@/types/game';

/** 協定版本：若 schema 有破壞性變更，務必 +1 並（建議）更換頻道前綴 */
export const SCHEMA_VERSION = 1 as const;

/** 訊息常數：統一來源避免手滑字串。 */
export const Msg = {
  Action: {
    StartGame: 'action.startGame',
    PlaceBid: 'action.placeBid',
    PassBid: 'action.passBid',
    ChooseAuction: 'action.chooseAuction',
    ChooseCowTrade: 'action.chooseCowTrade',
    SelectCowTarget: 'action.selectCowTarget',
    SelectCowAnimal: 'action.selectCowAnimal',
    CommitCowTrade: 'action.commitCowTrade',
    HostAward: 'action.hostAward',
    HostBuyback: 'action.hostBuyback'
  },
  State: {
    Update: 'state.update'
  },
  System: {
    Join: 'system.join',
    Leave: 'system.leave',
    HostChanged: 'system.hostChanged',
    RequestState: 'system.requestState'
  }
} as const;

type MsgAction = typeof Msg.Action[keyof typeof Msg.Action];
type MsgState = typeof Msg.State[keyof typeof Msg.State];
type MsgSystem = typeof Msg.System[keyof typeof Msg.System];

/** 所有合法訊息 type 的聯集 */
export type MsgType = MsgAction | MsgState | MsgSystem;

/**
 * PayloadByType：每個訊息 type 對應的 payload 型別。
 * 目標：讓 publish(type, payload) 在編譯期就能檢查 payload 正確。
 */
export type PayloadByType =
  // Action messages
  ({
    [K in MsgAction]: K extends typeof Msg.Action.StartGame
      ? { playerId: string }
      : K extends typeof Msg.Action.PlaceBid
      ? { playerId: string; moneyCardIds: string[] }
      : K extends typeof Msg.Action.PassBid
      ? { playerId: string }
      : K extends typeof Msg.Action.ChooseAuction
      ? { playerId: string }
      : K extends typeof Msg.Action.ChooseCowTrade
      ? { playerId: string }
      : K extends typeof Msg.Action.SelectCowTarget
      ? { playerId: string; targetId: string }
      : K extends typeof Msg.Action.SelectCowAnimal
      ? { playerId: string; animal: Animal }
      : K extends typeof Msg.Action.CommitCowTrade
      ? { playerId: string; moneyCardIds: string[] } // 僅 Host 可見
      : K extends typeof Msg.Action.HostAward
      ? { playerId: string }
      : K extends typeof Msg.Action.HostBuyback
      ? { playerId: string }
      : never;
  }) &
  // State messages
  ({
    [K in MsgState]: K extends typeof Msg.State.Update ? { state: GameState } : never;
  }) &
  // System messages
  ({
    [K in MsgSystem]:
      K extends typeof Msg.System.Join ? { playerId: string; name: string }
      : K extends typeof Msg.System.Leave ? { playerId: string }
      : K extends typeof Msg.System.HostChanged ? { newHostId: string }
      : K extends typeof Msg.System.RequestState ? { requesterId: string }
      : never;
  });

/** 通用封包外層 Envelope。預設泛型為 unknown（禁止 any）。 */
export interface Envelope<T = unknown> {
  type: MsgType;         // 訊息型別
  roomId: string;        // 房號
  senderId: string;      // = clientId = playerId
  actionId?: string;     // 僅 action.*
  stateVersion?: number; // 僅 state.update（單調遞增）
  ts: number;            // Host 接收/廣播時間（毫秒）
  payload: T;            // 內容（依 type）
  schemaVersion: number; // 協定版本（例：1）
}

/** 產生型別安全的 Envelope。支援 exactOptionalPropertyTypes：undefined 欄位不會被寫入。 */
export function makeEnvelope<T extends MsgType>(
  type: T,
  roomId: string,
  senderId: string,
  payload: PayloadByType[T],
  opts?: { actionId?: string; stateVersion?: number; ts?: number }
): Envelope<PayloadByType[T]> {
  const base = {
    type,
    roomId,
    senderId,
    ts: typeof opts?.ts === 'number' ? opts.ts : Date.now(),
    payload,
    schemaVersion: SCHEMA_VERSION
  };

  // 僅在有值時加入可選屬性，避免「鍵存在但值為 undefined」
  const withActionId =
    opts?.actionId !== undefined ? { actionId: opts.actionId } : ({} as const);
  const withStateVersion =
    opts?.stateVersion !== undefined ? { stateVersion: opts.stateVersion } : ({} as const);

  const env: Envelope<PayloadByType[T]> = {
    ...base,
    ...withActionId,
    ...withStateVersion
  };

  return env;
}

/** 型別工具：從訊息 type 取得對應 payload 型別。 */
export type PayloadOf<T extends MsgType> = PayloadByType[T];

/** 型別守衛：是否為 state.update 封包。 */
export function isStateUpdate(
  env: Envelope<unknown>
): env is Envelope<PayloadByType[typeof Msg.State.Update]> {
  return env.type === Msg.State.Update;
}

/**
 * 是否為「當前 Host 的有效快照」：
 *  - 僅接受 senderId === hostId 的 state.update
 *  - 版本比較請搭配 isNewerUpdate
 */
export function isHostStateUpdate(
  env: Envelope<unknown>,
  hostId: string | undefined
): env is Envelope<PayloadByType[typeof Msg.State.Update]> {
  return isStateUpdate(env) && typeof hostId === 'string' && env.senderId === hostId;
}

/** 版本比較：只有 incoming > current 才應套用。 */
export function isNewerUpdate(
  current: number | undefined,
  incoming: number | undefined
): boolean {
  if (typeof incoming !== 'number') return false;
  if (typeof current !== 'number') return true;
  return incoming > current;
}

/** 簡單協定版本檢查（可在接收封包時保守拒收不相容版本）。 */
export function assertSchemaCompatible(schemaVersion: number): void {
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Incompatible schema version: got=${schemaVersion}, expected=${SCHEMA_VERSION}`
    );
  }
}
