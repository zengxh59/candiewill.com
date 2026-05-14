import {
  boundaryRivers,
  boardRenderGroups,
  interKingdomEdges,
  markerPoints,
  type Kingdom,
  type PointId,
  type RowLabel,
  xLabels,
} from "../core/board";
import type { GameState } from "../core/game-state";
import type { Piece } from "../core/pieces";
import {
  type BoardGeometry,
  type ScreenPoint,
  boardPoint,
  defaultGeometry,
  labelPoint,
  localPoint,
  midpoint,
  mixPoint,
  offsetPoint,
  pointIdPosition,
  unitVector,
} from "./geometry";

export interface BoardUiState {
  currentKingdom: Kingdom;
  thinkingKingdom: Kingdom | null;
  thinkingPhase: number;
  humanKingdom: Kingdom;
  mode: "ai" | "online";
  viewRotation?: number;
}

export interface BoardAnimation {
  movingPiece: Piece;
  capturedPiece: Piece | null;
  from: ScreenPoint;
  to: ScreenPoint;
  progress: number;
}

export function drawBoard(
  canvas: HTMLCanvasElement,
  geometry: BoardGeometry = defaultGeometry,
  state?: GameState,
  uiState?: BoardUiState,
  animation?: BoardAnimation | null,
): void {
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();

  if (uiState?.viewRotation) {
    ctx.translate(geometry.center.x, geometry.center.y);
    ctx.rotate((uiState.viewRotation * Math.PI) / 180);
    ctx.translate(-geometry.center.x, -geometry.center.y);
  }

  for (const board of boardRenderGroups) {
    drawBoardLines(ctx, board.rotation, geometry);
    drawPalaceHighlight(ctx, board.rotation, geometry);
    drawPositionMarkers(ctx, board.key, board.rotation, geometry);
  }

  drawConnectionLines(ctx, geometry);

  const viewRotation = uiState?.viewRotation;

  for (const board of boardRenderGroups) {
    drawGridLabels(ctx, board.rotation, board.yLabels, geometry, viewRotation);
    drawRegionLabel(ctx, board, geometry, uiState);
  }

  drawBoundaryLabels(ctx, geometry, viewRotation);

  if (state) {
    drawMoveHighlights(ctx, state, geometry);
    drawPieces(ctx, state, geometry, animation);
    drawCaptureHighlights(ctx, state, geometry);
    drawAnimation(ctx, animation);
  }

  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, from: ScreenPoint, to: ScreenPoint): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function drawBoardLines(ctx: CanvasRenderingContext2D, angle: number, geometry: BoardGeometry): void {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;

  for (let x = 0; x <= geometry.cols; x += 1) {
    for (let y = 0; y < geometry.rows; y += 1) {
      drawLine(ctx, boardPoint(x, y, angle, geometry), boardPoint(x, y + 1, angle, geometry));
    }
  }

  for (let y = 0; y <= geometry.rows; y += 1) {
    for (let x = 0; x < geometry.cols; x += 1) {
      drawLine(ctx, boardPoint(x, y, angle, geometry), boardPoint(x + 1, y, angle, geometry));
    }
  }

  drawPalaceLines(ctx, angle, geometry);
}

function drawPalaceLines(ctx: CanvasRenderingContext2D, angle: number, geometry: BoardGeometry): void {
  drawLine(ctx, boardPoint(3, 2, angle, geometry), boardPoint(4, 3, angle, geometry));
  drawLine(ctx, boardPoint(4, 3, angle, geometry), boardPoint(5, 4, angle, geometry));
  drawLine(ctx, boardPoint(5, 2, angle, geometry), boardPoint(4, 3, angle, geometry));
  drawLine(ctx, boardPoint(4, 3, angle, geometry), boardPoint(3, 4, angle, geometry));
}

