// src/networking/protocol.ts
import type { Animal, GameState } from '@/types/game';

/**
 * 訊息常數（避免手滑字串）
 * Phase 2 實際會用到：StartGame / ChooseAuction / PlaceBid / PassBid / HostAward
 * 以及 State.Update、System.*(Join/RequestState/HostChanged)。
 * 其餘事件為後續相容預留（例如 Phase 3/4）。
 */
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
    HostBuyback: 'action.hostBuyback',
    ConfirmBuyback: 'action.confirmBuyback',
    CancelBuyback: 'action.cancelBuyback'
  },
  State: { Update: 'state.update' },
  System: {
    Join: 'system.join',
    Leave: 'system.leave',
    HostChanged: 'system.hostChanged',
    RequestState: 'system.requestState'
  }
} as const;

export type MsgType =
  | (typeof Msg.Action)[keyof typeof Msg.Action]
  | (typeof Msg.State)[keyof typeof Msg.State]
  | (typeof Msg.System)[keyof typeof Msg.System];

/**
 * 各訊息型別對應的 Payload 形狀
 * （不得使用 any；未知時請用 unknown。）
 */
export interface PayloadByType {
  // Action.*
  [Msg.Action.StartGame]: { playerId: string };
  [Msg.Action.PlaceBid]: { playerId: string; moneyCardIds: string[] };
  [Msg.Action.PassBid]: { playerId: string };
  [Msg.Action.ChooseAuction]: { playerId: string };
  [Msg.Action.ChooseCowTrade]: { playerId: string };
  [Msg.Action.SelectCowTarget]: { playerId: string; targetId: string };
  [Msg.Action.SelectCowAnimal]: { playerId: string; animal: Animal };
  // Host-only（只給 Host，看 README 說明；Phase 4 才用）
  [Msg.Action.CommitCowTrade]: { playerId: string; moneyCardIds: string[] };
  [Msg.Action.HostAward]: { playerId: string };
  [Msg.Action.HostBuyback]: { playerId: string };
  [Msg.Action.ConfirmBuyback]: { playerId: string; moneyCardIds: string[] };
  [Msg.Action.CancelBuyback]: { playerId: string };

  // State.*
  [Msg.State.Update]: { state: GameState };

  // System.*
  [Msg.System.Join]: { playerId: string; name: string };
  [Msg.System.Leave]: { playerId: string };
  [Msg.System.HostChanged]: { newHostId: string };
  [Msg.System.RequestState]: { requesterId: string };
}

/**
 * Envelope：網路層通用封包
 * - senderId 必等於 clientId ≡ playerId（Identity Contract）
 * - actionId 僅用於 action.*（Host 去重）
 * - stateVersion 僅用於 state.update（單調遞增）
 * - ts：Host 接收/廣播時間（毫秒；稽核用）
 * - schemaVersion：例如 1
 */
export interface Envelope<T = unknown> {
  type: MsgType;
  roomId: string;
  senderId: string;       // = clientId = playerId
  actionId?: string;      // 僅 action.*
  stateVersion?: number;  // 僅 state.update
  ts: number;             // Host 接收/廣播時間（毫秒）
  payload: T;
  schemaVersion: number;  // 例如 1
}

/**
 * 建立封包的工廠函式（與 README 範例一致）
 */
export function makeEnvelope<T extends MsgType>(
  type: T,
  roomId: string,
  senderId: string,
  payload: PayloadByType[T],
  opts?: { actionId?: string; stateVersion?: number }
): Envelope<PayloadByType[T]> {
  return {
    type,
    roomId,
    senderId,
    actionId: opts?.actionId,
    stateVersion: opts?.stateVersion,
    ts: Date.now(),
    payload,
    schemaVersion: 1
  };
}
