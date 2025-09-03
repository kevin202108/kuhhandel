// src/networking/protocol.ts
// Single Source of Truth for realtime protocol types & helpers.
// 禁用 any；必要處使用 unknown。

import type { Animal, GameState } from '@/types/game';

/* ---------------------------------- *
 *  Message type constants
 * ---------------------------------- */

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
  State: { Update: 'state.update' },
  System: {
    Join: 'system.join',
    Leave: 'system.leave',
    HostChanged: 'system.hostChanged',
    RequestState: 'system.requestState'
  }
} as const;

/* ---------------------------------- *
 *  Payload definitions (no any)
 * ---------------------------------- */

// Action payloads
export interface ActionPlaceBid       { playerId: string; moneyCardIds: string[]; }
export interface ActionPassBid        { playerId: string; }
export interface ActionChooseAuction  { playerId: string; }
export interface ActionChooseCowTrade { playerId: string; }
export interface ActionSelectCowTarget{ playerId: string; targetId: string; }
export interface ActionSelectCowAnimal{ playerId: string; animal: Animal; }
export interface ActionCommitCowTrade { playerId: string; moneyCardIds: string[]; }
export interface ActionHostAward      { playerId: string; }
export interface ActionHostBuyback    { playerId: string; }

// State payloads
export interface StateUpdate          { state: GameState; }

// System payloads
export interface SystemJoin           { playerId: string; name: string; }
export interface SystemLeave          { playerId: string; }
export interface SystemHostChanged    { newHostId: string; }
export interface SystemRequestState   { requesterId: string; }

/* ---------------------------------- *
 *  Payload mapping tables（用字面量鍵，避免 TS1170）
 * ---------------------------------- */

export type ActionPayloads = {
  'action.placeBid':        ActionPlaceBid;
  'action.passBid':         ActionPassBid;
  'action.chooseAuction':   ActionChooseAuction;
  'action.chooseCowTrade':  ActionChooseCowTrade;
  'action.selectCowTarget': ActionSelectCowTarget;
  'action.selectCowAnimal': ActionSelectCowAnimal;
  'action.commitCowTrade':  ActionCommitCowTrade;
  'action.hostAward':       ActionHostAward;
  'action.hostBuyback':     ActionHostBuyback;
};

export type StatePayloads = {
  'state.update':           StateUpdate;
};

export type SystemPayloads = {
  'system.join':            SystemJoin;
  'system.leave':           SystemLeave;
  'system.hostChanged':     SystemHostChanged;
  'system.requestState':    SystemRequestState;
};

export type PayloadByType = ActionPayloads & StatePayloads & SystemPayloads;

/* 衍生出各類型字面量聯集（供守門與輔助使用） */
export type ActionType = keyof ActionPayloads;
export type StateType  = keyof StatePayloads;
export type SystemType = keyof SystemPayloads;
export type MsgType    = keyof PayloadByType;

/* ---------------------------------- *
 *  Envelope (no any) + helpers
 * ---------------------------------- */

export const SCHEMA_VERSION = 1 as const;

/** 泛型邊界改成 keyof PayloadByType，避免 TS2536 */
export interface Envelope<T extends keyof PayloadByType> {
  type: T;
  roomId: string;
  senderId: string;           // playerId
  actionId?: string;          // 僅 action.*
  stateVersion?: number;      // 僅 state.update
  ts: number;                 // Host 接收/廣播時間（毫秒）
  payload: PayloadByType[T];
  schemaVersion: number;      // 例如 1
}

/**
 * 建立型別安全的封包。
 * options.actionId 僅用於 action.*；options.stateVersion 僅用於 state.update。
 */
export function envelope<T extends keyof PayloadByType>(
  type: T,
  roomId: string,
  senderId: string,
  payload: PayloadByType[T],
  options?: { actionId?: string; stateVersion?: number }
): Envelope<T> {
  return {
    type,
    roomId,
    senderId,
    actionId: options?.actionId,
    stateVersion: options?.stateVersion,
    ts: Date.now(),
    payload,
    schemaVersion: SCHEMA_VERSION
  };
}

/* ---------------------------------- *
 *  Type guards & small utilities
 * ---------------------------------- */

const actionValues = Object.values(Msg.Action) as readonly ActionType[];
const stateValues  = Object.values(Msg.State)  as readonly StateType[];
const systemValues = Object.values(Msg.System) as readonly SystemType[];

export function isActionType(t: MsgType): t is ActionType {
  return (actionValues as readonly string[]).includes(t as string);
}
export function isStateType(t: MsgType): t is StateType {
  return (stateValues as readonly string[]).includes(t as string);
}
export function isSystemType(t: MsgType): t is SystemType {
  return (systemValues as readonly string[]).includes(t as string);
}

/* ---------- EnvelopeBase 與嚴格守門，解 TS2352 ---------- */

interface EnvelopeBase {
  type: MsgType;
  roomId: string;
  senderId: string;
  actionId?: string;
  stateVersion?: number;
  ts: number;
  payload: unknown;
  schemaVersion: number;
}

function isEnvelopeBase(u: unknown): u is EnvelopeBase {
  if (typeof u !== 'object' || u === null) return false;
  const o = u as Record<string, unknown>;
  return (
    typeof o.type === 'string' &&
    typeof o.roomId === 'string' &&
    typeof o.senderId === 'string' &&
    typeof o.ts === 'number' &&
    typeof o.schemaVersion === 'number' &&
    Object.prototype.hasOwnProperty.call(o, 'payload')
  );
}

/**
 * 將未知值收斂為特定訊息型別的 Envelope（最小驗證）。
 * 若需更嚴格的 runtime 驗證，請在呼叫端使用 zod / io-ts。
 */
export function asEnvelope<T extends keyof PayloadByType>(
  u: unknown,
  type: T
): Envelope<T> | null {
  if (!isEnvelopeBase(u)) return null;
  if (u.type !== type) return null;
  // 先轉 unknown 再轉具體泛型，避免 TS2352
  return (u as unknown) as Envelope<T>;
}

/** 由訊息型別取得對應 payload 型別 */
export type ExtractPayload<T extends keyof PayloadByType> = PayloadByType[T];

/** 統一頻道命名工具 */
export function channelName(roomId: string): string {
  return `game-${roomId}`;
}
