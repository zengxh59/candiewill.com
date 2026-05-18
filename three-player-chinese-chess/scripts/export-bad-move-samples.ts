import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { badMoveSamples, serializeBadMoveSample } from "../src/core/bad-move-samples";

const outDir = join(process.cwd(), "ai-learning-runs");
mkdirSync(outDir, { recursive: true });
const path = join(outDir, "bad-move-samples-export.json");

const payload = {
  exportedAt: new Date().toISOString(),
  count: badMoveSamples.length,
  samples: badMoveSamples.map(serializeBadMoveSample),
};

writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.error(`Wrote ${badMoveSamples.length} samples to ${path}`);
