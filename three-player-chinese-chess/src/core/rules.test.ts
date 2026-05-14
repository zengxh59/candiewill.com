import { describe, expect, it } from "vitest";
import type { GameState } from "./game-state";
import { createInitialGameState } from "./game-state";
import { getCheckedKingdoms, getLegalMoves, getPseudoLegalMoves } from "./moves";
import type { Piece } from "./pieces";
import { applyMove, resignKingdom } from "./rules";

describe("turns, checks, and wins", () => {
  it("moves in counterclockwise order: Wei -> Shu -> Wu", () => {
    const state = createInitialGameState();
    const afterWei = applyMove(state, "wei-soldier-5", "A5");
    const afterShu = applyMove(afterWei, "shu-soldier-5", "K5");

    expect(afterWei.currentKingdom).toBe("shu");
    expect(afterShu.currentKingdom).toBe("wu");
  });

  it("rejects moves made by a kingdom that is not on turn", () => {
    const state = createInitialGameState();

    expect(() => applyMove(state, "shu-soldier-5", "K5")).toThrow("not shu's turn");
  });

  it("rejects soldier sideways movement before crossing a boundary river", () => {
    const state = applyMove(createInitialGameState(), "wei-soldier-5", "A5");

    expect(() => applyMove({ ...state, currentKingdom: "wei" }, "wei-soldier-5", "A4")).toThrow("Illegal move");
    expect(() => applyMove({ ...state, currentKingdom: "wei" }, "wei-soldier-5", "A6")).toThrow("Illegal move");
  });

  it("captures a non-general piece and advances the turn", () => {
    const state = stateWith([
      piece("wei-chariot", "chariot", "车", "A5", "wei"),
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
      piece("wu-soldier", "soldier", "卒", "F5", "wu"),
    ]);
    const next = applyMove(state, "wei-chariot", "F5");

    expect(next.pieces.some((item) => item.id === "wu-soldier")).toBe(false);
    expect(next.pieces.find((item) => item.id === "wei-chariot")?.position).toBe("F5");
    expect(next.currentKingdom).toBe("shu");
    expect(next.winner).toBeNull();
  });

  it("detects check against a general", () => {
    const state = stateWith([
      piece("wei-chariot", "chariot", "车", "A5", "wei"),
      piece("wu-general", "general", "吴", "F5", "wu"),
    ]);

    expect(getCheckedKingdoms(state)).toEqual(["wu"]);
  });

  it("wins immediately when a general is captured", () => {
    const state = stateWith([
      piece("wei-chariot", "chariot", "车", "A5", "wei"),
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wu-general", "general", "吴", "F5", "wu"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
    ]);
    const next = applyMove(state, "wei-chariot", "F5");

    expect(next.winner).toBeNull();
    expect(next.defeatedKingdoms).toEqual(["wu"]);
    expect(next.pieces.some((item) => item.id === "wu-general")).toBe(false);
  });

  it("removes all defeated pieces in remove mode", () => {
    const state = stateWith([
      piece("wei-chariot", "chariot", "车", "A5", "wei"),
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wu-general", "general", "吴", "F5", "wu"),
      piece("wu-soldier", "soldier", "卒", "G5", "wu"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
    ]);
    const next = applyMove(state, "wei-chariot", "F5");

    expect(next.pieces.some((item) => item.kingdom === "wu")).toBe(false);
    expect(next.currentKingdom).toBe("shu");
  });

  it("keeps defeated pieces as gray blockers in block mode", () => {
    const state = {
      ...stateWith([
        piece("wei-chariot", "chariot", "车", "A5", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wu-general", "general", "吴", "F5", "wu"),
        piece("wu-soldier", "soldier", "卒", "G5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ]),
      options: { defeatedPieceMode: "block" as const, defeatCondition: "capture" as const },
    };
    const next = applyMove(state, "wei-chariot", "F5");
    const defeatedSoldier = next.pieces.find((item) => item.id === "wu-soldier")!;

    expect(defeatedSoldier.defeated).toBe(true);
    expect(defeatedSoldier.blocksMovement).toBe(true);
    expect(defeatedSoldier.controller).toBe("wu");
  });

  it("lets the captor take over defeated pieces in takeover mode", () => {
    const state = {
      ...stateWith([
        piece("wei-chariot", "chariot", "车", "A5", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wu-general", "general", "吴", "F5", "wu"),
        piece("wu-soldier", "soldier", "卒", "G5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ]),
      options: { defeatedPieceMode: "takeover" as const, defeatCondition: "capture" as const },
    };
    const next = applyMove(state, "wei-chariot", "F5");
    const defeatedSoldier = next.pieces.find((item) => item.id === "wu-soldier")!;

    expect(defeatedSoldier.kingdom).toBe("wu");
    expect(defeatedSoldier.controller).toBe("wei");
    expect(defeatedSoldier.color).toBe("blue");
    expect(defeatedSoldier.defeated).toBe(true);
  });

  it("filters out moves that leave the own general in check", () => {
    const state = stateWith([
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wei-advisor", "advisor", "士", "D5", "wei"),
      piece("shu-chariot", "chariot", "车", "A5", "shu"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
    ]);
    const advisor = state.pieces.find((item) => item.id === "wei-advisor")!;
    const general = state.pieces.find((item) => item.id === "wei-general")!;

    expect(() => applyMove(state, "wei-advisor", "C4")).toThrow("Illegal move");
    expect(getLegalMoves(state, advisor)).not.toContain("C4");
    expect(getLegalMoves(state, general)).toEqual(expect.arrayContaining(["E4"]));
  });

  it("allows moves that block or resolve check", () => {
    const state = stateWith([
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wei-chariot", "chariot", "车", "D1", "wei"),
      piece("shu-chariot", "chariot", "车", "A5", "shu"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
    ]);
    const chariot = state.pieces.find((item) => item.id === "wei-chariot")!;

    expect(getLegalMoves(state, chariot)).toContain("D5");
  });

  it("lets Wu move when Shu is checking Wei", () => {
    const state = stateWith([
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("shu-chariot", "chariot", "车", "K5", "shu"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
      piece("wu-chariot", "chariot", "车", "J1", "wu"),
    ]);
    const wuTurnState: GameState = {
      ...state,
      currentKingdom: "wu",
      checkedKingdoms: getCheckedKingdoms(state),
    };
    const wuChariot = wuTurnState.pieces.find((item) => item.id === "wu-chariot")!;

    expect(wuTurnState.checkedKingdoms).toEqual(["wei"]);
    expect(getLegalMoves(wuTurnState, wuChariot).length).toBeGreaterThan(0);
    expect(() => applyMove(wuTurnState, "wu-chariot", "I1")).not.toThrow();
  });

  it("defeats a kingdom by checkmate when that option is enabled", () => {
    const state = {
      ...stateWith([
        piece("wei-chariot", "chariot", "车", "A4", "wei"),
        piece("wei-general", "general", "魏", "E4", "wei"),
        piece("wu-general", "general", "吴", "F5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ]),
      options: { defeatedPieceMode: "remove" as const, defeatCondition: "checkmate" as const },
    };
    const next = applyMove(state, "wei-chariot", "A5");

    expect(next.defeatedKingdoms).toContain("wu");
    expect(next.pieces.some((item) => item.kingdom === "wu")).toBe(false);
  });

  it("defeats a checkmated kingdom even when capture condition is selected", () => {
    const state = {
      ...stateWith([
        piece("wei-chariot", "chariot", "车", "A4", "wei"),
        piece("wei-general", "general", "魏", "E4", "wei"),
        piece("wu-general", "general", "吴", "F5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ]),
      options: { defeatedPieceMode: "remove" as const, defeatCondition: "capture" as const },
    };
    const next = applyMove(state, "wei-chariot", "A5");

    expect(next.defeatedKingdoms).toEqual(["wu"]);
  });

  it("defeats the resigning kingdom and advances its turn", () => {
    const state = stateWith([
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
    ]);
    const next = resignKingdom(state, "wei");

    expect(next.defeatedKingdoms).toEqual(["wei"]);
    expect(next.currentKingdom).toBe("shu");
    expect(next.winner).toBeNull();
    expect(next.lastMoveMessage).toBe("魏认输出局");
  });

  it("declares the last active kingdom as winner after resignation", () => {
    const state = {
      ...stateWith([
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
        piece("wu-general", "general", "吴", "J4", "wu"),
      ]),
      defeatedKingdoms: ["wei" as const],
      currentKingdom: "shu" as const,
    };
    const next = resignKingdom(state, "shu");

    expect(next.defeatedKingdoms).toEqual(["wei", "shu"]);
    expect(next.winner).toBe("wu");
  });
});

function stateWith(pieces: Piece[]): GameState {
  return {
    pieces,
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom: "wei",
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

describe("checkmate detection regression", () => {
  it("defeats kingdom by checkmate and advances turn correctly", () => {
    const state = {
      ...stateWith([
        piece("wei-chariot", "chariot", "车", "A4", "wei"),
        piece("wei-general", "general", "魏", "E4", "wei"),
        piece("wu-general", "general", "吴", "F5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ]),
      options: { defeatedPieceMode: "remove" as const, defeatCondition: "capture" as const },
    };
    const next = applyMove(state, "wei-chariot", "A5");

    expect(next.defeatedKingdoms).toContain("wu");
    expect(next.currentKingdom).toBe("shu");
    expect(next.winner).toBeNull();
    expect(next.lastMoveMessage).toContain("出局");
  });

  it("declares winner when only one kingdom remains after checkmate", () => {
    const state = {
      ...stateWith([
        piece("wei-chariot", "chariot", "车", "A4", "wei"),
        piece("wei-general", "general", "魏", "E4", "wei"),
        piece("wu-general", "general", "吴", "F5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ]),
      options: { defeatedPieceMode: "remove" as const, defeatCondition: "capture" as const },
      defeatedKingdoms: ["shu" as const],
    };
    const next = applyMove(state, "wei-chariot", "A5");

    expect(next.defeatedKingdoms).toContain("wu");
    expect(next.winner).toBe("wei");
  });
});

describe("legal move check filtering", () => {
  it("does not allow moving a blocking piece when it exposes the general", () => {
    const state = stateWith([
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wei-advisor", "advisor", "士", "D5", "wei"),
      piece("shu-chariot", "chariot", "车", "A5", "shu"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
    ]);
    const advisor = state.pieces.find((p) => p.id === "wei-advisor")!;

    expect(getLegalMoves(state, advisor)).not.toContain("C4");
  });

  it("does not allow exposing general to flying general", () => {
    const state = stateWith([
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wei-advisor", "advisor", "士", "E4", "wei"),
      piece("shu-general", "general", "蜀", "O5", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
    ]);
    const advisor = state.pieces.find((p) => p.id === "wei-advisor")!;

    expect(getLegalMoves(state, advisor)).not.toContain("D3");
  });

  it("allows blocking check with another piece", () => {
    const state = stateWith([
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wei-chariot", "chariot", "车", "D1", "wei"),
      piece("shu-chariot", "chariot", "车", "A5", "shu"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
    ]);
    const chariot = state.pieces.find((p) => p.id === "wei-chariot")!;
    const general = state.pieces.find((p) => p.id === "wei-general")!;

    expect(getCheckedKingdoms(state)).toContain("wei");
    expect(getLegalMoves(state, chariot)).toContain("D5");
    expect(getLegalMoves(state, general).length).toBeGreaterThan(0);
  });

  it("allows non-checked kingdom to move freely", () => {
    const state = stateWith([
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("shu-chariot", "chariot", "车", "A5", "shu"),
      piece("shu-general", "general", "蜀", "O4", "shu"),
      piece("wu-general", "general", "吴", "J4", "wu"),
      piece("wu-chariot", "chariot", "车", "J1", "wu"),
    ]);
    const wuTurnState: GameState = { ...state, currentKingdom: "wu", checkedKingdoms: getCheckedKingdoms(state) };
    const wuChariot = wuTurnState.pieces.find((p) => p.id === "wu-chariot")!;

    expect(getCheckedKingdoms(state)).toEqual(["wei"]);
    expect(getLegalMoves(wuTurnState, wuChariot).length).toBeGreaterThan(0);
  });

  it("cannon check is correctly detected", () => {
    const state = stateWith([
      piece("wu-cannon", "cannon", "炮", "N3", "wu"),
      piece("shu-advisor", "advisor", "士", "N4", "shu"),
      piece("shu-general", "general", "蜀", "N5", "shu"),
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wu-general", "general", "吴", "J5", "wu"),
    ]);

    expect(getCheckedKingdoms(state)).toContain("shu");
  });

  it("cannon check is not detected without a screen piece", () => {
    const state = stateWith([
      piece("wu-cannon", "cannon", "炮", "N3", "wu"),
      piece("shu-general", "general", "蜀", "N5", "shu"),
      piece("wei-general", "general", "魏", "E5", "wei"),
      piece("wu-general", "general", "吴", "J5", "wu"),
      piece("shu-soldier", "soldier", "兵", "K5", "shu"),
    ]);

    expect(getCheckedKingdoms(state)).not.toContain("shu");
  });
});
