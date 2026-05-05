import {
  type Kingdom,
  type PointId,
  type RowLabel,
  getPalaceBounds,
  kingdomRows,
  parsePointId,
  pointId,
} from "./board";
import { boardGraph, getEdgeType } from "./graph";
import type { GameState } from "./game-state";
import { pieceAt } from "./game-state";
import type { Piece } from "./pieces";

const cols = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const allRows = Object.values(kingdomRows).flat() as RowLabel[];
const rowIndexByLabel = new Map<RowLabel, number>(allRows.map((row, index) => [row, index]));

const movementLines: PointId[][] = [
  ...allRows.map((row) => cols.map((col) => pointId(row, col))),
  ...Object.values(kingdomRows).flatMap((rows) => {
    return cols.map((col) => rows.map((row) => pointId(row, col)));
  }),
  ...createCrossKingdomFileLines(),
  ["A1", "F9"],
  ["F1", "K9"],
  ["K1", "A9"],
  ["A5", "F5"],
  ["F5", "K5"],
  ["K5", "A5"],
];

interface CrossZone {
  kingdoms: readonly [Kingdom, Kingdom];
  rows: readonly RowLabel[];
  toCoord(point: PointId): { x: number; y: number } | null;
  fromCoord(x: number, y: number): PointId | null;
}

const crossZones: CrossZone[] = [
  createCrossZone("wei", "wu", ["E", "D", "C", "B", "A"], ["F", "G", "H", "I", "J"], "normal", "mirror"),
  createCrossZone("wu", "shu", ["J", "I", "H", "G", "F"], ["K", "L", "M", "N", "O"], "normal", "mirror"),
  createCrossZone("shu", "wei", ["O", "N", "M", "L", "K"], ["A", "B", "C", "D", "E"], "normal", "mirror"),
];

export function getLegalMoves(state: GameState, piece: Piece): PointId[] {
  return getPseudoLegalMoves(state, piece);
}

export function isKingdomInCheck(state: GameState, kingdom: Kingdom): boolean {
  const general = state.pieces.find((piece) => piece.kingdom === kingdom && piece.type === "general");

  if (!general) {
    return false;
  }

  return state.pieces.some((piece) => {
    return piece.controller !== kingdom && getAttackMoves(state, piece).includes(general.position);
  });
}

export function getCheckedKingdoms(state: GameState): Kingdom[] {
  return (Object.keys(kingdomRows) as Kingdom[]).filter((kingdom) => isKingdomInCheck(state, kingdom));
}

function getPseudoLegalMoves(state: GameState, piece: Piece): PointId[] {
  switch (piece.type) {
    case "general":
      return filterFriendlyTargets(state, piece, getGeneralMoves(piece));
    case "advisor":
      return filterFriendlyTargets(state, piece, getAdvisorMoves(piece));
    case "elephant":
      return filterFriendlyTargets(state, piece, getElephantMoves(state, piece));
    case "horse":
      return filterFriendlyTargets(state, piece, getHorseMoves(state, piece));
    case "chariot":
      return getLineMoves(state, piece, false);
    case "cannon":
      return getLineMoves(state, piece, true);
    case "soldier":
      return filterFriendlyTargets(state, piece, getSoldierMoves(piece));
  }
}

function getAttackMoves(state: GameState, piece: Piece): PointId[] {
  if (piece.type === "general") {
    return [...new Set([...getGeneralMoves(piece), ...getFlyingGeneralTargets(state, piece)])];
  }

  return getPseudoLegalMoves(state, piece);
}

function filterFriendlyTargets(state: GameState, piece: Piece, targets: PointId[]): PointId[] {
  return targets.filter((target) => {
    const occupyingPiece = pieceAt(state, target);

    return !occupyingPiece || occupyingPiece.controller !== piece.controller;
  });
}

function getGeneralMoves(piece: Piece): PointId[] {
  const palace = getPalaceBounds(piece.kingdom);
  const candidates = boardGraph.neighbors.get(piece.position) ?? [];

  return candidates.filter((target) => isInsidePalace(target, palace.rows, palace.cols));
}

function getFlyingGeneralTargets(state: GameState, piece: Piece): PointId[] {
  return getLineMoves(state, piece, false).filter((target) => {
    const targetPiece = pieceAt(state, target);

    return targetPiece?.type === "general";
  });
}

function getAdvisorMoves(piece: Piece): PointId[] {
  const palace = getPalaceBounds(piece.kingdom);
  const candidates = boardGraph.neighbors.get(piece.position) ?? [];

  return candidates.filter((target) => {
    return getEdgeType(boardGraph, piece.position, target) === "palace" && isInsidePalace(target, palace.rows, palace.cols);
  });
}

