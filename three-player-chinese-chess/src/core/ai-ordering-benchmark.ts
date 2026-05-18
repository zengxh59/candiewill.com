import { chooseAiMove, clearTranspositionTable, createSearchStats } from "./ai";
import { aiScenarios } from "./ai-scenarios";
import { aiStyleForKingdom, defaultAiProfile } from "./ai-profile";

export interface OrderingBenchmarkEntry {
  scenarioId: string;
  title: string;
  withEnhancedOrdering: {
    nodes: number;
    quiescenceNodes: number;
    thinkMs: number;
    move: { pieceId: string; target: string } | null;
    completedDepth: number;
  };
  withoutEnhancedOrdering: {
    nodes: number;
    quiescenceNodes: number;
    thinkMs: number;
    move: { pieceId: string; target: string } | null;
    completedDepth: number;
  };
  moveChanged: boolean;
  nodesDelta: number;
}

export interface OrderingBenchmarkReport {
  seed: number;
  maxDepth: number;
  timeBudgetMs: number;
  generatedAt: string;
  entries: OrderingBenchmarkEntry[];
}

export function runOrderingBenchmark(options: {
  seed?: number;
  maxDepth?: number;
  timeBudgetMs?: number;
  scenarioLimit?: number;
} = {}): OrderingBenchmarkReport {
  const seed = options.seed ?? 424242;
  const maxDepth = options.maxDepth ?? 3;
  const timeBudgetMs = options.timeBudgetMs ?? 30_000;
  const scenarios = aiScenarios.slice(0, options.scenarioLimit ?? 12);
  const entries: OrderingBenchmarkEntry[] = [];

  for (const scenario of scenarios) {
    const runOnce = (disableEnhancedOrdering: boolean) => {
      clearTranspositionTable();
      const stats = createSearchStats();
      const startedAt = performance.now();
      const move = chooseAiMove(scenario.state, scenario.kingdom, defaultAiProfile, {
        style: aiStyleForKingdom(scenario.kingdom),
        seed,
        explorationRate: 0,
        timeBudgetMs,
        maxDepth,
        openingSearchDepth: 0,
        debugStats: stats,
        disableEnhancedOrdering,
      });
      const thinkMs = performance.now() - startedAt;

      return {
        nodes: stats.nodes,
        quiescenceNodes: stats.quiescenceNodes,
        thinkMs: Math.round(thinkMs * 10) / 10,
        move: move ? { pieceId: move.pieceId, target: move.target } : null,
        completedDepth: stats.completedDepth,
      };
    };

    const withEnhanced = runOnce(false);
    const withoutEnhanced = runOnce(true);

    const moveChanged =
      withEnhanced.move?.pieceId !== withoutEnhanced.move?.pieceId ||
      withEnhanced.move?.target !== withoutEnhanced.move?.target;

    entries.push({
      scenarioId: scenario.id,
      title: scenario.title,
      withEnhancedOrdering: withEnhanced,
      withoutEnhancedOrdering: withoutEnhanced,
      moveChanged,
      nodesDelta: withEnhanced.nodes - withoutEnhanced.nodes,
    });
  }

  return {
    seed,
    maxDepth,
    timeBudgetMs,
    generatedAt: new Date().toISOString(),
    entries,
  };
}
