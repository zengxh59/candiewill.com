import { describe, expect, it } from "vitest";
import { boundaryRivers, interKingdomEdges, markerPoints, palaceEdges } from "./board";
import { boardGraph, getEdgeType } from "./graph";

describe("board graph", () => {
  it("creates all board points", () => {
    expect(boardGraph.nodes.size).toBe(135);
  });

  it("creates normal, palace, and inter-kingdom edges", () => {
    const normalEdges = boardGraph.edges.filter((edge) => edge.type === "normal");
    const palaceEdgeCount = boardGraph.edges.filter((edge) => edge.type === "palace").length;
    const interKingdomEdgeCount = boardGraph.edges.filter((edge) => edge.type === "inter_kingdom").length;

    expect(normalEdges).toHaveLength(228);
    expect(palaceEdgeCount).toBe(12);
    expect(interKingdomEdgeCount).toBe(6);
    expect(boardGraph.edges).toHaveLength(246);
  });

  it("marks palace diagonals as graph edges", () => {
    const allPalaceEdges = Object.values(palaceEdges).flat();

    for (const edge of allPalaceEdges) {
      expect(getEdgeType(boardGraph, edge.from, edge.to)).toBe("palace");
    }
  });

  it("marks all inter-kingdom lines as graph edges", () => {
    for (const edge of interKingdomEdges) {
      expect(getEdgeType(boardGraph, edge.from, edge.to)).toBe("inter_kingdom");
    }
  });

  it("keeps marker points grouped by kingdom", () => {
    expect(markerPoints.wei).toEqual(["B1", "B3", "B5", "B7", "B9", "C2", "C8"]);
    expect(markerPoints.wu).toEqual(["G1", "G3", "G5", "G7", "G9", "H2", "H8"]);
    expect(markerPoints.shu).toEqual(["L1", "L3", "L5", "L7", "L9", "M2", "M8"]);
  });

  it("defines three boundary rivers", () => {
    expect(boundaryRivers.map((river) => river.label)).toEqual(["赤壁", "荆州", "岐山"]);
  });
});
