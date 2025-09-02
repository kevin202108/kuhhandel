// src/networking/protocol.ts
// Multiplayer Auction Game — wire protocol (Host Authority, Ably-friendly)
// This file is the single source of truth for on-the-wire message shapes.

import type { Animal, GameState } from "../types/game";

/* ------------------------------------------------------------------ */
/* Schema versioning                                                   */
/* ------------------------------------------------------------------ */

/** Increment when any wire shape changes. */
export const SCHEMA_VERSION = 1 as const;

/**
 * If you introduce breaking changes, optionally raise this to require clients
 * to be at least this version to accept messages.
 */
export const MIN_COMPATIBLE_SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/* Channel naming                                                      */
/* ------------------------------------------------------------------ */

export const channelName = (roomId: string) => `game-${roomId}`;

/* ------------------------------------------------------------------ */
/* Envelope                                                           */
/* ------------------------------------------------------------------ */

/**
 * Generic wire envelope. All messages MUST use this wrapper.
 * - `type` is a dotted string discriminator (e.g. "action.placeBid").
 * - `actionId` is REQUIRED for action.* (idempotency / de-dup).
 * - `stateVersion` is REQUIRED for state.update and must match payload.state.stateVersion.
 */
export interface Envelope<T = unknown> {
  type: EnvelopeType;
  roomId: string;
  senderId: string; // playerId
  ts: number; // epoch ms; Host uses receive time for ordering
  schemaVersion: number; // equals SCHEMA_VERSION at emission time
  payload: T;
  actionId?: string; // present iff type starts with "action."
  stateVersion?: number; // present iff type === "state.update"
}

/* ------------------------------------------------------------------ */
/* Action payloads (Client → Host)                                    */
/* ------------------------------------------------------------------ */

export type ActionPlaceBid = {
  playerId: string;
  moneyCardIds: string[]; // must belong to player; non-empty; validated by Host
};

export type ActionPassBid = {
  playerId: string;
};

export type ActionChooseAuction = {
  playerId: string;
};

export type ActionChooseCowTrade = {
  playerId: string;
};

export type ActionSelectCowTarget = {
  playerId: string;
  targetId: string; // must be another player that has >=1 animal card
};

export type ActionSelectCowAnimal = {
  playerId: string;
  animal: Animal; // must be owned by target & not locked
};

/**
 * Secret commit sent ONLY to Host.
 * Hosts MUST NOT rebroadcast the raw moneyCardIds; only reveal results in state.update.
 */
export type ActionCommitCowTrade = {
  playerId: string; // initiator or target (each sends their own)
  moneyCardIds: string[]; // selection snapshot; may be 0 if rules allow (current rules: > 0)
};

export type ActionHostAward = {
  playerId: string; // must be auctioneer (Host validates)
};

export type ActionHostBuyback = {
  playerId: string; // must be auctioneer and able to afford buyback
};

export type ActionPayload =
  | ActionPlaceBid
  | ActionPassBid
  | ActionChooseAuction
  | ActionChooseCowTrade
  | ActionSelectCowTarget
  | ActionSelectCowAnimal
  | ActionCommitCowTrade
  | ActionHostAward
  | ActionHostBuyback;

/** String discriminators for action envelopes. Keep in sync with ActionPayload union above. */
export type ActionType =
  | "action.placeBid"
  | "action.passBid"
  | "action.chooseAuction"
  | "action.chooseCowTrade"
  | "action.selectCowTarget"
  | "action.selectCowAnimal"
  | "action.commitCowTrade"
  | "action.hostAward"
  | "action.hostBuyback";

/* ------------------------------------------------------------------ */
/* State payloads (Host → All)                                        */
/* ------------------------------------------------------------------ */

export type StateUpdate = {
  state: GameState; // state.stateVersion must increment monotonically on Host
};

export type StateType = "state.update";

/* ------------------------------------------------------------------ */
/* System / presence (bidirectional)                                  */
/* ------------------------------------------------------------------ */

export type SystemJoin = { playerId: string; name: string };
export type SystemLeave = { playerId: string };
export type SystemHostChanged = { newHostId: string };
export type SystemRequestState = { requesterId: string }; // optional request → Host replies with state.update

export type SystemPayload =
  | SystemJoin
  | SystemLeave
  | SystemHostChanged
  | SystemRequestState;

export type SystemType =
  | "system.join"
  | "system.leave"
  | "system.hostChanged"
  | "system.requestState";

/* ------------------------------------------------------------------ */
/* Discriminated unions for envelopes                                  */
/* ------------------------------------------------------------------ */

export type EnvelopeType = ActionType | StateType | SystemType;

export type ActionEnvelope<T extends ActionPayload = ActionPayload> = Envelope<T> & {
  type: ActionType;
  actionId: string; // required here
};

