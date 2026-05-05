import { type PointId, type RowLabel, boardRenderGroups, parsePointId } from "../core/board";

const deg = Math.PI / 180;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface BoardGeometry {
  cell: number;
  cols: number;
  rows: number;
  center: ScreenPoint;
  gap: number;
  sideVerticalSpan: number;
  originalRectHeight: number;
  axisLength: number;
  centerLift: number;
  bottomLeft: ScreenPoint;
  bottomRight: ScreenPoint;
  leftStep: ScreenPoint;
  rightStep: ScreenPoint;
}

export const defaultGeometry: BoardGeometry = createGeometry();

export function createGeometry(): BoardGeometry {
  const geometry = {
    cell: 56,
    cols: 8,
    rows: 4,
    center: { x: 550, y: 470 },
    gap: 85,
  } as BoardGeometry;

  geometry.sideVerticalSpan = Math.sin(120 * deg) * geometry.cell * geometry.rows;
  geometry.originalRectHeight = geometry.cell * geometry.rows;
  geometry.axisLength = geometry.originalRectHeight * 1.5;
  geometry.centerLift = geometry.axisLength - geometry.sideVerticalSpan;
  geometry.bottomLeft = { x: (-geometry.cols * geometry.cell) / 2, y: geometry.axisLength };
  geometry.bottomRight = { x: (geometry.cols * geometry.cell) / 2, y: geometry.axisLength };
  geometry.leftStep = {
    x: Math.cos(120 * deg) * geometry.cell,
    y: -Math.sin(120 * deg) * geometry.cell,
  };
  geometry.rightStep = {
    x: -Math.cos(120 * deg) * geometry.cell,
    y: -Math.sin(120 * deg) * geometry.cell,
  };

  return geometry;
}

export function localPoint(xIndex: number, yIndex: number, geometry = defaultGeometry): ScreenPoint {
  const fromBottom = geometry.rows - yIndex;
  const left = {
    x: geometry.bottomLeft.x + geometry.leftStep.x * fromBottom,
    y: geometry.bottomLeft.y + geometry.leftStep.y * fromBottom,
  };
  const right = {
    x: geometry.bottomRight.x + geometry.rightStep.x * fromBottom,
    y: geometry.bottomRight.y + geometry.rightStep.y * fromBottom,
  };
  const ratio = xIndex / geometry.cols;
  const centerPull = 1 - Math.abs(xIndex - geometry.cols / 2) / (geometry.cols / 2);
  const topPull = fromBottom / geometry.rows;
  const lift = geometry.centerLift * centerPull * topPull;

  return {
    x: left.x + (right.x - left.x) * ratio,
    y: left.y + (right.y - left.y) * ratio - lift,
  };
}

export function rotate(point: ScreenPoint, angle: number): ScreenPoint {
  const radians = angle * deg;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function boardPoint(xIndex: number, yIndex: number, angle: number, geometry = defaultGeometry): ScreenPoint {
  const local = localPoint(xIndex, yIndex, geometry);
  const shifted = { x: local.x, y: local.y + geometry.gap };
  const rotated = rotate(shifted, angle);

  return {
    x: geometry.center.x + rotated.x,
    y: geometry.center.y + rotated.y,
  };
}

export function labelPoint(local: ScreenPoint, angle: number, geometry = defaultGeometry): ScreenPoint {
  const shifted = { x: local.x, y: local.y + geometry.gap };
  const rotated = rotate(shifted, angle);

  return {
    x: geometry.center.x + rotated.x,
    y: geometry.center.y + rotated.y,
  };
}

export function pointIdPosition(pointId: PointId, geometry = defaultGeometry): ScreenPoint {
  const { row, col } = parsePointId(pointId);
  const board = boardRenderGroups.find((group) => {
    return (group.yLabels as readonly RowLabel[]).includes(row);
  });

  if (!board) {
    throw new Error(`Unknown row for point: ${pointId}`);
  }

  const yIndex = (board.yLabels as readonly RowLabel[]).indexOf(row);
  return boardPoint(col - 1, yIndex, board.rotation, geometry);
}

export function unitVector(from: ScreenPoint, to: ScreenPoint): ScreenPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  return {
    x: dx / length,
    y: dy / length,
  };
}

export function offsetPoint(origin: ScreenPoint, vector: ScreenPoint, distance: number): ScreenPoint {
  return {
    x: origin.x + vector.x * distance,
    y: origin.y + vector.y * distance,
  };
}

export function midpoint(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export function mixPoint(a: ScreenPoint, b: ScreenPoint, ratio: number): ScreenPoint {
  return {
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio,
  };
}

export function hitTestBoardPoint(
  x: number,
  y: number,
  options: { radius?: number; geometry?: BoardGeometry } = {},
): PointId | null {
  const radius = options.radius ?? 22;
  const geometry = options.geometry ?? defaultGeometry;
  let nearestId: PointId | null = null;
  let nearestDistance = Infinity;

  for (const group of boardRenderGroups) {
    group.yLabels.forEach((row, yIndex) => {
      for (let col = 1; col <= 9; col += 1) {
        const position = boardPoint(col - 1, yIndex, group.rotation, geometry);
        const distance = Math.hypot(position.x - x, position.y - y);
        const id = `${row}${col}` as PointId;

        if (distance <= radius && distance < nearestDistance) {
          nearestId = id;
          nearestDistance = distance;
        }
      }
    });
  }

  return nearestId;
}
