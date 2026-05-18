import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mergeMatchReports, type AiMatchEvalReport } from "../src/core/ai-match-eval";

const dir = join(process.cwd(), "ai-match-reports");
const chunks = readdirSync(dir)
  .filter((f) => f.includes("100g_seed20260516.chunk"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as AiMatchEvalReport);

const merged = mergeMatchReports(chunks, 100);
merged.notes =
  (merged.notes ?? "") + "; 棋力结论须对比多组报告，本报告 alone 不证明提升。";
writeFileSync(join(dir, "baseline_newAI_vs_oldAI_100g_seed20260516.json"), `${JSON.stringify(merged, null, 2)}\n`);
console.log(
  JSON.stringify(
    { winRate: merged.winRate, naturalWinRate: merged.naturalWinRate, endReasonCounts: merged.endReasonCounts },
    null,
    2,
  ),
);
