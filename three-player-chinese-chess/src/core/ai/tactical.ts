import type { Kingdom, PointId } from "../board";
import { kingdomRows, parsePointId } from "../board";
import { capturedPieceAt, type GameState } from "../game-state";
import { getPseudoLegalMoves, isSquareAttackedBy } from "../moves";
import type { Piece } from "../pieces";
import type { AiProfile } from "../ai-profile";
import { applyMove } from "../rules";

import { pieceValue, isNeutralBlocker } from "./evaluate";

export const profitableCaptureMargin = 120;
export const hangingPieceMargin = 220;

const allRows = Object.values(kingdomRows).flat();
const rowIndexByLabel = new Map<string, number>(allRows.map((row, index) => [row, index]));

export function applySearchMove(state: GameState, pieceId: string, target: PointId): GameState {
  const nextState = applyMove(state, pieceId, target);

  return {
    ...nextState,
    moveHistory: state.moveHistory,
  };
}

export function isPointControlledByOpponent(state: GameState, point: PointId, kingdom: Kingdom): boolean {
  return isSquareAttackedBy(state, point, kingdom);
}

export function isInsideOwnPalace(kingdom: Kingdom, point: PointId): boolean {
  const rows = kingdomRows[kingdom] as readonly string[];
  const palaceRows = rows.slice(2);
  const { row, col } = parsePointId(point);

  return palaceRows.includes(row) && col >= 4 && col <= 6;
}

export function isKingDefenseCapture(state: GameState, action: { pieceId: string; target: PointId }, kingdom: Kingdom): boolean {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

  if (!movingPiece || movingPiece.type !== "general" || !capturedPiece || isNeutralBlocker(capturedPiece)) {
    return false;
  }

  return isInsideOwnPalace(kingdom, action.target) || getPseudoLegalMoves(state, capturedPiece).includes(movingPiece.position);
}

export function givesDirectCheck(state: GameState, action: { pieceId: string; target: PointId }, kingdom: Kingdom): boolean {
  const nextState = applySearchMove(state, action.pieceId, action.target);

  return nextState.checkedKingdoms.some((checkedKingdom) => checkedKingdom !== kingdom);
}

export function attackersOf(state: GameState, point: PointId, ownKingdom: Kingdom): Piece[] {
  return state.pieces.filter((piece) => {
    return piece.controller !== ownKingdom && piece.blocksMovement && !isNeutralBlocker(piece) && getPseudoLegalMoves(state, piece).includes(point);
  });
}

export function defendersOf(state: GameState, point: PointId, ownKingdom: Kingdom, excludedPieceId?: string): Piece[] {
  return state.pieces.filter((piece) => {
    return (
      piece.controller === ownKingdom &&
      piece.id !== excludedPieceId &&
      piece.blocksMovement &&
      !isNeutralBlocker(piece) &&
      getPseudoLegalMoves(state, piece).includes(point)
    );
  });
}

export function cheapestPieceValue(pieces: Piece[], profile: AiProfile): number {
  return Math.min(...pieces.map((piece) => pieceValue(piece, profile)));
}

export function isPieceHanging(state: GameState, piece: Piece, profile: AiProfile): boolean {
  if (!piece.blocksMovement || isNeutralBlocker(piece)) {
    return false;
  }

  const attackers = attackersOf(state, piece.position, piece.controller);

  if (!attackers.length) {
    return false;
  }

  const defenders = defendersOf(state, piece.position, piece.controller, piece.id);
  const value = pieceValue(piece, profile);

  return defenders.length === 0 || cheapestPieceValue(attackers, profile) <= value - hangingPieceMargin;
}

export function staticExchangeScore(state: GameState, action: { pieceId: string; target: PointId }, kingdom: Kingdom, profile: AiProfile): number {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

  if (!movingPiece || !capturedPiece || isNeutralBlocker(capturedPiece)) {
    return 0;
  }

  if (capturedPiece.type === "general") {
    return profile.scoring.generalCaptureBonus;
  }

  const capturedValue = pieceValue(capturedPiece, profile);
  const movingValue = pieceValue(movingPiece, profile);
  const nextState = applySearchMove(state, action.pieceId, action.target);
  const attackers = attackersOf(nextState, action.target, kingdom);

  if (!attackers.length) {
    return capturedValue;
  }

  const defenders = defendersOf(nextState, action.target, kingdom, movingPiece.id);
  const recaptureCost = Math.min(movingValue, cheapestPieceValue(attackers, profile));
  const defenderCompensation = defenders.length ? Math.min(movingValue * 0.45, cheapestPieceValue(defenders, profile) * 0.35) : 0;

  return capturedValue - recaptureCost + defenderCompensation;
}

export function isProfitableCapture(state: GameState, action: { pieceId: string; target: PointId }, kingdom: Kingdom, profile: AiProfile): boolean {
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

  if (!capturedPiece || isNeutralBlocker(capturedPiece)) {
    return false;
  }

  if (capturedPiece.type === "general") {
    return true;
  }

  return staticExchangeScore(state, action, kingdom, profile) >= profitableCaptureMargin;
}

export function addressesHangingPiece(state: GameState, action: { pieceId: string; target: PointId }, kingdom: Kingdom, profile: AiProfile): boolean {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

  if (!movingPiece) {
    return false;
  }

  if (isPieceHanging(state, movingPiece, profile)) {
    const nextState = applySearchMove(state, action.pieceId, action.target);
    const movedPiece = nextState.pieces.find((piece) => piece.id === action.pieceId);

    return Boolean(movedPiece && !isPieceHanging(nextState, movedPiece, profile));
  }

  if (!capturedPiece || isNeutralBlocker(capturedPiece)) {
    return false;
  }

  return state.pieces.some((piece) => {
    return (
      piece.controller === kingdom &&
      piece.blocksMovement &&
      pieceValue(piece, profile) >= profile.pieceValues.horse &&
      getPseudoLegalMoves(state, capturedPiece).includes(piece.position)
    );
  });
}

export function generalFor(state: GameState, kingdom: Kingdom): Piece | null {
  return state.pieces.find((piece) => piece.kingdom === kingdom && piece.type === "general" && piece.blocksMovement) ?? null;
}

export function nearestOpponentGeneralDistance(state: GameState, point: PointId, kingdom: Kingdom): number {
  const { row, col } = parsePointId(point);
  const rowIndex = rowIndexByLabel.get(row) ?? 0;
  const distances = (Object.keys(kingdomRows) as Kingdom[])
    .filter((opponent) => opponent !== kingdom && !state.defeatedKingdoms.includes(opponent))
    .map((opponent) => generalFor(state, opponent))
    .filter(Boolean)
    .map((general) => {
      const target = parsePointId(general!.position);
      const targetRowIndex = rowIndexByLabel.get(target.row) ?? rowIndex;

      return Math.abs(targetRowIndex - rowIndex) + Math.abs(target.col - col);
    });

  return Math.min(99, ...distances);
}

export function isEndgameForcingAction(state: GameState, action: { pieceId: string; target: PointId }, kingdom: Kingdom, profile: AiProfile): boolean {
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

  return (
    Boolean(capturedPiece && !isNeutralBlocker(capturedPiece)) ||
    givesDirectCheck(state, action, kingdom) ||
    addressesHangingPiece(state, action, kingdom, profile)
  );
}