function drawPalaceHighlight(ctx: CanvasRenderingContext2D, angle: number, geometry: BoardGeometry): void {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 4;

  for (let x = 3; x <= 5; x += 1) {
    for (let y = 2; y < 4; y += 1) {
      drawLine(ctx, boardPoint(x, y, angle, geometry), boardPoint(x, y + 1, angle, geometry));
    }
  }

  for (let y = 2; y <= 4; y += 1) {
    for (let x = 3; x < 5; x += 1) {
      drawLine(ctx, boardPoint(x, y, angle, geometry), boardPoint(x + 1, y, angle, geometry));
    }
  }

  drawPalaceLines(ctx, angle, geometry);
}

function drawPositionMarker(
  ctx: CanvasRenderingContext2D,
  xIndex: number,
  yIndex: number,
  angle: number,
  geometry: BoardGeometry,
): void {
  const center = boardPoint(xIndex, yIndex, angle, geometry);
  const gap = 6;
  const length = 13;
  const corners = [
    xIndex > 0 && yIndex > 0 && [-1, -1],
    xIndex < geometry.cols && yIndex > 0 && [1, -1],
    xIndex > 0 && yIndex < geometry.rows && [-1, 1],
    xIndex < geometry.cols && yIndex < geometry.rows && [1, 1],
  ].filter(Boolean) as [number, number][];

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;

  for (const [dx, dy] of corners) {
    const rowDirection = unitVector(center, boardPoint(xIndex + dx, yIndex, angle, geometry));
    const colDirection = unitVector(center, boardPoint(xIndex, yIndex + dy, angle, geometry));
    const corner = offsetPoint(offsetPoint(center, rowDirection, gap), colDirection, gap);

    drawLine(ctx, corner, offsetPoint(corner, rowDirection, length));
    drawLine(ctx, corner, offsetPoint(corner, colDirection, length));
  }
}

function drawPositionMarkers(
  ctx: CanvasRenderingContext2D,
  kingdom: keyof typeof markerPoints,
  angle: number,
  geometry: BoardGeometry,
): void {
  const group = boardRenderGroups.find((item) => item.key === kingdom);

  if (!group) {
    return;
  }

  for (const point of markerPoints[kingdom]) {
    const rowIndex = (group.yLabels as readonly RowLabel[]).indexOf(point[0] as RowLabel);
    const colIndex = Number(point.slice(1)) - 1;

    if (rowIndex >= 0) {
      drawPositionMarker(ctx, colIndex, rowIndex, angle, geometry);
    }
  }
}

function drawConnectionLines(ctx: CanvasRenderingContext2D, geometry: BoardGeometry): void {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;

  for (const edge of interKingdomEdges) {
    drawLine(ctx, pointIdPosition(edge.from, geometry), pointIdPosition(edge.to, geometry));
  }
}

function drawGridLabels(
  ctx: CanvasRenderingContext2D,
  angle: number,
  yLabels: readonly string[],
  geometry: BoardGeometry,
  viewRotation?: number,
): void {
  ctx.fillStyle = "#000";
  ctx.font = "22px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  xLabels.forEach((label, index) => {
    const base = localPoint(index, geometry.rows, geometry);
    const position = labelPoint({ x: base.x, y: base.y + 28 }, angle, geometry);
    drawUprightText(ctx, label, position, viewRotation);
  });

  yLabels.forEach((label, index) => {
    const base = localPoint(0, index, geometry);
    const position = labelPoint({ x: base.x - 30, y: base.y }, angle, geometry);
    drawUprightText(ctx, label, position, viewRotation);
  });
}

