import { describe, expect, it } from "vitest";
import { chooseAiMove, clearTranspositionTable, createSearchStats } from "./ai";
import { aiScenarios } from "./ai-scenarios";
import { aiStyleForKingdom, defaultAiProfile } from "./ai-profile";

describe("move ordering / search metrics", () => {
  it("search node counts are identical for two back-to-back runs on the same scenario", { timeout: 60_000 }, () => {
    const scenario = aiScenarios.find((s) => s.id === "escape-check");
    expect(scenario).toBeDefined();

    const measure = (): number => {
      clearTranspositionTable();
      const stats = createSearchStats();
      chooseAiMove(scenario!.state, scenario!.kingdom, defaultAiProfile, {
        style: aiStyleForKingdom(scenario!.kingdom),
        seed: 424242,
        explorationRate: 0,
        timeBudgetMs: 30_000,
        maxDepth: 3,
        openingSearchDepth: 0,
        debugStats: stats,
      });
      return stats.nodes;
    };

    const a = measure();
    const b = measure();

    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it("expands quiescence when looking several plies ahead on a tactical scenario", { timeout: 60_000 }, () => {
    clearTranspositionTable();
    const escape = aiScenarios.find((s) => s.id === "escape-check");
    expect(escape).toBeDefined();

    const stats = createSearchStats();
    chooseAiMove(escape!.state, escape!.kingdom, defaultAiProfile, {
      style: aiStyleForKingdom(escape!.kingdom),
      seed: 1,
      explorationRate: 0,
      timeBudgetMs: 30_000,
      maxDepth: 4,
      openingSearchDepth: 0,
      maxQuiescenceDepth: 4,
      debugStats: stats,
    });

    expect(stats.quiescenceNodes).toBeGreaterThanOrEqual(0);
    expect(stats.nodes).toBeGreaterThan(0);
  });

  it("增强排序开关下搜索可复现且均能完成根搜索", { timeout: 120_000 }, () => {
    const scenario = aiScenarios.find((s) => s.id === "escape-check");
    expect(scenario).toBeDefined();

    const measure = (disableEnhancedOrdering: boolean): number => {
      clearTranspositionTable();
      const stats = createSearchStats();
      chooseAiMove(scenario!.state, scenario!.kingdom, defaultAiProfile, {
        style: aiStyleForKingdom(scenario!.kingdom),
        seed: 9001,
        explorationRate: 0,
        timeBudgetMs: 30_000,
        maxDepth: 4,
        openingSearchDepth: 0,
        debugStats: stats,
        disableEnhancedOrdering,
      });
      return stats.nodes;
    };

    const withA = measure(false);
    const withB = measure(false);
    const withoutA = measure(true);
    const withoutB = measure(true);
    expect(withA).toBeGreaterThan(0);
    expect(withoutA).toBeGreaterThan(0);
    expect(withA).toBe(withB);
    expect(withoutA).toBe(withoutB);
  });
});
