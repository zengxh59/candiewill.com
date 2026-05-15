import {
  type Kingdom,
  type PointId,
  type RowLabel,
  getPalaceBounds,
  kingdomOf,
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

// Precomputed line index map for fast pin detection
const pointLineMap = new Map<PointId, { lineIndex: number; positionInLine: number }[]>();

for (let li = 0; li < movementLines.length; li++) {
  for (let pi = 0; pi < movementLines[li].length; pi++) {
    const point = movementLines[li][pi];
    let entries = pointLineMap.get(point);
    if (!entries) {
      entries = [];
      pointLineMap.set(point, entries);
    }
    entries.push({ lineIndex: li, positionInLine: pi });
  }
}

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
  const controller = piece.controller;
  const pseudoMoves = getPseudoLegalMoves(state, piece);

  // Fast path: not in check, not the general, not pinned by a line attacker
  if (piece.type !== "general" && !state.checkedKingdoms.includes(controller) && !isPieceOnPinLine(state, piece)) {
    return pseudoMoves;
  }

  // Slow path: validate each move with state simulation
  return pseudoMoves.filter((target) => {
    return !isKingdomInCheck(simulateMove(state, piece.id, target), controller);
  });
}

function isPieceOnPinLine(state: GameState, piece: Piece): boolean {
  const kingdom = piece.controller;
  const general = state.pieces.find(
    (p) => p.kingdom === kingdom && p.type === "general" && p.blocksMovement,
  );
  if (!general) return false;

  const genLineEntries = pointLineMap.get(general.position);
  if (!genLineEntries) return false;

  for (const genEntry of genLineEntries) {
    const line = movementLines[genEntry.lineIndex];
    const piecePos = line.indexOf(piece.position);
    if (piecePos < 0 || piecePos === genEntry.positionInLine) continue;

    const step = piecePos > genEntry.positionInLine ? 1 : -1;

    // Verify no pieces between general and our piece on this line
    let blocked = false;
    for (let i = genEntry.positionInLine + step; i !== piecePos; i += step) {
      if (pieceAt(state, line[i])) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    // Check for enemy line attacker beyond our piece
    for (let i = piecePos + step; i >= 0 && i < line.length; i += step) {
      const p = pieceAt(state, line[i]);
      if (!p) continue;

      if (
        p.controller !== kingdom &&
        p.blocksMovement &&
        !(p.defeated && p.controller === p.kingdom) &&
        (p.type === "chariot" || p.type === "general")
      ) {
        return true;
      }
      break;
    }
  }

  return false;
}

function simulateMove(state: GameState, pieceId: string, target: PointId): GameState {
  const pieces = state.pieces
    .filter((p) => p.id === pieceId || !(p.position === target && p.blocksMovement))
    .map((p) => (p.id === pieceId ? { ...p, position: target } : p));
  return { ...state, pieces, _positionMap: undefined };
}

export function isKingdomInCheck(state: GameState, kingdom: Kingdom): boolean {
  const general = state.pieces.find((piece) => piece.kingdom === kingdom && piece.type === "general");

  if (!general) {
    return false;
  }

  return isSquareAttackedBy(state, general.position, kingdom);
}

export function isSquareAttackedBy(state: GameState, square: PointId, ownKingdom: Kingdom): boolean {
  const isEnemy = (piece: Piece) =>
    piece.controller !== ownKingdom && piece.blocksMovement && !(piece.defeated && piece.controller === piece.kingdom);
  for (const line of movementLines) {
    const index = line.indexOf(square);

    if (index < 0) {
      continue;
    }

    if (findLineAttacker(state, line.slice(index + 1), isEnemy)) return true;
    if (findLineAttacker(state, line.slice(0, index).reverse(), isEnemy)) return true;
    if (findLineCannon(state, line.slice(index + 1), isEnemy)) return true;
    if (findLineCannon(state, line.slice(0, index).reverse(), isEnemy)) return true;
  }

  for (const piece of state.pieces) {
    if (!isEnemy(piece)) {
      continue;
    }

    if (piece.type === "horse" && horseAttacksSquare(state, piece, square)) {
      return true;
    }

    if (piece.type === "soldier" && soldierAttacksSquare(piece, square)) {
      return true;
    }
  }

  return false;
}

function findLineAttacker(state: GameState, points: PointId[], isEnemy: (piece: Piece) => boolean): boolean {
  for (const point of points) {
    const piece = pieceAt(state, point);

    if (!piece) {
      continue;
    }

    if (isEnemy(piece) && (piece.type === "chariot" || piece.type === "general")) {
      return true;
    }

    return false;
  }

  return false;
}

function findLineCannon(state: GameState, points: PointId[], isEnemy: (piece: Piece) => boolean): boolean {
  let screenFound = false;

  for (const point of points) {
    const piece = pieceAt(state, point);

    if (!screenFound) {
      if (piece) {
        screenFound = true;
      }
      continue;
    }

    if (!piece) {
      continue;
    }

    if (isEnemy(piece) && piece.type === "cannon") {
      return true;
    }

    return false;
  }

  return false;
}

function horseAttacksSquare(state: GameState, piece: Piece, square: PointId): boolean {
  const { row, col } = parsePointId(piece.position);
  const { row: targetRow, col: targetCol } = parsePointId(square);
  const rows = kingdomRows[piece.kingdom] as readonly RowLabel[];
  const rowIndex = rows.indexOf(row);
  const targetRowIndex = rows.indexOf(targetRow);

  if (rowIndex >= 0 && targetRowIndex >= 0) {
    const dr = targetRowIndex - rowIndex;
    const dc = targetCol - col;

    for (const [tDr, tDc, lDr, lDc] of [
      [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
      [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
    ]) {
      if (dr === tDr && dc === tDc) {
        const legRow = rows[rowIndex + lDr];
        const legCol = col + lDc;

        if (legRow && legCol >= 1 && legCol <= 9 && !pieceAt(state, pointId(legRow, legCol))) {
          return true;
        }
      }
    }
  }

  for (const zone of crossZones) {
    if (!zone.kingdoms.includes(piece.kingdom)) {
      continue;
    }

    const pos = zone.toCoord(piece.position);
    const target = zone.toCoord(square);

    if (!pos || !target) {
      continue;
    }

    const dx = target.x - pos.x;
    const dy = target.y - pos.y;

    for (const [tDx, tDy, lDx, lDy] of [
      [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
      [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
    ]) {
      if (dx === tDx && dy === tDy) {
        const leg = zone.fromCoord(pos.x + lDx, pos.y + lDy);

        if (leg && !pieceAt(state, leg)) {
          return true;
        }
      }
    }
  }

  return false;
}

function soldierAttacksSquare(piece: Piece, square: PointId): boolean {
  const { row, col } = parsePointId(piece.position);
  const { row: targetRow, col: targetCol } = parsePointId(square);
  const rows = kingdomRows[piece.kingdom] as readonly RowLabel[];
  const localRowIndex = rows.indexOf(row);

  if (localRowIndex < 0) {
    for (const zone of crossZones) {
      if (!zone.kingdoms.includes(piece.kingdom)) {
        continue;
      }

      const pos = zone.toCoord(piece.position);
      const target = zone.toCoord(square);

      if (!pos || !target) {
        continue;
      }

      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const fwd = forwardDelta(zone, piece.kingdom);

      if (dy === fwd && dx === 0) return true;
      if (dy === 0 && (dx === -1 || dx === 1)) return true;
    }

    return false;
  }

  const targetLocalRowIndex = rows.indexOf(targetRow);

  if (targetLocalRowIndex >= 0 && targetLocalRowIndex === localRowIndex - 1 && targetCol === col) {
    return true;
  }

  return false;
}

export function getCheckedKingdoms(state: GameState): Kingdom[] {
  return (Object.keys(kingdomRows) as Kingdom[]).filter((kingdom) => isKingdomInCheck(state, kingdom));
}

export function getPseudoLegalMoves(state: GameState, piece: Piece): PointId[] {
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

  const hostKingdom = kingdomOf(piece.position);
  if (hostKingdom !== piece.kingdom) {
    for (const move of getLocalHorseMovesInRows(state, piece, kingdomRows[hostKingdom] as readonly RowLabel[])) {
      candidates.add(move);
    }
  }

  for (const zone of crossZones) {
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
  return getLocalHorseMovesInRows(state, piece, kingdomRows[piece.kingdom] as readonly RowLabel[]);
}

function getLocalHorseMovesInRows(state: GameState, piece: Piece, rows: readonly RowLabel[]): PointId[] {
  const { row, col } = parsePointId(piece.position);
  const rowIndex = rows.indexOf(row);

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
    const targetRow = rows[targetRowIndex];
    const legRow = rows[legRowIndex];

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
