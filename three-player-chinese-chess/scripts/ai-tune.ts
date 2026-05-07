import { readFile, writeFile } from "node:fs/promises";
import { tuneAiProfile } from "../src/core/ai-lab";
import { defaultAiProfile, type AiProfile } from "../src/core/ai-profile";

const iterations = Number(readArg("--iterations") ?? 12);
const shouldApply = process.argv.includes("--apply");

const result = tuneAiProfile(defaultAiProfile, {
  iterations,
  seed: 20260505,
});

console.log(
  JSON.stringify(
    {
      iterations,
      score: result.report.score,
      report: result.report,
      profile: result.profile,
      rejected: result.rejected,
      applied: shouldApply,
    },
    null,
    2,
  ),
);

if (shouldApply) {
  await applyProfile(result.profile);
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
