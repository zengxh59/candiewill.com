import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runOrderingBenchmark } from "../src/core/ai-ordering-benchmark";

const report = runOrderingBenchmark({ seed: 424242, maxDepth: 3, timeBudgetMs: 30_000, scenarioLimit: 12 });
const outDir = join(process.cwd(), "ai-learning-runs");
mkdirSync(outDir, { recursive: true });
const path = join(outDir, "ordering-benchmark.json");
writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.error(`Wrote ${path}`);
