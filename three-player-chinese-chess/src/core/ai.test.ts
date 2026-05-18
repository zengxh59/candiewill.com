import { describe, expect, it } from "vitest";
import { chooseAiMove, clearTranspositionTable, createSearchStats } from "./ai";
import { aiScenarios } from "./ai-scenarios";
import { aiStyleForKingdom } from "./ai-profile";
import { capturedPieceAt, createInitialGameState, type GameState } from "./game-state";
import { getCheckedKingdoms } from "./moves";
import type { Piece } from "./pieces";
import { applyMove } from "./rules";

describe("AI player", () => {
  it("passes the shared AI scenario suite", { timeout: 30_000 }, () => {
    clearTranspositionTable();

    for (const scenario of aiScenarios) {
      const move = chooseAiMove(scenario.state, scenario.kingdom);

      expect(move, scenario.title).not.toBeNull();

      if (scenario.expected) {
        expect(move, scenario.title).toMatchObject(scenario.expected);
      }

      if (scenario.expectedAny) {
        expect(
          scenario.expectedAny.some((expected) => move!.pieceId === expected.pieceId && move!.target === expected.target),
          scenario.title,
        ).toBe(true);
      }

      if (scenario.avoid) {
        expect(move, scenario.title).not.toMatchObject(scenario.avoid);
      }

      if (scenario.avoidAny) {
        for (const avoided of scenario.avoidAny) {
          expect(move, scenario.title).not.toMatchObject(avoided);
        }
      }

      if (scenario.mustCaptureIfProfitable) {
        expect(capturedPieceAt(scenario.state, move!.pieceId, move!.target), scenario.title).not.toBeNull();
      }

      if (scenario.mustResolveCheck) {
        expect(getCheckedKingdoms(applyMove(scenario.state, move!.pieceId, move!.target)), scenario.title).not.toContain(scenario.kingdom);
      }
    }
  });

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
        piece("wei-general", "general", "魏", "E1", "wei"),
        piece("shu-general", "general", "蜀", "O1", "shu"),
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
    // Pass an explicit time budget so the opening search (now depth-3 by default)
    // is bounded; the AI must still pick a move and return within the budget.
    const move = chooseAiMove(state, "shu", undefined, { timeBudgetMs: 250 });

    expect(move).not.toBeNull();
    expect(performance.now() - startedAt).toBeLessThan(750);
  });

  it("can sample a different strong candidate when exploration is enabled", () => {
    const state = applyMove(createInitialGameState(), "wei-soldier-5", "A5");
    const greedy = chooseAiMove(state, "shu");
    const randomValues = [0, 0.99];
    const exploratory = chooseAiMove(state, "shu", undefined, {
      random: () => randomValues.shift() ?? 0.99,
      explorationRate: 1,
      explorationTop: 8,
      explorationSlack: Number.POSITIVE_INFINITY,
      explorationTemperature: 1_000_000,
      openingSearchDepth: 0,
    });

    expect(exploratory).not.toBeNull();
    expect(exploratory).not.toEqual(greedy);
  });

  it("keeps seeded exploration deterministic", () => {
    const state = applyMove(createInitialGameState(), "wei-soldier-5", "A5");
    const options = {
      seed: 1234,
      explorationRate: 1,
      explorationTop: 8,
      explorationSlack: Number.POSITIVE_INFINITY,
      explorationTemperature: 1_000_000,
      openingSearchDepth: 0,
      timeBudgetMs: 1_000,
    };

    expect(chooseAiMove(state, "shu", undefined, options)).toEqual(chooseAiMove(state, "shu", undefined, options));
  });

  it("defines distinct kingdom style profiles", () => {
    expect(aiStyleForKingdom("wei").attackMultiplier).toBeGreaterThan(aiStyleForKingdom("shu").attackMultiplier);
    expect(aiStyleForKingdom("shu").safetyMultiplier).toBeGreaterThan(aiStyleForKingdom("wei").safetyMultiplier);
    expect(aiStyleForKingdom("wu").mobilityMultiplier).toBeGreaterThan(aiStyleForKingdom("shu").mobilityMultiplier);
  });

  it("avoids immediately reversing a quiet move when other useful moves exist", () => {
    const state: GameState = {
      ...stateWith(
        [
          piece("wu-chariot", "chariot", "车", "F5", "wu"),
          piece("wu-general", "general", "吴", "J4", "wu"),
          piece("wei-general", "general", "魏", "E4", "wei"),
          piece("shu-general", "general", "蜀", "O5", "shu"),
        ],
        "wu",
      ),
      moveHistory: [
        {
          pieceId: "wu-chariot",
          kingdom: "wu",
          from: "A5",
          target: "F5",
          capturedPieceId: null,
        },
      ],
    };

    expect(chooseAiMove(state, "wu")).not.toMatchObject({
      pieceId: "wu-chariot",
      target: "A5",
    });
  });

  it("exposes search stats after deep search on tactical scenario", () => {
    clearTranspositionTable();
    const scenario = aiScenarios.find((s) => s.id === "escape-check")!;
    const stats = createSearchStats();
    chooseAiMove(scenario.state, scenario.kingdom, undefined, {
      debugStats: stats,
      maxDepth: 5,
      timeBudgetMs: 1_500,
      openingSearchDepth: 0,
      explorationRate: 0,
    });
    expect(stats.nodes).toBeGreaterThan(30);
    expect(stats.quiescenceNodes).toBeGreaterThan(0);
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
