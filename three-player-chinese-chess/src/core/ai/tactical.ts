import type { Kingdom, PointId } from "../board";
import { kingdomOf, kingdomRows, parsePointId } from "../board";
import { capturedPieceAt, nextActiveKingdom, pieceAt, turnOrder, type GameState } from "../game-state";
import { getCheckedKingdoms, getPseudoLegalMoves, horseAttacksSquare, isKingdomInCheck, isSquareAttackedBy, movementLines, soldierAttacksSquare } from "../moves";
import type { Piece } from "../pieces";
import type { AiProfile } from "../ai-profile";
import { applyMove } from "../rules";

import { pieceValue, isNeutralBlocker } from "./evaluate";
import { type ZobristHash, xorHash, pieceHash, sideHash, defeatedHash, checkedKingdomHash } from "./zobrist";

export const profitableCaptureMargin = 200;
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
  zobrist: ZobristHash | undefined;
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
    zobrist: (state as { _zobrist?: ZobristHash })._zobrist,
  };

  // Incremental Zobrist update
  let hash: ZobristHash = undo.zobrist ?? { hi: 0, lo: 0 };

  // XOR out old piece position, XOR in new position
  hash = xorHash(hash, pieceHash(movingPiece.type, movingPiece.kingdom, fromPosition));
  hash = xorHash(hash, pieceHash(movingPiece.type, movingPiece.kingdom, target));

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

  // Finalize Zobrist hash
  if (capturedPiece) {
    if (capturedPiece.type === "general") {
      // General capture changes too many things for incremental update — invalidate
      (state as { _zobrist?: ZobristHash })._zobrist = undefined;
      return undo;
    }
    // XOR out captured piece
    hash = xorHash(hash, pieceHash(capturedPiece.type, capturedPiece.kingdom, capturedPiece.position));
  }

  // Side change: XOR out old side, XOR in new side
  hash = xorHash(hash, sideHash(undo.currentKingdom));
  hash = xorHash(hash, sideHash(state.currentKingdom));

  for (const kingdom of undo.checkedKingdoms) {
    if (!state.checkedKingdoms.includes(kingdom)) {
      hash = xorHash(hash, checkedKingdomHash(kingdom));
    }
  }

  for (const kingdom of state.checkedKingdoms) {
    if (!undo.checkedKingdoms.includes(kingdom)) {
      hash = xorHash(hash, checkedKingdomHash(kingdom));
    }
  }

  (state as { _zobrist?: ZobristHash })._zobrist = hash;

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
      // Restore properties in-place to preserve shared references with parent states
      const pieceIndex = state.pieces.findIndex((piece) => piece.id === undo.capturedPiece!.id);
      if (pieceIndex >= 0) {
        (state.pieces[pieceIndex] as { defeated: boolean }).defeated = undo.capturedPiece.defeated;
        (state.pieces[pieceIndex] as { blocksMovement: boolean }).blocksMovement = undo.capturedPiece.blocksMovement;
      }
    }
  }

  // Move piece back to original position
  const movingPieceIndex = state.pieces.findIndex((piece) => piece.id === undo.pieceId);
  if (movingPieceIndex >= 0) {
    (state.pieces[movingPieceIndex] as { position: PointId }).position = undo.fromPosition;
  }

  // Always clear position map — inner searches may have populated a stale cache
  (state as { _positionMap: Map<PointId, Piece> | undefined })._positionMap = undefined;

  // Restore Zobrist hash
  (state as { _zobrist?: ZobristHash })._zobrist = undo.zobrist;
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

  return isInsideOwnPalace(kingdom, action.target) || pieceAttacksSquare(state, capturedPiece, movingPiece.position);
}

export function givesDirectCheck(state: GameState, action: { pieceId: string; target: PointId }, kingdom: Kingdom): boolean {
  const movingPiece = state.pieces.find((p) => p.id === action.pieceId);
  if (!movingPiece) return false;

  const origPos = movingPiece.position;

  // Temporarily suppress captured piece's blocking
  let capturedIdx = -1;
  let capturedBlockState = false;
  for (let i = 0; i < state.pieces.length; i++) {
    const p = state.pieces[i];
    if (p.id !== action.pieceId && p.position === action.target && p.blocksMovement) {
      capturedIdx = i;
      capturedBlockState = true;
      (state.pieces[i] as { blocksMovement: boolean }).blocksMovement = false;
      break;
    }
  }

  // Clear position map and temporarily move piece
  (state as { _positionMap: Map<PointId, Piece> | undefined })._positionMap = undefined;
  (movingPiece as { position: PointId }).position = action.target;

  let givesCheck = false;
  try {
    // Check if any opponent general is now attacked
    for (const oppKingdom of turnOrder) {
      if (oppKingdom === kingdom || state.defeatedKingdoms.includes(oppKingdom)) continue;
      const oppGeneral = state.pieces.find((p) => p.kingdom === oppKingdom && p.type === "general" && p.blocksMovement);
      if (oppGeneral && isSquareAttackedBy(state, oppGeneral.position, oppKingdom)) {
        givesCheck = true;
        break;
      }
    }
  } finally {
    // Restore state
    (movingPiece as { position: PointId }).position = origPos;
    if (capturedIdx >= 0) {
      (state.pieces[capturedIdx] as { blocksMovement: boolean }).blocksMovement = capturedBlockState;
    }
    (state as { _positionMap: Map<PointId, Piece> | undefined })._positionMap = undefined;
  }

  return givesCheck;
}

/**
 * Direct attack check without full move generation.
 * Uses line scanning for chariots/generals/cannons, direct functions for horses/soldiers,
 * and falls back to pseudo-legal moves for advisors/elephants.
 */
