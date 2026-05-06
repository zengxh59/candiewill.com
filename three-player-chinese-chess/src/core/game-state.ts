import type { Kingdom, PointId } from "./board";
import { createInitialPieces, type Piece } from "./pieces";

export const turnOrder: readonly Kingdom[] = ["wei", "shu", "wu"];
export type DefeatedPieceMode = "remove" | "block" | "takeover";
export type DefeatCondition = "checkmate" | "capture";

export interface GameOptions {
  defeatedPieceMode: DefeatedPieceMode;
  defeatCondition: DefeatCondition;
}

export interface MoveRecord {
  pieceId: string;
  kingdom: Kingdom;
  from: PointId;
  target: PointId;
  capturedPieceId: string | null;
}

export interface GameState {
  pieces: Piece[];
  selectedPieceId: string | null;
  legalMoves: PointId[];
  currentKingdom: Kingdom;
  checkedKingdoms: Kingdom[];
  winner: Kingdom | null;
  lastMoveMessage: string | null;
  defeatedKingdoms: Kingdom[];
  options: GameOptions;
  moveHistory?: MoveRecord[];
}

export function createInitialGameState(
  options: GameOptions = { defeatedPieceMode: "remove", defeatCondition: "capture" },
): GameState {
  return {
    pieces: createInitialPieces(),
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom: "wei",
    checkedKingdoms: [],
    winner: null,
    lastMoveMessage: null,
    defeatedKingdoms: [],
    options,
    moveHistory: [],
  };
}

export function pieceAt(state: GameState, point: PointId): Piece | null {
  return state.pieces.find((piece) => piece.position === point && piece.blocksMovement) ?? null;
}

export function updatePiecePosition(state: GameState, pieceId: string, target: PointId): GameState {
  return {
    ...state,
    pieces: state.pieces
      .filter((piece) => piece.id === pieceId || piece.position !== target)
      .map((piece) => {
        if (piece.id !== pieceId) {
          return piece;
        }

        return {
          ...piece,
          position: target,
        };
      }),
  };
}

export function capturedPieceAt(state: GameState, pieceId: string, target: PointId): Piece | null {
  return state.pieces.find((piece) => piece.id !== pieceId && piece.position === target && piece.blocksMovement) ?? null;
}

export function nextKingdom(current: Kingdom): Kingdom {
  const index = turnOrder.indexOf(current);

  return turnOrder[(index + 1) % turnOrder.length];
}

export function nextActiveKingdom(current: Kingdom, defeatedKingdoms: readonly Kingdom[]): Kingdom {
  let next = nextKingdom(current);

  while (defeatedKingdoms.includes(next)) {
    next = nextKingdom(next);
  }

  return next;
}
