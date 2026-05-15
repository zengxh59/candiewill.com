import type { Kingdom, PointId, RowLabel } from "../board";
import { kingdomRows, parsePointId } from "../board";
import type { PieceType } from "../pieces";

// Piece-Square Tables (PST) for three-player Chinese chess
// Normalized coordinates: row 0 = back row, row 4 = front row; col 1-9
// Values are centi-pawns (hundredths of a soldier value)

const chariotPST: readonly number[] = [
  // row 0 (back rank) - chariots should develop
   0,   0,   0,   0,   0,   0,   0,   0,   0,
  // row 1
  10,  20,  20,  30,  40,  30,  20,  20,  10,
  // row 2 (palace top)
  20,  30,  35,  45,  55,  45,  35,  30,  20,
  // row 3 (cannon row)
  25,  35,  40,  50,  60,  50,  40,  35,  25,
  // row 4 (soldier row / boundary)
  30,  40,  45,  55,  65,  55,  45,  40,  30,
];

const horsePST: readonly number[] = [
  // row 0 (back rank) - horses should develop
   0,   0,   0,   0,   0,   0,   0,   0,   0,
  // row 1 - developing forward is good
   5,  15,  25,  25,  30,  25,  25,  15,   5,
  // row 2 - strong central positions
  15,  25,  40,  45,  50,  45,  40,  25,  15,
  // row 3 - deep development
  20,  35,  45,  55,  60,  55,  45,  35,  20,
  // row 4 - boundary, still good
  15,  30,  40,  50,  55,  50,  40,  30,  15,
];

const cannonPST: readonly number[] = [
  // row 0 (back rank) - cannons are ok here for defense
  10,  10,  15,  20,  25,  20,  15,  10,  10,
  // row 1 - cannon row or similar
   5,  15,  25,  30,  35,  30,  25,  15,   5,
  // row 2 - developed cannons
   0,  20,  30,  40,  45,  40,  30,  20,   0,
  // row 3 - aggressive but less screens available
  -5,  15,  25,  35,  40,  35,  25,  15,  -5,
  // row 4 - too far forward, few screens
 -10,   5,  15,  25,  30,  25,  15,   5, -10,
];

const soldierPST: readonly number[] = [
  // row 0 (back rank) - soldiers haven't moved
   0,   0,   0,   0,   0,   0,   0,   0,   0,
  // row 1 - starting row, no bonus
   0,   0,   0,   0,   0,   0,   0,   0,   0,
  // row 2 - advanced
  10,  10,  20,  20,  30,  20,  20,  10,  10,
  // row 3 - near boundary, strong
  20,  25,  35,  35,  45,  35,  35,  25,  20,
  // row 4 - crossed or at boundary, very strong
  30,  35,  45,  50,  60,  50,  45,  35,  30,
];

const advisorPST: readonly number[] = [
  // row 0 (back rank)
  -5,  -5,  -5,  10,  20,  10,  -5,  -5,  -5,
  // row 1
  -5,  -5,  -5,  10,  25,  10,  -5,  -5,  -5,
  // row 2 (palace top)
 -10, -10, -10,   5,  15,   5, -10, -10, -10,
  // row 3 (palace mid)
 -20, -20, -20, -10, -10, -10, -20, -20, -20,
  // row 4 - way out of position
 -30, -30, -30, -25, -25, -25, -30, -30, -30,
];

const elephantPST: readonly number[] = [
  // row 0 (back rank)
   0,   0,   5,   5,  10,   5,   5,   0,   0,
  // row 1
   5,  10,  15,  15,  20,  15,  15,  10,   5,
  // row 2
 -5,   0,   5,  10,  15,  10,   5,   0,  -5,
  // row 3 - near boundary, elephant can't cross
 -15, -10,  -5,   0,   5,   0,  -5, -10, -15,
  // row 4 - shouldn't be here
 -25, -20, -15, -10,  -5, -10, -15, -20, -25,
];

const generalPST: readonly number[] = [
  // row 0 (back rank) - best position
   0,   0,   0,  10,  20,  10,   0,   0,   0,
  // row 1
  -5,  -5,   0,   5,  10,   5,   0,  -5,  -5,
  // row 2 (palace top) - risky
 -10, -10,  -5,   0,   0,   0,  -5, -10, -10,
  // row 3 - very dangerous
 -20, -20, -15, -10, -10, -10, -15, -20, -20,
  // row 4 - fatal
 -30, -30, -25, -20, -20, -20, -25, -30, -30,
];

// Endgame-adjusted PSTs: soldiers worth more when advanced, pieces should target enemy general
const soldierEndgamePST: readonly number[] = [
   0,   0,   0,   0,   0,   0,   0,   0,   0,
   0,   5,  10,  10,  15,  10,  10,   5,   0,
  15,  20,  30,  35,  45,  35,  30,  20,  15,
  30,  35,  45,  55,  70,  55,  45,  35,  30,
  45,  50,  60,  70,  85,  70,  60,  50,  45,
];

const horseEndgamePST: readonly number[] = [
   0,   0,   0,   0,   0,   0,   0,   0,   0,
  10,  20,  30,  30,  35,  30,  30,  20,  10,
  20,  30,  45,  50,  55,  50,  45,  30,  20,
  25,  40,  50,  60,  65,  60,  50,  40,  25,
  20,  35,  45,  55,  60,  55,  45,  35,  20,
];

const chariotEndgamePST: readonly number[] = [
   0,   0,   0,   0,   0,   0,   0,   0,   0,
  15,  25,  25,  35,  45,  35,  25,  25,  15,
  25,  35,  40,  50,  60,  50,  40,  35,  25,
  30,  40,  45,  55,  65,  55,  45,  40,  30,
  35,  45,  50,  60,  70,  60,  50,  45,  35,
];

type PSTMap = Record<PieceType, readonly number[]>;

const middlegamePST: PSTMap = {
  general: generalPST,
  advisor: advisorPST,
  elephant: elephantPST,
  horse: horsePST,
  chariot: chariotPST,
  cannon: cannonPST,
  soldier: soldierPST,
};

const endgamePST: PSTMap = {
  general: generalPST,
  advisor: advisorPST,
  elephant: elephantPST,
  horse: horseEndgamePST,
  chariot: chariotEndgamePST,
  cannon: cannonPST,
  soldier: soldierEndgamePST,
};

function normalizedRow(point: PointId, pieceKingdom: Kingdom): number {
  const rows = kingdomRows[pieceKingdom] as readonly string[];
  const row = parsePointId(point).row;

  // Back rank (rows[4]) → index 0, front rank (rows[0]) → index 4
  const kingdomIndex = rows.indexOf(row as never);

  if (kingdomIndex >= 0) {
    return rows.length - 1 - kingdomIndex;
  }

  // Piece is in enemy territory — use maximum forward bonus
  return 4;
}

function pstIndex(row: number, col: number): number {
  return row * 9 + (col - 1);
}

export function pieceSquareBonus(pieceType: PieceType, position: PointId, pieceKingdom: Kingdom, isEndgame: boolean): number {
  const tables = isEndgame ? endgamePST : middlegamePST;
  const table = tables[pieceType];
  const row = normalizedRow(position, pieceKingdom);
  const col = parsePointId(position).col;

  return table[pstIndex(row, col)];
}
