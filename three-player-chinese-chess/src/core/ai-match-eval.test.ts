import { describe, expect, it } from "vitest";
import {
  compareAiProfiles,
  compareOpponentModels,
  createHeadToHeadMatchSetup,
  runAiMatchEval,
} from "./ai-match-eval";
import { defaultAiProfile, aiStyleForKingdom } from "./ai-profile";
import { badMoveSamples } from "./bad-move-samples";
import { chooseAiMove, clearTranspositionTable } from "./ai";

describe("AI match evaluation", () => {
  it("runs a small reproducible head-to-head batch", { timeout: 120_000 }, () => {
    clearTranspositionTable();

    const runOptions = {
      games: 4,
      seed: 42,
      maxPlies: 20,
      useOpeningSeeds: false,
      challengerLabel: "deep",
      baselineLabel: "shallow",
      challengerMoveOptions: { maxDepth: 2, timeBudgetMs: 400, openingSearchDepth: 0 },
      baselineMoveOptions: { maxDepth: 1, timeBudgetMs: 400, openingSearchDepth: 0 },
    } as const;

    const report = compareAiProfiles("depth5_vs_depth3", defaultAiProfile, defaultAiProfile, runOptions);

    expect(report.games).toBe(4);
    expect(report.gamesCompleted).toBe(4);
    expect(report.seed).toBe(42);
    expect(report.slotLabels.sort()).toEqual(["deep", "shallow"]);
    expect(report.winRate.deep + report.winRate.shallow + report.winRate.draw).toBeCloseTo(1, 5);
    expect(report.avgTurns).toBeGreaterThan(0);
    expect(typeof report.avgNodes.deep).toBe("number");
  });

  it("aggregates per-label search stats", { timeout: 60_000 }, () => {
    const setup = createHeadToHeadMatchSetup(
      "stats_smoke",
      { label: "A", profile: defaultAiProfile, moveOptions: { maxDepth: 1, timeBudgetMs: 30 } },
      { label: "B", profile: defaultAiProfile, moveOptions: { maxDepth: 1, timeBudgetMs: 30 } },
      "wei",
    );

    const report = runAiMatchEval(setup, {
      games: 2,
      seed: 7,
      maxPlies: 16,
      useOpeningSeeds: false,
      rotateKingdomSlots: false,
    });

    expect(report.avgThinkMs.A).toBeGreaterThan(0);
    expect(report.endReasonCounts).toBeDefined();
    expect(report.totalObviousBadMoves).toBeGreaterThanOrEqual(0);
    expect(report.zeroSearchMoves).toBeGreaterThanOrEqual(0);
    expect(report.avgFinalScores).toBeDefined();
  });

  it("compares opponent models without throwing", { timeout: 90_000 }, () => {
    clearTranspositionTable();
    const report = compareOpponentModels("maxn_vs_par", "maxn", "paranoid", {
      games: 2,
      seed: 11,
      maxPlies: 18,
      useOpeningSeeds: false,
      challengerMoveOptions: { maxDepth: 1, timeBudgetMs: 250, openingSearchDepth: 0 },
      baselineMoveOptions: { maxDepth: 1, timeBudgetMs: 250, openingSearchDepth: 0 },
    });

    expect(report.gamesCompleted).toBe(2);
    expect(report.winRate.maxn + report.winRate.paranoid + report.winRate.draw).toBeCloseTo(1, 5);
  });
});

describe("bad move samples", () => {
  it("has at least twelve registered samples across categories", () => {
    const categories = new Set(badMoveSamples.map((s) => s.category));
    expect(badMoveSamples.length).toBeGreaterThanOrEqual(12);
    expect(categories.size).toBeGreaterThanOrEqual(6);
  });

  it("regresses registered bad-move samples without engine hardcoding", { timeout: 30_000 }, () => {
    clearTranspositionTable();

    for (const sample of badMoveSamples) {
      if (!sample.expectedMove && !sample.expectedAny?.length && !sample.mustNotMatch) {
        continue;
      }

      const move = chooseAiMove(sample.position, sample.sideToMove, undefined, {
        style: aiStyleForKingdom(sample.sideToMove),
        explorationRate: 0,
      });

      expect(move, sample.id).not.toBeNull();

      if (sample.expectedMove) {
        expect(move, sample.title).toMatchObject(sample.expectedMove);
      }

      if (sample.expectedAny?.length) {
        expect(
          sample.expectedAny.some((expected) => move!.pieceId === expected.pieceId && move!.target === expected.target),
          sample.title,
        ).toBe(true);
      }

      if (sample.mustNotMatch) {
        expect(move, sample.title).not.toMatchObject(sample.mustNotMatch);
      }
    }
  });
});
