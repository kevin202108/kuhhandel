// src/networking/protocol.ts
// 唯一真相來源（SSOT）：依據 Master README（完整版）

import type { GameState, Animal } from '@/types/game';

/** 協定 schema 版本（Host/Client 用來判斷是否需要清檔或做相容處理） */
export const SCHEMA_VERSION = 1 as const;

/** 訊息 type 常數（避免手滑字串） */
export const Msg = {
  Action: {
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

export type ActionMsgType = typeof Msg.Action[keyof typeof Msg.Action];
export type StateMsgType = typeof Msg.State[keyof typeof Msg.State];
export type SystemMsgType = typeof Msg.System[keyof typeof Msg.System];
export type MsgType = ActionMsgType | StateMsgType | SystemMsgType;

/* -------------------------- Payload 型別定義 -------------------------- */
export interface ActionPlaceBid { playerId: string; moneyCardIds: string[]; }
export interface ActionPassBid { playerId: string; }
export interface ActionChooseAuction { playerId: string; }
export interface ActionChooseCowTrade { playerId: string; }
export interface ActionSelectCowTarget { playerId: string; targetId: string; }
export interface ActionSelectCowAnimal { playerId: string; animal: Animal; }
export interface ActionCommitCowTrade { playerId: string; moneyCardIds: string[]; }
export interface ActionHostAward { playerId: string; }
export interface ActionHostBuyback { playerId: string; }

export interface StateUpdate { state: GameState; }

export interface SystemJoin { playerId: string; name: string; }
export interface SystemLeave { playerId: string; }
export interface SystemHostChanged { newHostId: string; }
export interface SystemRequestState { requesterId: string; }

/* ------------------- 訊息型別 → Payload 型別對映（嚴格） ------------------- */
export type PayloadByType =
  // Actions
  {
    [K in typeof Msg.Action.PlaceBid]: ActionPlaceBid;
  } & {
    [K in typeof Msg.Action.PassBid]: ActionPassBid;
  } & {
    [K in typeof Msg.Action.ChooseAuction]: ActionChooseAuction;
  } & {
    [K in typeof Msg.Action.ChooseCowTrade]: ActionChooseCowTrade;
  } & {
    [K in typeof Msg.Action.SelectCowTarget]: ActionSelectCowTarget;
  } & {
    [K in typeof Msg.Action.SelectCowAnimal]: ActionSelectCowAnimal;
  } & {
    [K in typeof Msg.Action.CommitCowTrade]: ActionCommitCowTrade;
  } & {
    [K in typeof Msg.Action.HostAward]: ActionHostAward;
  } & {
    [K in typeof Msg.Action.HostBuyback]: ActionHostBuyback;
  } &
  // State
  {
    [K in typeof Msg.State.Update]: StateUpdate;
  } &
  // System
  {
    [K in typeof Msg.System.Join]: SystemJoin;
  } & {
    [K in typeof Msg.System.Leave]: SystemLeave;
  } & {
    [K in typeof Msg.System.HostChanged]: SystemHostChanged;
  } & {
    [K in typeof Msg.System.RequestState]: SystemRequestState;
  };

/* ------------------------------ Envelope ------------------------------ */
export type Envelope<T extends MsgType = MsgType> = {
  type: T;
  roomId: string;
  senderId: string;
  /** 僅 action.* 帶入，用於 Host 去重 */
  actionId?: string;
  /** 僅 state.update 帶入（Host 每次更新 +1） */
  stateVersion?: number;
  /** Host 接收/廣播時間（毫秒）；同價競標以此先到先贏 */
  ts: number;
  /** 依照 type 定義之資料 */
  payload: PayloadByType[T];
  /** 協定版本（SCHEMA_VERSION） */
  schemaVersion: typeof SCHEMA_VERSION;
};

/** 跨所有訊息的 Envelope 類型 */
export type AnyEnvelope = Envelope<MsgType>;

/* --------------------------------- 工具 --------------------------------- */

/** 產生 Envelope（會自動填入 ts 與 schemaVersion） */
export function makeEnvelope<T extends MsgType>(args: {
  type: T;
  roomId: string;
  senderId: string;
  payload: PayloadByType[T];
  actionId?: string;
  stateVersion?: number;
  ts?: number; // 預設 Date.now()
}): Envelope<T> {
  const { type, roomId, senderId, payload, actionId, stateVersion } = args;
  const ts = args.ts ?? Date.now();
  return {
    type,
    roomId,
    senderId,
    payload,
    actionId,
    stateVersion,
    ts,
    schemaVersion: SCHEMA_VERSION
  };
}

/** 簡易 Envelope 形狀檢查（執行期） */
export function isEnvelope(x: unknown): x is AnyEnvelope {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.type === 'string' &&
    typeof o.roomId === 'string' &&
    typeof o.senderId === 'string' &&
    typeof o.ts === 'number' &&
    typeof o.schemaVersion === 'number'
  );
}

/** Schema 相容檢查（目前採嚴格相等） */
export function isCompatibleSchema(e: { schemaVersion: number }): boolean {
  return e.schemaVersion === SCHEMA_VERSION;
}

/** 是否 action.* 類型 */
export function isActionType(t: MsgType): t is ActionMsgType {
  return (t as string).startsWith('action.');
}
/** 是否 state.* 類型 */
export function isStateType(t: MsgType): t is StateMsgType {
  return (t as string).startsWith('state.');
}
/** 是否 system.* 類型 */
export function isSystemType(t: MsgType): t is SystemMsgType {
  return (t as string).startsWith('system.');
}

/** Envelope 是否為特定 type（提供類型縮小） */
export function isOfType<T extends MsgType>(
  env: AnyEnvelope,
  type: T
): env is Extract<AnyEnvelope, { type: T }> {
  return env.type === type;
}

/** 頻道命名規則：game-{roomId} */
export function channelName(roomId: string): string {
  return `game-${roomId}`;
}
