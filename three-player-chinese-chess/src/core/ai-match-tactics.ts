import type { Kingdom } from "./board";
import { capturedPieceAt, type GameState } from "./game-state";
import { getLegalMoves } from "./moves";
import type { AiProfile } from "./ai-profile";
import type { Piece } from "./pieces";
import type { AiMove } from "./ai";

/** 与 ai-lab 一致的战术启发，用于对弈报告中的「明显坏棋」统计 */
export function tacticalBaselineFor(
  state: GameState,
  kingdom: Kingdom,
  profile: AiProfile,
): {
  hasProfitableCapture: boolean;
  hangingPieceId: string | null;
} {
  const actions = state.pieces
    .filter((piece) => piece.controller === kingdom && piece.blocksMovement && !piece.defeated)
    .flatMap((piece) => {
      return getLegalMoves(state, piece).map((target) => ({ pieceId: piece.id, from: piece.position, target }));
    });

  const hasProfitableCapture = actions.some((action) => {
    const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
    const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

    return Boolean(
      movingPiece &&
        capturedPiece &&
        !capturedPiece.defeated &&
        (capturedPiece.type === "general" ||
          pieceValueLocal(capturedPiece, profile) >= pieceValueLocal(movingPiece, profile) * 0.55),
    );
  });

  const hangingPiece = state.pieces
    .filter((piece) => piece.controller === kingdom && piece.blocksMovement && !piece.defeated)
    .filter((piece) => piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse")
    .find((piece) => isSeriouslyHanging(state, piece, kingdom, profile));

  return {
    hasProfitableCapture,
    hangingPieceId: hangingPiece?.id ?? null,
  };
}

export function isObviousBadMove(
  state: GameState,
  kingdom: Kingdom,
  move: AiMove,
  profile: AiProfile,
  ply: number,
): boolean {
  const baseline = tacticalBaselineFor(state, kingdom, profile);
  const captured = capturedPieceAt(state, move.pieceId, move.target);

  if (baseline.hasProfitableCapture && !captured) {
    return true;
  }

  if (
    ply >= 12 &&
    baseline.hangingPieceId &&
    move.pieceId !== baseline.hangingPieceId &&
    !capturesThreateningPiece(state, move, baseline.hangingPieceId)
  ) {
    return true;
  }

  return false;
}

function capturesThreateningPiece(state: GameState, move: AiMove, hangingPieceId: string): boolean {
  const hangingPiece = state.pieces.find((piece) => piece.id === hangingPieceId);
  const capturedPiece = capturedPieceAt(state, move.pieceId, move.target);

  return Boolean(hangingPiece && capturedPiece && getLegalMoves(state, capturedPiece).includes(hangingPiece.position));
}

function isSeriouslyHanging(state: GameState, piece: Piece, kingdom: Kingdom, profile: AiProfile): boolean {
  const attackers = state.pieces.filter((candidate) => {
    return (
      candidate.controller !== kingdom &&
      candidate.blocksMovement &&
      !candidate.defeated &&
      getLegalMoves(state, candidate).includes(piece.position)
    );
  });

  if (!attackers.length) {
    return false;
  }

  const defenders = state.pieces.filter((candidate) => {
    return (
      candidate.controller === kingdom &&
      candidate.id !== piece.id &&
      candidate.blocksMovement &&
      !candidate.defeated &&
      getLegalMoves(state, candidate).includes(piece.position)
    );
  });

  return defenders.length === 0 || Math.min(...attackers.map((a) => pieceValueLocal(a, profile))) < pieceValueLocal(piece, profile) - 220;
}

function pieceValueLocal(piece: Piece, profile: AiProfile): number {
  return profile.pieceValues[piece.type];
}
