export const xLabels = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export const kingdomRows = {
  wei: ["A", "B", "C", "D", "E"],
  wu: ["F", "G", "H", "I", "J"],
  shu: ["K", "L", "M", "N", "O"],
} as const;

export type Kingdom = keyof typeof kingdomRows;
export type RowLabel = (typeof kingdomRows)[Kingdom][number];
export type ColLabel = (typeof xLabels)[number];
export type PointId = `${RowLabel}${ColLabel}`;
export type EdgeType = "normal" | "palace" | "inter_kingdom";

export interface BoardPoint {
  id: PointId;
  row: RowLabel;
  col: number;
  kingdom: Kingdom;
  isPalace: boolean;
  marker?: "soldier" | "cannon";
}

export interface BoardEdge {
  from: PointId;
  to: PointId;
  type: EdgeType;
}

export interface BoundaryRiver {
  id: "chibi" | "jingzhou" | "qishan";
  label: string;
  kingdoms: [Kingdom, Kingdom];
  outerEdge: [PointId, PointId];
  innerEdge: [PointId, PointId];
  boundaryPoints: PointId[];
}

export const boardRenderGroups = [
  {
    key: "wei",
    rotation: 0,
    yLabels: kingdomRows.wei,
    region: "魏",
    regionOffset: { x: 0, y: 38 },
  },
  {
    key: "wu",
    rotation: 120,
    yLabels: kingdomRows.wu,
    region: "吴",
    regionOffset: { x: -42, y: -38 },
  },
  {
    key: "shu",
    rotation: -120,
    yLabels: kingdomRows.shu,
    region: "蜀",
    regionOffset: { x: 42, y: -38 },
  },
] as const;

export const markerPoints: Record<Kingdom, PointId[]> = {
  wei: ["B1", "B3", "B5", "B7", "B9", "C2", "C8"],
  wu: ["G1", "G3", "G5", "G7", "G9", "H2", "H8"],
  shu: ["L1", "L3", "L5", "L7", "L9", "M2", "M8"],
};

export const palaceEdges: Record<Kingdom, BoardEdge[]> = {
  wei: palaceEdgeSet("C", "D", "E"),
  wu: palaceEdgeSet("H", "I", "J"),
  shu: palaceEdgeSet("M", "N", "O"),
};

export const interKingdomEdges: BoardEdge[] = [
  { from: "A1", to: "F9", type: "inter_kingdom" },
  { from: "F1", to: "K9", type: "inter_kingdom" },
  { from: "K1", to: "A9", type: "inter_kingdom" },
  { from: "A5", to: "F5", type: "inter_kingdom" },
  { from: "F5", to: "K5", type: "inter_kingdom" },
  { from: "K5", to: "A5", type: "inter_kingdom" },
];

export const boundaryRivers: BoundaryRiver[] = [
  {
    id: "chibi",
    label: "赤壁",
    kingdoms: ["wei", "wu"],
    outerEdge: ["A1", "F9"],
    innerEdge: ["A5", "F5"],
    boundaryPoints: ["A1", "A5", "F5", "F9"],
  },
  {
    id: "jingzhou",
    label: "荆州",
    kingdoms: ["wu", "shu"],
    outerEdge: ["F1", "K9"],
    innerEdge: ["F5", "K5"],
    boundaryPoints: ["F1", "F5", "K5", "K9"],
  },
  {
    id: "qishan",
    label: "岐山",
    kingdoms: ["shu", "wei"],
    outerEdge: ["K1", "A9"],
    innerEdge: ["K5", "A5"],
    boundaryPoints: ["K1", "K5", "A5", "A9"],
  },
];

export function pointId(row: RowLabel, col: number): PointId {
  return `${row}${col}` as PointId;
}

export function kingdomOfRow(row: RowLabel): Kingdom {
  for (const [kingdom, rows] of Object.entries(kingdomRows) as [Kingdom, readonly RowLabel[]][]) {
    if (rows.includes(row)) {
      return kingdom;
    }
  }

  throw new Error(`Unknown row label: ${row}`);
}

export function kingdomOf(point: PointId): Kingdom {
  return kingdomOfRow(point[0] as RowLabel);
}

export function parsePointId(point: PointId): { row: RowLabel; col: number } {
  return {
    row: point[0] as RowLabel,
    col: Number(point.slice(1)),
  };
}

export function getPalaceBounds(kingdom: Kingdom): { rows: readonly RowLabel[]; cols: readonly [4, 5, 6] } {
  const rows = kingdomRows[kingdom];

  return {
    rows: rows.slice(2, 5) as RowLabel[],
    cols: [4, 5, 6],
  };
}

function palaceEdgeSet(top: RowLabel, middle: RowLabel, bottom: RowLabel): BoardEdge[] {
  return [
    { from: pointId(top, 4), to: pointId(middle, 5), type: "palace" },
    { from: pointId(middle, 5), to: pointId(bottom, 6), type: "palace" },
    { from: pointId(top, 6), to: pointId(middle, 5), type: "palace" },
    { from: pointId(middle, 5), to: pointId(bottom, 4), type: "palace" },
  ];
}
