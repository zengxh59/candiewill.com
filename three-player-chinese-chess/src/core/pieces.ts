import type { Kingdom, PointId } from "./board";

export type PieceType = "general" | "advisor" | "elephant" | "horse" | "chariot" | "cannon" | "soldier";
export type PieceColor = "red" | "blue" | "green";

export interface Piece {
  id: string;
  type: PieceType;
  kingdom: Kingdom;
  color: PieceColor;
  label: string;
  position: PointId;
  controller: Kingdom;
  defeated: boolean;
  blocksMovement: boolean;
}

export function createInitialPieces(): Piece[] {
  return [
    ...createKingdomPieces({
      kingdom: "wei",
      color: "red",
      generalLabel: "魏",
      soldierLabel: "兵",
      backRow: "E",
      cannonRow: "C",
      soldierRow: "B",
    }),
    ...createKingdomPieces({
      kingdom: "wu",
      color: "blue",
      generalLabel: "吴",
      soldierLabel: "卒",
      backRow: "J",
      cannonRow: "H",
      soldierRow: "G",
    }),
    ...createKingdomPieces({
      kingdom: "shu",
      color: "green",
      generalLabel: "蜀",
      soldierLabel: "兵",
      backRow: "O",
      cannonRow: "M",
      soldierRow: "L",
    }),
  ];
}

function createKingdomPieces(config: {
  kingdom: Kingdom;
  color: PieceColor;
  generalLabel: string;
  soldierLabel: string;
  backRow: string;
  cannonRow: string;
  soldierRow: string;
}): Piece[] {
  const backRank = [
    ["chariot-left", "chariot", "车", 1],
    ["horse-left", "horse", "马", 2],
    ["elephant-left", "elephant", "相", 3],
    ["advisor-left", "advisor", "士", 4],
    ["general", "general", config.generalLabel, 5],
    ["advisor-right", "advisor", "士", 6],
    ["elephant-right", "elephant", "相", 7],
    ["horse-right", "horse", "马", 8],
    ["chariot-right", "chariot", "车", 9],
  ] as const;

  return [
    ...backRank.map(([id, type, label, col]) => {
      return piece(config, id, type, label, `${config.backRow}${col}` as PointId);
    }),
    piece(config, "cannon-left", "cannon", "炮", `${config.cannonRow}2` as PointId),
    piece(config, "cannon-right", "cannon", "炮", `${config.cannonRow}8` as PointId),
    ...[1, 3, 5, 7, 9].map((col) => {
      return piece(config, `soldier-${col}`, "soldier", config.soldierLabel, `${config.soldierRow}${col}` as PointId);
    }),
  ];
}

function piece(
  config: { kingdom: Kingdom; color: PieceColor },
  id: string,
  type: PieceType,
  label: string,
  position: PointId,
): Piece {
  return {
    id: `${config.kingdom}-${id}`,
    type,
    kingdom: config.kingdom,
    controller: config.kingdom,
    color: config.color,
    label,
    position,
    defeated: false,
    blocksMovement: true,
  };
}
