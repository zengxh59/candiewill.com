import { readFile, writeFile } from "node:fs/promises";
import { runAiBenchmark } from "../src/core/ai-lab";
import { defaultAiProfile, type AiProfile } from "../src/core/ai-profile";

const iterations = Number(readArg("--iterations") ?? 12);
const shouldApply = process.argv.includes("--apply");

const tunableScalars: Array<keyof AiProfile["scoring"]> = [
  "rootActionWeight",
  "capturedValueMultiplier",
  "tradeDeltaMultiplier",
  "badTradeMultiplier",
  "exposedTradeMultiplier",
  "openingRaidPenalty",
  "kingDefensePalaceCapture",
  "kingDefenseAttackerCapture",
  "checkedSelfPenalty",
  "directCheckPenalty",
  "directAttackerPenalty",
  "palacePressurePenalty",
  "defenderBonus",
  "generalAwayPenalty",
  "balanceGapPenalty",
  "tacticalPieceRiskMultiplier",
];

let bestProfile = cloneProfile(defaultAiProfile);
let bestReport = runAiBenchmark(bestProfile);
let seed = 20260505;

for (let index = 0; index < iterations; index += 1) {
  const candidate = mutateProfile(bestProfile);
  const report = runAiBenchmark(candidate);

  if (report.score > bestReport.score) {
    bestProfile = candidate;
    bestReport = report;
  }
}

console.log(
  JSON.stringify(
    {
      iterations,
      score: bestReport.score,
      report: bestReport,
      profile: bestProfile,
      applied: shouldApply,
    },
    null,
    2,
  ),
);

if (shouldApply) {
  await applyProfile(bestProfile);
}

function mutateProfile(profile: AiProfile): AiProfile {
  const next = cloneProfile(profile);
  const field = tunableScalars[Math.floor(random() * tunableScalars.length)];
  const factor = 0.8 + random() * 0.45;
  const value = next.scoring[field];

  next.scoring[field] = Math.round(value * factor * 1000) / 1000;

  return next;
}

function cloneProfile(profile: AiProfile): AiProfile {
  return JSON.parse(JSON.stringify(profile)) as AiProfile;
}

function random(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function applyProfile(profile: AiProfile): Promise<void> {
  const path = new URL("../src/core/ai-profile.ts", import.meta.url);
  const source = await readFile(path, "utf8");
  const start = source.indexOf("export const defaultAiProfile: AiProfile = ");
  const end = source.indexOf("\n};", start);

  if (start < 0 || end < 0) {
    throw new Error("Could not find defaultAiProfile in ai-profile.ts");
  }

  const prefix = source.slice(0, start);
  const suffix = source.slice(end + 3);
  const profileSource = `export const defaultAiProfile: AiProfile = ${JSON.stringify(profile, null, 2)};`;

  await writeFile(path, `${prefix}${profileSource}${suffix}`);
}
