import { describe, expect, it } from "vitest";
import type { GameState } from "./game-state";
import { createInitialGameState, pieceAt, updatePiecePosition } from "./game-state";
import { getLegalMoves } from "./moves";
import type { Piece } from "./pieces";

describe("wei initial pieces and moves", () => {
  it("places Wei pieces on the standard starting points", () => {
    const state = createInitialGameState();

    expect(state.pieces).toHaveLength(48);
    expect(pieceAt(state, "E5")?.label).toBe("魏");
    expect(pieceAt(state, "B1")?.label).toBe("兵");
    expect(pieceAt(state, "C2")?.label).toBe("炮");
    expect(pieceAt(state, "J5")?.label).toBe("吴");
    expect(pieceAt(state, "G1")?.label).toBe("卒");
    expect(pieceAt(state, "O5")?.label).toBe("蜀");
    expect(pieceAt(state, "L1")?.label).toBe("兵");
  });

  it("lets the Wei general move inside the palace", () => {
    const state = createInitialGameState();
    const general = pieceAt(state, "E5");

    expect(general).not.toBeNull();
    expect(getLegalMoves(state, general!).sort()).toEqual(["D5"]);
  });

  it("blocks chariots with friendly pieces", () => {
    const state = createInitialGameState();
    const chariot = pieceAt(state, "E1");

    expect(chariot).not.toBeNull();
    expect(getLegalMoves(state, chariot!)).toEqual(["D1", "C1"]);
  });

  it("uses horse-leg blocking", () => {
    const state = createInitialGameState();
    const horse = pieceAt(state, "E2");

    expect(horse).not.toBeNull();
    expect(getLegalMoves(state, horse!).sort()).toEqual(["C1", "C3"]);
  });

  it("moves soldiers toward the center before crossing", () => {
    const state = createInitialGameState();
    const soldier = pieceAt(state, "B5");

    expect(soldier).not.toBeNull();
    expect(getLegalMoves(state, soldier!)).toEqual(["A5"]);
  });

  it("updates a moved piece position", () => {
    const state = createInitialGameState();
    const next = updatePiecePosition(state, "wei-soldier-5", "A5");

    expect(pieceAt(next, "B5")).toBeNull();
    expect(pieceAt(next, "A5")?.id).toBe("wei-soldier-5");
  });

  it("lets soldiers cross boundary rivers directly from the center row", () => {
    const state = onePieceState(piece("soldier", "soldier", "兵", "A5"));

    expect(getLegalMoves(state, state.pieces[0]).sort()).toEqual(["A4", "A6", "F5", "K5"]);
  });

  it("lets chariots continue through cross-kingdom files", () => {
    const state = onePieceState(piece("chariot", "chariot", "车", "A3"));

    expect(getLegalMoves(state, state.pieces[0])).toEqual([
      "A4",
      "A5",
      "A6",
      "A7",
      "A8",
      "A9",
      "A2",
      "A1",
      "B3",
      "C3",
      "D3",
      "E3",
      "F7",
      "G7",
      "H7",
      "I7",
      "J7",
    ]);
  });

  it("lets horses jump across boundary rivers", () => {
    const state = onePieceState(piece("horse", "horse", "马", "A5"));

    expect(getLegalMoves(state, state.pieces[0]).sort()).toEqual(["B3", "B7", "C4", "C6", "F7", "G6", "K3", "L4"]);
  });

  it("lets cannons use a cross-kingdom screen for captures", () => {
    const state: GameState = {
      currentKingdom: "wei",
      selectedPieceId: null,
      legalMoves: [],
      checkedKingdoms: [],
      winner: null,
      lastMoveMessage: null,
      defeatedKingdoms: [],
      options: { defeatedPieceMode: "remove", defeatCondition: "capture" },
      pieces: [
        piece("cannon", "cannon", "炮", "A3"),
        piece("screen", "soldier", "兵", "F7"),
        { ...piece("target", "soldier", "兵", "G7"), kingdom: "wu", controller: "wu", color: "blue" },
      ],
    };

    expect(getLegalMoves(state, state.pieces[0])).toContain("G7");
    expect(getLegalMoves(state, state.pieces[0])).not.toContain("F7");
  });
});

function onePieceState(piece: Piece): GameState {
  return {
    currentKingdom: "wei",
    selectedPieceId: null,
    legalMoves: [],
    checkedKingdoms: [],
    winner: null,
    lastMoveMessage: null,
    defeatedKingdoms: [],
    options: { defeatedPieceMode: "remove", defeatCondition: "capture" },
    pieces: [piece],
  };
}

function piece(id: string, type: Piece["type"], label: string, position: Piece["position"]): Piece {
  return {
    id,
    type,
    label,
    position,
    kingdom: "wei",
    controller: "wei",
    color: "red",
    defeated: false,
    blocksMovement: true,
  };
}
