import type { Kingdom, PointId } from "../board";
import { kingdomOf, kingdomRows, parsePointId } from "../board";
import { capturedPieceAt, nextActiveKingdom, turnOrder, type GameState } from "../game-state";
import { getCheckedKingdoms, getPseudoLegalMoves, isKingdomInCheck, isSquareAttackedBy } from "../moves";
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

// === Fast make/unmake for search: modifies state in-place, returns undo info ===

export interface UndoInfo {
  pieceId: string;
  fromPosition: PointId;
  capturedPieceIndex: number;
  capturedPiece: Piece | null;
  currentKingdom: Kingdom;
  checkedKingdoms: Kingdom[];
  defeatedKingdoms: Kingdom[];
  winner: Kingdom | null;
  positionMapCleared: boolean;
}

export function makeSearchMove(state: GameState, pieceId: string, target: PointId): UndoInfo {
  const movingPieceIndex = state.pieces.findIndex((piece) => piece.id === pieceId);
  const movingPiece = state.pieces[movingPieceIndex];
  const fromPosition = movingPiece.position;

  // Find captured piece at target
  let capturedPieceIndex = -1;
  let capturedPiece: Piece | null = null;

  for (let index = 0; index < state.pieces.length; index += 1) {
    const piece = state.pieces[index];
    if (piece.id !== pieceId && piece.position === target && piece.blocksMovement) {
      capturedPieceIndex = index;
      capturedPiece = { ...piece };
      break;
    }
  }

  const undo: UndoInfo = {
    pieceId,
    fromPosition,
    capturedPieceIndex,
    capturedPiece,
    currentKingdom: state.currentKingdom,
    checkedKingdoms: state.checkedKingdoms,
    defeatedKingdoms: state.defeatedKingdoms,
    winner: state.winner,
    positionMapCleared: state._positionMap !== undefined,
  };

  // Clear position map cache
  if (state._positionMap) {
    (state as { _positionMap: Map<PointId, Piece> | undefined })._positionMap = undefined;
  }

  // Move the piece in-place
  (state.pieces[movingPieceIndex] as { position: PointId }).position = target;

  // Handle capture: remove or mark defeated
  if (capturedPiece) {
    if (capturedPiece.type === "general" && !state.defeatedKingdoms.includes(capturedPiece.kingdom)) {
      // General captured — defeat that kingdom
      const defeatedKingdom = capturedPiece.kingdom;
      state.defeatedKingdoms = [...state.defeatedKingdoms, defeatedKingdom];

      // Apply defeated piece mode
      if (state.options.defeatedPieceMode === "remove") {
        // Remove all pieces of the defeated kingdom
        state.pieces = state.pieces.filter((piece) => piece.kingdom !== defeatedKingdom);
      } else {
        for (let index = 0; index < state.pieces.length; index += 1) {
          if (state.pieces[index].kingdom === defeatedKingdom) {
            (state.pieces[index] as { defeated: boolean; blocksMovement: boolean; controller: Kingdom }).defeated = true;
            (state.pieces[index] as { defeated: boolean; blocksMovement: boolean; controller: Kingdom }).blocksMovement = true;
            if (state.options.defeatedPieceMode === "takeover") {
              (state.pieces[index] as { controller: Kingdom }).controller = movingPiece.controller;
            }
          }
        }
      }

      // Check for winner
      const activeKingdoms = turnOrder.filter((kingdom) => !state.defeatedKingdoms.includes(kingdom));
      if (activeKingdoms.length === 1) {
        (state as { winner: Kingdom | null }).winner = activeKingdoms[0];
      }
    } else if (state.options.defeatedPieceMode === "remove") {
      state.pieces.splice(capturedPieceIndex, 1);
    } else {
      (state.pieces[capturedPieceIndex] as { defeated: boolean }).defeated = true;
      (state.pieces[capturedPieceIndex] as { blocksMovement: boolean }).blocksMovement = false;
    }
  }

  // Advance turn
  (state as { currentKingdom: Kingdom }).currentKingdom = nextActiveKingdom(undo.currentKingdom, state.defeatedKingdoms);

  // Incremental check detection: only re-check kingdoms whose general might be affected
  if (state.winner) {
    (state as { checkedKingdoms: Kingdom[] }).checkedKingdoms = [];
  } else {
    // Start from the old checked kingdoms and update based on the move
    const checked: Kingdom[] = [];
    for (const kingdom of (Object.keys(kingdomRows) as Kingdom[])) {
      if (state.defeatedKingdoms.includes(kingdom)) continue;
      // Only re-check if the move could affect this kingdom's check status:
      // the general itself moved, a capture happened near the general, or it was previously checked
      const wasChecked = undo.checkedKingdoms.includes(kingdom);
      const movingPiece = state.pieces[movingPieceIndex];
      const movedFromOtherKingdom = movingPiece && kingdomOf(fromPosition) === kingdom;
      const movedToOtherKingdom = movingPiece && kingdomOf(target) === kingdom;
      const capturedInKingdom = capturedPiece && kingdomOf(capturedPiece.position) === kingdom;

      if (wasChecked || movedFromOtherKingdom || movedToOtherKingdom || capturedInKingdom) {
        if (isKingdomInCheck(state, kingdom)) {
          checked.push(kingdom);
        }
      } else {
        // Unchanged — keep old status
        if (wasChecked) {
          checked.push(kingdom);
        }
      }
    }
    (state as { checkedKingdoms: Kingdom[] }).checkedKingdoms = checked;
  }

  return undo;
}

export function unmakeSearchMove(state: GameState, undo: UndoInfo): void {
  // Restore checked kingdoms, defeated kingdoms, winner, current kingdom
  (state as { checkedKingdoms: Kingdom[] }).checkedKingdoms = undo.checkedKingdoms;
  (state as { currentKingdom: Kingdom }).currentKingdom = undo.currentKingdom;
  (state as { defeatedKingdoms: Kingdom[] }).defeatedKingdoms = undo.defeatedKingdoms;
  (state as { winner: Kingdom | null }).winner = undo.winner;

  // Restore captured piece
  if (undo.capturedPiece) {
    // If the capture caused a kingdom defeat, we need to fully restore via applySearchMove fallback
    // For simplicity, just re-apply from scratch in that case
    if (undo.capturedPiece.type === "general") {
      // Full restore is complex for general captures — signal that fallback is needed
      return;
    }

    if (state.options.defeatedPieceMode === "remove") {
      // Re-insert the captured piece at its original index
      state.pieces.splice(undo.capturedPieceIndex, 0, { ...undo.capturedPiece });
    } else {
      const pieceIndex = state.pieces.findIndex((piece) => piece.id === undo.capturedPiece!.id);
      if (pieceIndex >= 0) {
        state.pieces[pieceIndex] = { ...undo.capturedPiece };
      }
    }
  }

  // Move piece back to original position
  const movingPieceIndex = state.pieces.findIndex((piece) => piece.id === undo.pieceId);
  if (movingPieceIndex >= 0) {
    (state.pieces[movingPieceIndex] as { position: PointId }).position = undo.fromPosition;
  }

  // Rebuild position map if it existed before
  if (undo.positionMapCleared) {
    (state as { _positionMap: Map<PointId, Piece> | undefined })._positionMap = undefined;
  }
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