function getElephantMoves(state: GameState, piece: Piece): PointId[] {
  const { row, col } = parsePointId(piece.position);
  const rowIndex = rowIndexByLabel.get(row);

  if (rowIndex === undefined) {
    return [];
  }

  return [
    [rowIndex - 2, col - 2, rowIndex - 1, col - 1],
    [rowIndex - 2, col + 2, rowIndex - 1, col + 1],
    [rowIndex + 2, col - 2, rowIndex + 1, col - 1],
    [rowIndex + 2, col + 2, rowIndex + 1, col + 1],
  ].flatMap(([targetRowIndex, targetCol, eyeRowIndex, eyeCol]) => {
    const targetRow = allRows[targetRowIndex];
    const eyeRow = allRows[eyeRowIndex];

    if (!targetRow || !eyeRow || targetCol < 1 || targetCol > 9 || eyeCol < 1 || eyeCol > 9) {
      return [];
    }

    const target = pointId(targetRow, targetCol);
    const eye = pointId(eyeRow, eyeCol);

    if (!isOwnKingdomPoint(piece.kingdom, target) || pieceAt(state, eye)) {
      return [];
    }

    return [target];
  });
}

function getHorseMoves(state: GameState, piece: Piece): PointId[] {
  const candidates = new Set<PointId>(getLocalHorseMoves(state, piece));

  for (const zone of zonesForPiece(piece)) {
    const position = zone.toCoord(piece.position);

    if (!position) {
      continue;
    }

    for (const [targetDx, targetDy, legDx, legDy] of [
      [-1, -2, 0, -1],
      [1, -2, 0, -1],
      [-1, 2, 0, 1],
      [1, 2, 0, 1],
      [-2, -1, -1, 0],
      [-2, 1, -1, 0],
      [2, -1, 1, 0],
      [2, 1, 1, 0],
    ]) {
      const target = zone.fromCoord(position.x + targetDx, position.y + targetDy);
      const leg = zone.fromCoord(position.x + legDx, position.y + legDy);

      if (!target || !leg || pieceAt(state, leg)) {
        continue;
      }

      candidates.add(target);
    }
  }

  return [...candidates];
}

function getLocalHorseMoves(state: GameState, piece: Piece): PointId[] {
  const { row, col } = parsePointId(piece.position);
  const ownRows = kingdomRows[piece.kingdom] as readonly RowLabel[];
  const rowIndex = ownRows.indexOf(row);

  if (rowIndex < 0) {
    return [];
  }

  return [
    [rowIndex - 2, col - 1, rowIndex - 1, col],
    [rowIndex - 2, col + 1, rowIndex - 1, col],
    [rowIndex + 2, col - 1, rowIndex + 1, col],
    [rowIndex + 2, col + 1, rowIndex + 1, col],
    [rowIndex - 1, col - 2, rowIndex, col - 1],
    [rowIndex + 1, col - 2, rowIndex, col - 1],
    [rowIndex - 1, col + 2, rowIndex, col + 1],
    [rowIndex + 1, col + 2, rowIndex, col + 1],
  ].flatMap(([targetRowIndex, targetCol, legRowIndex, legCol]) => {
    const targetRow = ownRows[targetRowIndex];
    const legRow = ownRows[legRowIndex];

    if (!targetRow || !legRow || targetCol < 1 || targetCol > 9 || legCol < 1 || legCol > 9) {
      return [];
    }

    const target = pointId(targetRow, targetCol);
    const leg = pointId(legRow, legCol);

    if (pieceAt(state, leg)) {
      return [];
    }

    return [target];
  });
}

function getLineMoves(state: GameState, piece: Piece, needsScreenForCapture: boolean): PointId[] {
  const moves = new Set<PointId>();

  for (const line of movementLines.filter((item) => item.includes(piece.position))) {
    const index = line.indexOf(piece.position);
    scanLine(state, piece, line.slice(index + 1), needsScreenForCapture, moves);
    scanLine(state, piece, line.slice(0, index).reverse(), needsScreenForCapture, moves);
  }

  return [...moves];
}

function scanLine(
  state: GameState,
  piece: Piece,
  points: PointId[],
  needsScreenForCapture: boolean,
  moves: Set<PointId>,
): void {
  let screenFound = false;

  for (const point of points) {
    const occupyingPiece = pieceAt(state, point);

    if (!needsScreenForCapture) {
      if (!occupyingPiece) {
        moves.add(point);
        continue;
      }

      if (occupyingPiece.controller !== piece.controller) {
        moves.add(point);
      }
      return;
    }

    if (!screenFound) {
      if (!occupyingPiece) {
        moves.add(point);
        continue;
      }

      screenFound = true;
      continue;
    }

    if (occupyingPiece) {
      if (occupyingPiece.controller !== piece.controller) {
        moves.add(point);
      }
      return;
    }
  }
}