export type StateEnvelope = Envelope<StateUpdate> & {
  type: StateType; // "state.update"
  stateVersion: number; // required here; mirrors payload.state.stateVersion
};

export type SystemEnvelope<T extends SystemPayload = SystemPayload> = Envelope<T> & {
  type: SystemType;
};

export type AnyOutboundEnvelope = ActionEnvelope | StateEnvelope | SystemEnvelope;

/* ------------------------------------------------------------------ */
/* Builders (strict helpers to create valid envelopes)                 */
/* ------------------------------------------------------------------ */

const now = () => Date.now();

/**
 * Build an action envelope.
 * Enforces presence of actionId and stamps schemaVersion & ts.
 */
export function makeActionEnvelope<T extends ActionPayload>(
  type: ActionType,
  roomId: string,
  senderId: string,
  actionId: string,
  payload: T,
  ts: number = now()
): ActionEnvelope<T> {
  return {
    type,
    roomId,
    senderId,
    actionId,
    payload,
    ts,
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Build a state.update envelope from a GameState snapshot.
 * Automatically mirrors state.stateVersion into envelope.stateVersion.
 */
export function makeStateUpdateEnvelope(
  roomId: string,
  senderId: string, // Host id
  state: GameState,
  ts: number = now()
): StateEnvelope {
  return {
    type: "state.update",
    roomId,
    senderId,
    payload: { state },
    stateVersion: state.stateVersion,
    ts,
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Build a system envelope.
 */
export function makeSystemEnvelope<T extends SystemPayload>(
  type: SystemType,
  roomId: string,
  senderId: string,
  payload: T,
  ts: number = now()
): SystemEnvelope<T> {
  return {
    type,
    roomId,
    senderId,
    payload,
    ts,
    schemaVersion: SCHEMA_VERSION,
  };
}

/* ------------------------------------------------------------------ */
/* Type guards                                                         */
/* ------------------------------------------------------------------ */

export function isActionEnvelope(env: Envelope): env is ActionEnvelope {
  return env.type.startsWith("action.") && typeof env.actionId === "string";
}

export function isStateEnvelope(env: Envelope): env is StateEnvelope {
  return env.type === "state.update" && typeof env.stateVersion === "number";
}

export function isSystemEnvelope(env: Envelope): env is SystemEnvelope {
  return env.type.startsWith("system.");
}

/* ------------------------------------------------------------------ */
/* Idempotency / de-dup helpers                                        */
/* ------------------------------------------------------------------ */

/** Unique key suitable for an LRU set to drop duplicate action replays. */
export function getActionDedupKey(env: ActionEnvelope): string {
  return `${env.roomId}:${env.actionId}`;
}

/* ------------------------------------------------------------------ */
/* Compatibility checks                                                */
/* ------------------------------------------------------------------ */

/**
 * Returns true if the incoming envelope claims a schemaVersion compatible
 * with this client/runtime.
 */
export function isSchemaCompatible(schemaVersion: number): boolean {
  return schemaVersion >= MIN_COMPATIBLE_SCHEMA_VERSION && schemaVersion <= SCHEMA_VERSION;
}

/* ------------------------------------------------------------------ */
/* Minimal runtime validation (optional strict checks)                 */
/* ------------------------------------------------------------------ */

/**
 * Lightweight runtime sanity checks. This is intentionally shallow to avoid
 * bringing a schema library; Host SHOULD perform full validation at the edge.
 */
export function validateEnvelopeShape(env: Envelope): { ok: true } | { ok: false; reason: string } {
  if (!env || typeof env !== "object") return { ok: false, reason: "not-an-object" };
  if (typeof env.type !== "string") return { ok: false, reason: "missing-type" };
  if (typeof env.roomId !== "string") return { ok: false, reason: "missing-roomId" };
  if (typeof env.senderId !== "string") return { ok: false, reason: "missing-senderId" };
  if (typeof env.ts !== "number") return { ok: false, reason: "missing-ts" };
  if (typeof env.schemaVersion !== "number") return { ok: false, reason: "missing-schemaVersion" };

  if (isActionEnvelope(env)) {
    if (!env.actionId) return { ok: false, reason: "action-missing-actionId" };
  } else if (isStateEnvelope(env)) {
    const pv = (env.payload as StateUpdate)?.state?.stateVersion;
    if (env.stateVersion !== pv) {
      return { ok: false, reason: "stateVersion-mismatch" };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Topics (optional)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Suggested topic names if you decide to multiplex by topic within the channel.
 * Not required by Ably, but handy if you add local bus testing.
 */
export const Topics = {
  Actions: "actions",
  State: "state",
  System: "system",
} as const;
export type Topic = (typeof Topics)[keyof typeof Topics];

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

/** Narrow type helper: ensures exhaustive checks on envelope.type in switches. */
export function assertNever(x: never, msg = "unexpected variant"): never {
  throw new Error(`${msg}: ${String(x)}`);
}