export function pieceAttacksSquare(state: GameState, piece: Piece, square: PointId): boolean {
  if (!piece.blocksMovement || isNeutralBlocker(piece)) return false;
  if (piece.position === square) return false;

  switch (piece.type) {
    case "chariot":
      return linePieceAttacksSquare(state, piece, square);
    case "general":
      return generalAttacksSquare(state, piece, square);
    case "cannon":
      return cannonAttacksSquare(state, piece, square);
    case "horse":
      return horseAttacksSquare(state, piece, square);
    case "soldier":
      return soldierAttacksSquare(piece, square);
    case "advisor":
    case "elephant":
      return getPseudoLegalMoves(state, piece).includes(square);
  }
}

function linePieceAttacksSquare(state: GameState, piece: Piece, square: PointId): boolean {
  for (const line of movementLines) {
    const fromIdx = line.indexOf(piece.position);
    const toIdx = line.indexOf(square);
    if (fromIdx < 0 || toIdx < 0) continue;

    const step = toIdx > fromIdx ? 1 : -1;
    let blocked = false;
    for (let i = fromIdx + step; i !== toIdx; i += step) {
      if (pieceAt(state, line[i])) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return true;
  }
  return false;
}

function generalAttacksSquare(state: GameState, piece: Piece, square: PointId): boolean {
  // Palace moves: check if adjacent in palace
  const palaceRows = kingdomRows[piece.kingdom].slice(2) as readonly string[];
  const { row, col } = parsePointId(piece.position);
  const { row: targetRow, col: targetCol } = parsePointId(square);
  if (palaceRows.includes(targetRow) && targetCol >= 4 && targetCol <= 6) {
    const rowIdx = palaceRows.indexOf(row);
    const targetRowIdx = palaceRows.indexOf(targetRow);
    if (rowIdx >= 0 && targetRowIdx >= 0 && Math.abs(rowIdx - targetRowIdx) + Math.abs(col - targetCol) === 1) {
      return true;
    }
  }
  // Flying general: line attack on opponent general
  const targetPiece = pieceAt(state, square);
  if (targetPiece?.type === "general" && targetPiece.kingdom !== piece.kingdom) {
    return linePieceAttacksSquare(state, piece, square);
  }
  return false;
}

function cannonAttacksSquare(state: GameState, piece: Piece, square: PointId): boolean {
  for (const line of movementLines) {
    const fromIdx = line.indexOf(piece.position);
    const toIdx = line.indexOf(square);
    if (fromIdx < 0 || toIdx < 0) continue;

    const step = toIdx > fromIdx ? 1 : -1;
    let screens = 0;
    for (let i = fromIdx + step; i !== toIdx; i += step) {
      if (pieceAt(state, line[i])) {
        screens++;
      }
    }
    if (screens === 1) return true;
  }
  return false;
}

export function attackersOf(state: GameState, point: PointId, ownKingdom: Kingdom): Piece[] {
  return state.pieces.filter((piece) => {
    return piece.controller !== ownKingdom && pieceAttacksSquare(state, piece, point);
  });
}

export function defendersOf(state: GameState, point: PointId, ownKingdom: Kingdom, excludedPieceId?: string): Piece[] {
  return state.pieces.filter((piece) => {
    return (
      piece.controller === ownKingdom &&
      piece.id !== excludedPieceId &&
      pieceAttacksSquare(state, piece, point)
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
  const nextState = applySearchMove(state, action.pieceId, action.target);
  const attackers = attackersOf(nextState, action.target, kingdom);

  if (!attackers.length) {
    return capturedValue;
  }

  // Iterative exchange: build gain sequence then propagate backwards
  const gain: number[] = [capturedValue];
  const defenders = defendersOf(nextState, action.target, kingdom, movingPiece.id);

  const attackerValues = attackers.map((p) => pieceValue(p, profile)).sort((a, b) => a - b);
  const defenderValues = defenders.map((p) => pieceValue(p, profile)).sort((a, b) => a - b);

  let pieceOnSquareValue = pieceValue(movingPiece, profile);
  let isOpponentTurn = true;
  let attackerIdx = 0;
  let defenderIdx = 0;
  const maxSteps = attackerValues.length + defenderValues.length;

  for (let step = 0; step < maxSteps; step++) {
    if (isOpponentTurn) {
      if (attackerIdx >= attackerValues.length) break;
      gain.push(pieceOnSquareValue);
      pieceOnSquareValue = attackerValues[attackerIdx];
      attackerIdx++;
    } else {
      if (defenderIdx >= defenderValues.length) break;
      gain.push(pieceOnSquareValue);
      pieceOnSquareValue = defenderValues[defenderIdx];
      defenderIdx++;
    }
    isOpponentTurn = !isOpponentTurn;
  }

  // Backwards propagation: see = max(0, gain[i] - see)
  let see = 0;
  for (let i = gain.length - 1; i >= 0; i--) {
    see = Math.max(0, gain[i] - see);
  }

  return see;
}

export function isProfitableCapture(state: GameState, action: { pieceId: string; target: PointId }, kingdom: Kingdom, profile: AiProfile): boolean {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

  if (!capturedPiece || isNeutralBlocker(capturedPiece) || !movingPiece) {
    return false;
  }

  if (capturedPiece.type === "general") {
    return true;
  }

  const see = staticExchangeScore(state, action, kingdom, profile);

  if (movingPiece && pieceValue(movingPiece, profile) > pieceValue(capturedPiece, profile) * 2 && see < profitableCaptureMargin * 2) {
    return false;
  }

  return see >= profitableCaptureMargin;
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
      pieceAttacksSquare(state, capturedPiece, piece.position)
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
