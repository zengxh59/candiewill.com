import { describe, expect, it } from "vitest";
import { chooseAiMove } from "./ai";
import { createInitialGameState, type GameState } from "./game-state";
import { getCheckedKingdoms } from "./moves";
import type { Piece } from "./pieces";
import { applyMove } from "./rules";

describe("AI player", () => {
  it("prioritizes capturing a general when available", () => {
    const state = stateWith(
      [
        piece("wu-chariot", "chariot", "车", "F5", "wu"),
        piece("wu-general", "general", "吴", "J4", "wu"),
        piece("wei-general", "general", "魏", "A5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
    );

    expect(chooseAiMove(state, "wu")).toMatchObject({
      pieceId: "wu-chariot",
      target: "A5",
    });
  });

  it("prefers moves that do not leave its own general in check", () => {
    const state = stateWith(
      [
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-chariot", "chariot", "车", "F4", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
    );
    const move = chooseAiMove(state, "wu");

    expect(move).not.toBeNull();

    const next = applyMove(state, move!.pieceId, move!.target);

    expect(getCheckedKingdoms(next)).not.toContain("wu");
  });

  it("avoids exposed equal-value cannon trades in the opening", () => {
    const state = stateWith(
      [
        piece("wu-cannon", "cannon", "炮", "F1", "wu"),
        piece("wu-screen", "soldier", "卒", "F2", "wu"),
        piece("wu-horse", "horse", "马", "J2", "wu"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-horse", "horse", "马", "F3", "wei"),
        piece("wei-chariot", "chariot", "车", "F4", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
    );

    expect(chooseAiMove(state, "wu")).not.toMatchObject({
      pieceId: "wu-cannon",
      target: "F3",
    });
  });

  it("uses the general to capture a safe intruder in its own palace", () => {
    const state = stateWith(
      [
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-cannon", "cannon", "炮", "J4", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
    );

    expect(chooseAiMove(state, "wu")).toMatchObject({
      pieceId: "wu-general",
      target: "J4",
    });
  });

  it("chooses the first Shu response quickly after Wei opens", () => {
    const state = applyMove(createInitialGameState(), "wei-soldier-5", "A5");
    const startedAt = performance.now();
    const move = chooseAiMove(state, "shu");

    expect(move).not.toBeNull();
    expect(performance.now() - startedAt).toBeLessThan(300);
  });
});

function stateWith(pieces: Piece[], currentKingdom: GameState["currentKingdom"]): GameState {
  return {
    pieces,
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom,
    checkedKingdoms: [],
    winner: null,
    lastMoveMessage: null,
    defeatedKingdoms: [],
    options: { defeatedPieceMode: "remove", defeatCondition: "capture" },
  };
}

function piece(
  id: string,
  type: Piece["type"],
  label: string,
  position: Piece["position"],
  kingdom: Piece["kingdom"],
): Piece {
  return {
    id,
    type,
    label,
    position,
    kingdom,
    controller: kingdom,
    color: kingdom === "wei" ? "red" : kingdom === "wu" ? "blue" : "green",
    defeated: false,
    blocksMovement: true,
  };
}
