import type { Kingdom, PointId } from "../core/board";
import type { GameOptions, GameState } from "../core/game-state";

export type OnlineRoomPhase = "waiting" | "playing" | "finished";
export type OnlineRole = "player" | "spectator";

export interface OnlineParticipant {
  playerId: string;
  name: string;
  seat: Kingdom | null;
  role: OnlineRole;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
}

export interface OnlineRoomSnapshot {
  roomCode: string;
  phase: OnlineRoomPhase;
  gameState: GameState;
  players: OnlineParticipant[];
  spectators: OnlineParticipant[];
  seat: Kingdom | null;
  role: OnlineRole;
  options: GameOptions;
  reconnectExpiresAt: number | null;
}

export type ClientOnlineMessage =
  | {
      type: "createRoom";
      playerId: string;
      name?: string;
      options: GameOptions;
    }
  | {
      type: "joinRoom";
      roomCode: string;
      playerId: string;
      name?: string;
    }
  | {
      type: "leaveRoom";
      roomCode: string;
      playerId: string;
    }
  | {
      type: "forfeitRoom";
      roomCode: string;
      playerId: string;
    }
  | {
      type: "submitMove";
      roomCode: string;
      playerId: string;
      pieceId: string;
      target: PointId;
      clientMoveId: string;
    }
  | {
      type: "ping";
    };

export type ServerOnlineMessage =
  | {
      type: "roomJoined";
      snapshot: OnlineRoomSnapshot;
    }
  | {
      type: "roomState";
      snapshot: OnlineRoomSnapshot;
    }
  | {
      type: "moveAccepted";
      clientMoveId: string;
      snapshot: OnlineRoomSnapshot;
    }
  | {
      type: "moveRejected";
      clientMoveId: string;
      reason: string;
    }
  | {
      type: "playerList";
      players: OnlineParticipant[];
      spectators: OnlineParticipant[];
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "pong";
    };

export const onlineSeatOrder: readonly Kingdom[] = ["wei", "shu", "wu"];
