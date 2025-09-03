// src/networking/protocol.ts
// Single Source of Truth for networking message types, envelopes and helpers.

import type { Animal, GameState } from '@/types/game';

//
// ──────────────────────────────────────────────────────────────────────────────
//  Message Constants
// ──────────────────────────────────────────────────────────────────────────────
//

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

//
// ──────────────────────────────────────────────────────────────────────────────
//  Payloads
// ──────────────────────────────────────────────────────────────────────────────
//

// Actions (Client → Host)
export interface ActionPlaceBid {
  playerId: string;
  moneyCardIds: string[];
}
export interface ActionPassBid {
  playerId: string;
}
export interface ActionChooseAuction {
  playerId: string;
}
export interface ActionChooseCowTrade {
  playerId: string;
}
export interface ActionSelectCowTarget {
  playerId: string;
  targetId: string;
}
export interface ActionSelectCowAnimal {
  playerId: string;
  animal: Animal;
}
export interface ActionCommitCowTrade {
  playerId: string;
  moneyCardIds: string[]; // secret, Host-only
}
export interface ActionHostAward {
  playerId: string; // host
}
export interface ActionHostBuyback {
  playerId: string; // host
}

// State (Host → All)
export interface StateUpdate {
  state: GameState; // full snapshot with stateVersion
}

// System / Presence
export interface SystemJoin {
  playerId: string;
  name: string;
}
export interface SystemLeave {
  playerId: string;
}
export interface SystemHostChanged {
  newHostId: string;
}
export interface SystemRequestState {
  requesterId: string;
}

// Mapping from message type → payload type
export type MsgPayloadMap = {
  // Actions
  'action.placeBid': ActionPlaceBid;
  'action.passBid': ActionPassBid;
  'action.chooseAuction': ActionChooseAuction;
  'action.chooseCowTrade': ActionChooseCowTrade;
  'action.selectCowTarget': ActionSelectCowTarget;
  'action.selectCowAnimal': ActionSelectCowAnimal;
  'action.commitCowTrade': ActionCommitCowTrade;
  'action.hostAward': ActionHostAward;
  'action.hostBuyback': ActionHostBuyback;

  // State
  'state.update': StateUpdate;

  // System
  'system.join': SystemJoin;
  'system.leave': SystemLeave;
  'system.hostChanged': SystemHostChanged;
  'system.requestState': SystemRequestState;
};

export type PayloadOf<T extends MsgType> = T extends keyof MsgPayloadMap
  ? MsgPayloadMap[T]
  : never;

//
// ──────────────────────────────────────────────────────────────────────────────
//  Envelope
// ──────────────────────────────────────────────────────────────────────────────
//

export const SCHEMA_VERSION = 1 as const;

/**
 * Generic, strictly-typed Envelope that carries a payload matching its `type`.
 * Notes:
 * - `actionId` must be present for Action messages (see helper overloads below).
 * - `stateVersion` should be present for State.Update messages (host snapshot).
 */
export type Envelope<TType extends MsgType> = {
  type: TType;
  roomId: string;
  senderId: string; // playerId
  actionId?: string; // required for action.*
  stateVersion?: number; // required for state.update
  ts: number; // host receive/broadcast time (ms)
  payload: PayloadOf<TType>;
  schemaVersion: number; // e.g., 1
};

// A convenient alias for "any valid envelope" without using `any`.
export type AnyEnvelope = Envelope<MsgType>;

//
// ──────────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────────
//

/** Build the channel name used for this room. */
export function makeChannelName(roomId: string): string {
  return `game-${roomId}`;
}

/** Type guards for message categories. */
export function isActionType(t: string): t is ActionMsgType {
  return t.startsWith('action.');
}
export function isSystemType(t: string): t is SystemMsgType {
  return t.startsWith('system.');
}
export function isStateType(t: string): t is StateMsgType {
  return t === Msg.State.Update;
}

/** Type guard for narrowing an envelope to a specific message type. */
export function isEnvelopeOfType<TType extends MsgType>(
  env: AnyEnvelope,
  type: TType
): env is Envelope<TType> {
  return env.type === type;
}

//
// ──────────────────────────────────────────────────────────────────────────────
//  Envelope Factory (with overloads enforcing required fields)
// ──────────────────────────────────────────────────────────────────────────────
//

type BaseCreateArgs<TType extends MsgType> = {
  type: TType;
  roomId: string;
  senderId: string;
  payload: PayloadOf<TType>;
  ts?: number;
  schemaVersion?: number;
};

// Overload 1: Action messages require actionId
export function createEnvelope<TType extends ActionMsgType>(
  args: BaseCreateArgs<TType> & { actionId: string; stateVersion?: undefined }
): Envelope<TType>;

// Overload 2: State update requires stateVersion (actionId forbidden)
export function createEnvelope<TType extends StateMsgType>(
  args: BaseCreateArgs<TType> & { stateVersion: number; actionId?: undefined }
): Envelope<TType>;

// Overload 3: System messages require neither actionId nor stateVersion
export function createEnvelope<TType extends SystemMsgType>(
  args: BaseCreateArgs<TType> & { actionId?: undefined; stateVersion?: undefined }
): Envelope<TType>;

// Implementation
export function createEnvelope<TType extends MsgType>(
  args: BaseCreateArgs<TType> & { actionId?: string; stateVersion?: number }
): Envelope<TType> {
  const { type, roomId, senderId, payload } = args;
  const schemaVersion = args.schemaVersion ?? SCHEMA_VERSION;
  const ts = args.ts ?? Date.now();

  // Runtime asserts (dev-safety). These are soft checks; they don't alter types.
  if (isActionType(type)) {
    if (!args.actionId) {
      throw new Error(`createEnvelope: actionId is required for ${type}`);
    }
  } else if (isStateType(type)) {
    if (typeof args.stateVersion !== 'number') {
      throw new Error('createEnvelope: stateVersion is required for state.update');
    }
  }

  return {
    type,
    roomId,
    senderId,
    actionId: args.actionId,
    stateVersion: args.stateVersion,
    ts,
    payload,
    schemaVersion
  };
}
