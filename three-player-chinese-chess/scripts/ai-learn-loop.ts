import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runAiBenchmark, tuneAiProfile, type AiBenchmarkReport } from "../src/core/ai-lab";
import { defaultAiProfile, type AiProfile } from "../src/core/ai-profile";

const runProcess = promisify(execFile);

const cycles = Number(readArg("--cycles") ?? 0);
const intervalHours = Number(readArg("--hours") ?? 8);
const iterations = Number(readArg("--iterations") ?? 120);
const minGain = Number(readArg("--min-gain") ?? 1);
const shouldVerify = process.argv.includes("--verify");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

let currentProfile = cloneProfile(defaultAiProfile);
let cycleIndex = 0;

await mkdir(new URL("../ai-learning-runs/", import.meta.url), { recursive: true });

while (cycles === 0 || cycleIndex < cycles) {
  cycleIndex += 1;
  const startedAt = new Date();
  const baseline = runAiBenchmark(currentProfile);
  const result = tuneAiProfile(currentProfile, {
    iterations,
    populationSize: 3,
    seed: Math.floor(startedAt.getTime() % 4294967296),
  });
  const gain = result.report.score - baseline.score;
  let applied = gain >= minGain && result.report.scenario.failures.length === 0;
  let verification: "skipped" | "passed" | "failed" = shouldVerify ? "failed" : "skipped";

  if (applied) {
    await applyProfile(result.profile);

    if (shouldVerify) {
      try {
        await runProcess("npm", ["test"], {
          cwd: projectRoot,
        });
        verification = "passed";
      } catch {
        await applyProfile(currentProfile);
        applied = false;
        verification = "failed";
      }
    }

    if (applied) {
      currentProfile = result.profile;
    }
  }

  const report = {
    cycle: cycleIndex,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    iterations,
    gain,
    applied,
    verification,
    baseline,
    candidate: result.report,
    profile: result.profile,
    rejected: result.rejected,
  };

  await writeLearningReport(report);
  printCycleSummary(report);

  if (cycles > 0 && cycleIndex >= cycles) {
    break;
  }

  await wait(intervalHours * 60 * 60 * 1000);
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

async function writeLearningReport(report: {
  cycle: number;
  startedAt: string;
  finishedAt: string;
  iterations: number;
  gain: number;
  applied: boolean;
  verification: string;
  baseline: AiBenchmarkReport;
  candidate: AiBenchmarkReport;
  profile: AiProfile;
}): Promise<void> {
  const timestamp = report.startedAt.replace(/[:.]/g, "-");
  const content = `${JSON.stringify(report, null, 2)}\n`;

  await writeFile(new URL(`../ai-learning-runs/${timestamp}.json`, import.meta.url), content);
  await writeFile(new URL("../ai-learning-runs/latest.json", import.meta.url), content);
}

function printCycleSummary(report: {
  cycle: number;
  gain: number;
  applied: boolean;
  verification: string;
  baseline: AiBenchmarkReport;
  candidate: AiBenchmarkReport;
}): void {
  console.log(
    JSON.stringify(
      {
        cycle: report.cycle,
        baselineScore: report.baseline.score,
        candidateScore: report.candidate.score,
        gain: report.gain,
        scenario: `${report.candidate.scenario.passed}/${report.candidate.scenario.total}`,
        applied: report.applied,
        verification: report.verification,
      },
      null,
      2,
    ),
  );
}

function cloneProfile(profile: AiProfile): AiProfile {
  return JSON.parse(JSON.stringify(profile)) as AiProfile;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}
