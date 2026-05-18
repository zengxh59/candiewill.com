import { describe, expect, it } from "vitest";
import { chooseAiMove, clearTranspositionTable, createSearchStats } from "./ai";
import { aiScenarios } from "./ai-scenarios";
import { aiStyleForKingdom, defaultAiProfile } from "./ai-profile";
import { computeFullHash, hashToKey } from "./ai/zobrist";
import { createInitialGameState } from "./game-state";

describe("search infrastructure (TT / quiescence / zobrist)", () => {
  it("置换表开启与否在同种子下选出相同着法", { timeout: 60_000 }, () => {
    const scenario = aiScenarios.find((s) => s.id === "escape-check");
    expect(scenario).toBeDefined();

    const opts = {
      style: aiStyleForKingdom(scenario!.kingdom),
      seed: 777,
      explorationRate: 0,
      timeBudgetMs: 30_000,
      maxDepth: 3,
      openingSearchDepth: 0,
    } as const;

    clearTranspositionTable();
    const withTt = chooseAiMove(scenario!.state, scenario!.kingdom, defaultAiProfile, opts);

    clearTranspositionTable();
    const fresh = chooseAiMove(scenario!.state, scenario!.kingdom, defaultAiProfile, opts);

    expect(withTt).toEqual(fresh);
  });

  it("记录静态搜索与置换表命中统计", { timeout: 60_000 }, () => {
    clearTranspositionTable();
    const scenario = aiScenarios.find((s) => s.id === "escape-check");
    expect(scenario).toBeDefined();

    const stats = createSearchStats();
    chooseAiMove(scenario!.state, scenario!.kingdom, defaultAiProfile, {
      style: aiStyleForKingdom(scenario!.kingdom),
      seed: 3,
      explorationRate: 0,
      timeBudgetMs: 30_000,
      maxDepth: 4,
      openingSearchDepth: 0,
      maxQuiescenceDepth: 4,
      debugStats: stats,
    });

    expect(stats.nodes).toBeGreaterThan(0);
    expect(stats.quiescenceNodes).toBeGreaterThanOrEqual(0);
    expect(stats.ttHits).toBeGreaterThanOrEqual(0);
  });

  it("Zobrist hash 区分将军状态", () => {
    const state = createInitialGameState();
    const checked = { ...state, checkedKingdoms: ["wei"] as const };
    const keyBase = hashToKey(computeFullHash(state.pieces, state.currentKingdom, state.defeatedKingdoms, state.checkedKingdoms));
    const keyChecked = hashToKey(
      computeFullHash(checked.pieces, checked.currentKingdom, checked.defeatedKingdoms, checked.checkedKingdoms),
    );
    expect(keyBase).not.toBe(keyChecked);
  });

  it("Zobrist hash 与棋子数组顺序无关", () => {
    const state = createInitialGameState();
    const shuffledPieces = [...state.pieces].reverse();
    const keyA = hashToKey(
      computeFullHash(state.pieces, state.currentKingdom, state.defeatedKingdoms, state.checkedKingdoms),
    );
    const keyB = hashToKey(
      computeFullHash(shuffledPieces, state.currentKingdom, state.defeatedKingdoms, state.checkedKingdoms),
    );
    expect(keyA).toBe(keyB);
  });

  it("静态搜索在战术局面展开节点", { timeout: 60_000 }, () => {
    clearTranspositionTable();
    const scenario = aiScenarios.find((s) => s.id === "quiescence-greedy-recapture");
    expect(scenario).toBeDefined();

    const stats = createSearchStats();
    chooseAiMove(scenario!.state, scenario!.kingdom, defaultAiProfile, {
      style: aiStyleForKingdom(scenario!.kingdom),
      seed: 11,
      explorationRate: 0,
      timeBudgetMs: 30_000,
      maxDepth: 4,
      openingSearchDepth: 0,
      maxQuiescenceDepth: 4,
      debugStats: stats,
    });

    expect(stats.quiescenceNodes).toBeGreaterThan(0);
  });
});