function getSoldierMoves(piece: Piece): PointId[] {
  const { row, col } = parsePointId(piece.position);
  const rows = kingdomRows[piece.kingdom] as readonly RowLabel[];
  const localRowIndex = rows.indexOf(row);
  const moves: PointId[] = [];

  if (localRowIndex < 0) {
    return getCrossedSoldierMoves(piece);
  }

  if (localRowIndex > 0) {
    moves.push(pointId(rows[localRowIndex - 1], col));
  } else {
    moves.push(...getSoldierCrossings(piece));
  }

  if (localRowIndex === 0) {
    if (col > 1) {
      moves.push(pointId(row, col - 1));
    }
    if (col < 9) {
      moves.push(pointId(row, col + 1));
    }
  }

  return [...new Set(moves)];
}

function getSoldierCrossings(piece: Piece): PointId[] {
  return zonesForPiece(piece).flatMap((zone) => {
    const position = zone.toCoord(piece.position);
    const target = position ? zone.fromCoord(position.x, position.y + forwardDelta(zone, piece.kingdom)) : null;

    return target ? [target] : [];
  });
}

function getCrossedSoldierMoves(piece: Piece): PointId[] {
  const moves = new Set<PointId>();

  for (const zone of zonesForPiece(piece)) {
    const position = zone.toCoord(piece.position);

    if (!position) {
      continue;
    }

    for (const [dx, dy] of [
      [0, forwardDelta(zone, piece.kingdom)],
      [-1, 0],
      [1, 0],
    ]) {
      const target = zone.fromCoord(position.x + dx, position.y + dy);

      if (target) {
        moves.add(target);
      }
    }
  }

  return [...moves];
}

function isNotBackwardSoldierMove(kingdom: Kingdom, from: PointId, to: PointId): boolean {
  const rows = kingdomRows[kingdom] as readonly RowLabel[];
  const fromRowIndex = rows.indexOf(parsePointId(from).row);
  const toRowIndex = rows.indexOf(parsePointId(to).row);

  return toRowIndex <= fromRowIndex;
}

function isInsidePalace(
  target: PointId,
  palaceRows: readonly RowLabel[],
  palaceCols: readonly [4, 5, 6],
): boolean {
  const { row, col } = parsePointId(target);

  return palaceRows.includes(row) && palaceCols.includes(col as 4 | 5 | 6);
}

function isOwnKingdomPoint(kingdom: Kingdom, target: PointId): boolean {
  return (kingdomRows[kingdom] as readonly RowLabel[]).includes(parsePointId(target).row);
}

function zonesForPiece(piece: Piece): CrossZone[] {
  return crossZones.filter((zone) => zone.kingdoms.includes(piece.kingdom));
}

function forwardDelta(zone: CrossZone, kingdom: Kingdom): 1 | -1 {
  return zone.kingdoms[0] === kingdom ? 1 : -1;
}

function createCrossKingdomFileLines(): PointId[][] {
  return [
    ...createBoundaryFileLines(["E", "D", "C", "B", "A"], ["F", "G", "H", "I", "J"]),
    ...createBoundaryFileLines(["J", "I", "H", "G", "F"], ["K", "L", "M", "N", "O"]),
    ...createBoundaryFileLines(["O", "N", "M", "L", "K"], ["A", "B", "C", "D", "E"]),
  ];
}

function createBoundaryFileLines(nearRows: readonly RowLabel[], farRows: readonly RowLabel[]): PointId[][] {
  return [1, 2, 3, 4, 5].map((file) => {
    const nearCol = file;
    const farCol = 10 - file;

    return [
      ...nearRows.map((row) => pointId(row, nearCol)),
      ...farRows.map((row) => pointId(row, farCol)),
    ];
  });
}

function createCrossZone(
  nearKingdom: Kingdom,
  farKingdom: Kingdom,
  nearRows: readonly RowLabel[],
  farRows: readonly RowLabel[],
  nearColMode: "normal" | "mirror",
  farColMode: "normal" | "mirror",
): CrossZone {
  const rows = [...nearRows, ...farRows];

  function toX(col: number, mode: "normal" | "mirror"): number {
    return mode === "normal" ? col : 10 - col;
  }

  function fromX(x: number, mode: "normal" | "mirror"): number {
    return mode === "normal" ? x : 10 - x;
  }

  return {
    kingdoms: [nearKingdom, farKingdom],
    rows,
    toCoord(point) {
      const { row, col } = parsePointId(point);
      const y = rows.indexOf(row);

      if (y < 0) {
        return null;
      }

      const mode = y < nearRows.length ? nearColMode : farColMode;
      const x = toX(col, mode);

      if (x < 1 || x > 5) {
        return null;
      }

      return { x, y };
    },
    fromCoord(x, y) {
      const row = rows[y];

      if (!row || x < 1 || x > 5) {
        return null;
      }

      const mode = y < nearRows.length ? nearColMode : farColMode;
      const col = fromX(x, mode);

      if (col < 1 || col > 9) {
        return null;
      }

      return pointId(row, col);
    },
  };
}