function drawRegionLabel(
  ctx: CanvasRenderingContext2D,
  board: (typeof boardRenderGroups)[number],
  geometry: BoardGeometry,
  uiState?: BoardUiState,
): void {
  const base = localPoint(4, geometry.rows, geometry);
  const numberFivePosition = labelPoint({ x: base.x, y: base.y + 28 }, board.rotation, geometry);
  const position = {
    x: numberFivePosition.x + board.regionOffset.x,
    y: numberFivePosition.y + board.regionOffset.y + (board.key === "wei" ? 16 : 0),
  };
  const isActive = uiState?.currentKingdom === board.key;
  const isThinking = uiState?.thinkingKingdom === board.key;
  const color = pieceColorForKingdom(board.key);

  ctx.save();

  if (isActive) {
    ctx.beginPath();
    ctx.arc(position.x, position.y, isThinking ? 36 : 30, 0, Math.PI * 2);
    ctx.fillStyle = `${color}12`;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    if (isThinking) {
      const phase = uiState?.thinkingPhase ?? 0;

      ctx.beginPath();
      ctx.arc(position.x, position.y, 37, phase, phase + Math.PI * 1.35);
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  ctx.fillStyle = isActive ? color : "#000";
  ctx.font = `${isActive ? 40 : 34}px STKaiti, KaiTi, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawUprightText(ctx, board.region, position, uiState?.viewRotation);

  ctx.restore();
}

function drawUprightText(ctx: CanvasRenderingContext2D, text: string, position: ScreenPoint, viewRotation?: number): void {
  if (viewRotation) {
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate((-viewRotation * Math.PI) / 180);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(text, position.x, position.y);
  }
}

function drawVerticalText(ctx: CanvasRenderingContext2D, text: string, position: ScreenPoint, angle: number, viewRotation?: number): void {
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(angle);
  if (viewRotation) {
    ctx.rotate((-viewRotation * Math.PI) / 180);
  }
  ctx.fillStyle = "#000";
  ctx.font = "30px STKaiti, KaiTi, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const spacing = 33;
  const start = -((text.length - 1) * spacing) / 2;
  [...text].forEach((char, index) => {
    ctx.fillText(char, 0, start + index * spacing);
  });

  ctx.restore();
}

function drawBoundaryLabels(ctx: CanvasRenderingContext2D, geometry: BoardGeometry, viewRotation?: number): void {
  for (const river of boundaryRivers) {
    const outerStart = pointIdPosition(river.outerEdge[0], geometry);
    const outerEnd = pointIdPosition(river.outerEdge[1], geometry);
    const innerStart = pointIdPosition(river.innerEdge[0], geometry);
    const innerEnd = pointIdPosition(river.innerEdge[1], geometry);
    const outerMidpoint = midpoint(outerStart, outerEnd);
    const innerMidpoint = midpoint(innerStart, innerEnd);
    const position = mixPoint(outerMidpoint, innerMidpoint, 0.5);
    const directionToInner = unitVector(position, innerMidpoint);
    const angle = Math.atan2(directionToInner.y, directionToInner.x) + Math.PI / 2;

    drawVerticalText(ctx, river.label, position, angle, viewRotation);
  }
}

function drawMoveHighlights(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  geometry: BoardGeometry,
): void {
  const selectedPiece = state.pieces.find((piece) => piece.id === state.selectedPieceId);

  for (const move of state.legalMoves) {
    const targetPiece = state.pieces.find((piece) => piece.position === move);

    if (selectedPiece && targetPiece && targetPiece.controller !== selectedPiece.controller) {
      continue;
    }

    const position = pointIdPosition(move, geometry);

    ctx.beginPath();
    ctx.arc(position.x, position.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(218, 32, 32, 0.18)";
    ctx.fill();
    ctx.strokeStyle = "#d32020";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawCaptureHighlights(ctx: CanvasRenderingContext2D, state: GameState, geometry: BoardGeometry): void {
  const selectedPiece = state.pieces.find((piece) => piece.id === state.selectedPieceId);

  if (!selectedPiece) {
    return;
  }

  for (const move of state.legalMoves) {
    const targetPiece = state.pieces.find((piece) => piece.position === move);

    if (!targetPiece || targetPiece.controller === selectedPiece.controller) {
      continue;
    }

    const position = pointIdPosition(move, geometry);

    ctx.save();
    ctx.beginPath();
    ctx.arc(position.x, position.y, 28, 0, Math.PI * 2);
    ctx.strokeStyle = "#d32020";
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(position.x, position.y - 28, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#d32020";
    ctx.fill();
  }
}

function drawPieces(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  geometry: BoardGeometry,
  animation?: BoardAnimation | null,
): void {
  for (const piece of state.pieces) {
    if (piece.id === animation?.movingPiece.id || piece.id === animation?.capturedPiece?.id) {
      continue;
    }

    drawPiece(ctx, piece, piece.id === state.selectedPieceId, geometry);
  }
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  selected: boolean,
  geometry: BoardGeometry,
): void {
  const position = pointIdPosition(piece.position, geometry);
  const radius = 22;
  const color = pieceColor(piece.color);
  const outerColor = piece.defeated && piece.controller !== piece.kingdom ? pieceColorForKingdom(piece.controller) : color;
  const textColor = piece.defeated && piece.controller === piece.kingdom ? "#9a9a9a" : color;

  ctx.beginPath();
  ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.strokeStyle = piece.defeated && piece.controller === piece.kingdom ? "#c8c8c8" : outerColor;
  ctx.lineWidth = selected ? 4 : 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(position.x, position.y, radius - 5, 0, Math.PI * 2);
  ctx.strokeStyle = piece.defeated && piece.controller === piece.kingdom ? "#c8c8c8" : outerColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = piece.label.length > 1 ? "24px STKaiti, KaiTi, serif" : "28px STKaiti, KaiTi, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(piece.label, position.x, position.y + 1);
}

function drawAnimation(ctx: CanvasRenderingContext2D, animation?: BoardAnimation | null): void {
  if (!animation) {
    return;
  }

  const eased = easeOutCubic(animation.progress);
  const movingPosition = mixPoint(animation.from, animation.to, eased);

  if (animation.capturedPiece) {
    drawAnimatedPiece(ctx, animation.capturedPiece, animation.to, 1 - eased * 0.55, 1 - eased);
  }

  drawAnimatedPiece(ctx, animation.movingPiece, movingPosition, 1 + Math.sin(animation.progress * Math.PI) * 0.08, 1);
}

function drawAnimatedPiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  position: ScreenPoint,
  scale: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(position.x, position.y);
  ctx.scale(scale, scale);
  drawPieceAt(ctx, piece, { x: 0, y: 0 }, false);
  ctx.restore();
}

function drawPieceAt(ctx: CanvasRenderingContext2D, piece: Piece, position: ScreenPoint, selected: boolean): void {
  const radius = 22;
  const color = pieceColor(piece.color);
  const outerColor = piece.defeated && piece.controller !== piece.kingdom ? pieceColorForKingdom(piece.controller) : color;
  const textColor = piece.defeated && piece.controller === piece.kingdom ? "#9a9a9a" : color;

  ctx.beginPath();
  ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.strokeStyle = piece.defeated && piece.controller === piece.kingdom ? "#c8c8c8" : outerColor;
  ctx.lineWidth = selected ? 4 : 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(position.x, position.y, radius - 5, 0, Math.PI * 2);
  ctx.strokeStyle = piece.defeated && piece.controller === piece.kingdom ? "#c8c8c8" : outerColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = piece.label.length > 1 ? "24px STKaiti, KaiTi, serif" : "28px STKaiti, KaiTi, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(piece.label, position.x, position.y + 1);
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function pieceColor(color: Piece["color"]): string {
  return {
    red: "#d32020",
    blue: "#123f7a",
    green: "#14613a",
  }[color];
}

function pieceColorForKingdom(kingdom: Piece["kingdom"]): string {
  return {
    wei: "#d32020",
    wu: "#123f7a",
    shu: "#14613a",
  }[kingdom];
}
