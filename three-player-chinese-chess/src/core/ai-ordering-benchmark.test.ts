import { describe, expect, it } from "vitest";
import { runOrderingBenchmark } from "./ai-ordering-benchmark";

describe("ordering benchmark", () => {
  it("produces comparable with/without entries for tactical scenarios", { timeout: 300_000 }, () => {
    const report = runOrderingBenchmark({ seed: 1, maxDepth: 3, timeBudgetMs: 15_000, scenarioLimit: 4 });
    expect(report.entries.length).toBe(4);
    const withSearch = report.entries.filter((e) => e.withEnhancedOrdering.nodes > 0);
    expect(withSearch.length).toBeGreaterThan(0);
    for (const entry of withSearch) {
      expect(entry.withEnhancedOrdering.move).not.toBeNull();
      expect(typeof entry.moveChanged).toBe("boolean");
      expect(typeof entry.nodesDelta).toBe("number");
    }
  });
});
