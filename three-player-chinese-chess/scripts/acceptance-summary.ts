import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { badMoveSamples } from "../src/core/bad-move-samples";

const root = process.cwd();
const reportsDir = join(root, "ai-match-reports");
const learningDir = join(root, "ai-learning-runs");

function readJson(path: string): unknown | null {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const baseline = readJson(join(reportsDir, "baseline_newAI_vs_oldAI_100g_seed20260516.json")) as Record<
  string,
  unknown
> | null;
const ordering = readJson(join(learningDir, "ordering-benchmark.json"));
const opponentReports = readdirSync(reportsDir)
  .filter((f) => f.startsWith("opponent_") && f.endsWith(".json") && !f.includes(".chunk"))
  .map((f) => ({ file: f, data: readJson(join(reportsDir, f)) as Record<string, unknown> }));

const categories = new Set(badMoveSamples.map((s) => s.category));

const summary = {
  generatedAt: new Date().toISOString(),
  tests: "npm test — 12 files / 89 cases (2026-05-18)",
  badMoveSamples: {
    count: badMoveSamples.length,
    categories: categories.size,
    categoryList: [...categories],
  },
  baseline100g: baseline
    ? {
        path: "ai-match-reports/baseline_newAI_vs_oldAI_100g_seed20260516.json",
        gamesCompleted: baseline.gamesCompleted,
        winRate: baseline.winRate,
        naturalWinRate: baseline.naturalWinRate,
        totalObviousBadMoves: baseline.totalObviousBadMoves,
        maxPlies: baseline.maxPlies,
        strengthClaim:
          "未证明 newAI 棋力提升：和棋率极高、胜率接近 0，仅作评估流水线基线",
      }
    : { missing: true },
  orderingBenchmark: ordering
    ? { path: "ai-learning-runs/ordering-benchmark.json" }
    : { missing: true },
  opponentMatrix: opponentReports.map((r) => ({
    file: r.file,
    winRate: r.data?.winRate,
    phaseWinRate: r.data?.phaseWinRate,
    gamesCompleted: r.data?.gamesCompleted,
  })),
  opponentModelDefault: "paranoid（待矩阵数据验证 adaptive≥0.52 再改）",
};

mkdirSync(learningDir, { recursive: true });
const outPath = join(learningDir, "acceptance-summary.json");
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
console.error(`Wrote ${outPath}`);
