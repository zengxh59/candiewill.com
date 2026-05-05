import {
  type BoardEdge,
  type BoardPoint,
  type EdgeType,
  type Kingdom,
  type PointId,
  type RowLabel,
  getPalaceBounds,
  interKingdomEdges,
  kingdomOf,
  kingdomRows,
  markerPoints,
  palaceEdges,
  pointId,
  xLabels,
} from "./board";

export interface BoardGraph {
  nodes: Map<PointId, BoardPoint>;
  edges: BoardEdge[];
  neighbors: Map<PointId, PointId[]>;
}

export function createBoardGraph(): BoardGraph {
  const nodes = createBoardPoints();
  const edges = [
    ...createNormalEdges(),
    ...Object.values(palaceEdges).flat(),
    ...interKingdomEdges,
  ];
  const neighbors = createNeighborMap(nodes, edges);

  return { nodes, edges, neighbors };
}

export function getEdgeType(graph: BoardGraph, from: PointId, to: PointId): EdgeType | null {
  const edge = graph.edges.find((item) => {
    return (item.from === from && item.to === to) || (item.from === to && item.to === from);
  });

  return edge?.type ?? null;
}

function createBoardPoints(): Map<PointId, BoardPoint> {
  const nodes = new Map<PointId, BoardPoint>();

  for (const [kingdom, rows] of Object.entries(kingdomRows) as [Kingdom, readonly RowLabel[]][]) {
    for (const row of rows) {
      for (const colLabel of xLabels) {
        const col = Number(colLabel);
        const id = pointId(row, col);

        nodes.set(id, {
          id,
          row,
          col,
          kingdom,
          isPalace: isPalacePoint(kingdom, row, col),
          marker: markerPoints[kingdom].includes(id) ? markerType(row, kingdom) : undefined,
        });
      }
    }
  }

  return nodes;
}

function createNormalEdges(): BoardEdge[] {
  const edges: BoardEdge[] = [];
  const allRows = Object.values(kingdomRows).flat();

  for (const row of allRows) {
    for (let col = 1; col < 9; col += 1) {
      edges.push({ from: pointId(row, col), to: pointId(row, col + 1), type: "normal" });
    }
  }

  for (const rows of Object.values(kingdomRows)) {
    for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
      for (let col = 1; col <= 9; col += 1) {
        edges.push({
          from: pointId(rows[rowIndex], col),
          to: pointId(rows[rowIndex + 1], col),
          type: "normal",
        });
      }
    }
  }

  return edges;
}

function createNeighborMap(nodes: Map<PointId, BoardPoint>, edges: BoardEdge[]): Map<PointId, PointId[]> {
  const neighbors = new Map<PointId, PointId[]>();

  for (const id of nodes.keys()) {
    neighbors.set(id, []);
  }

  for (const edge of edges) {
    neighbors.get(edge.from)?.push(edge.to);
    neighbors.get(edge.to)?.push(edge.from);
  }

  return neighbors;
}

function isPalacePoint(kingdom: Kingdom, row: RowLabel, col: number): boolean {
  const bounds = getPalaceBounds(kingdom);

  return bounds.rows.includes(row) && bounds.cols.includes(col as 4 | 5 | 6);
}

function markerType(row: RowLabel, kingdom: Kingdom): "soldier" | "cannon" {
  const rows = kingdomRows[kingdom];

  return row === rows[1] ? "soldier" : "cannon";
}

export const boardGraph = createBoardGraph();
export const allPointIds = [...boardGraph.nodes.keys()];
export const allEdges = boardGraph.edges;
export const kingdomForPoint = kingdomOf;
