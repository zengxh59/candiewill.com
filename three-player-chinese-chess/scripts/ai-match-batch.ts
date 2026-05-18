import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  compareAiProfiles,
  loadMatchCheckpoint,
  mergeMatchReports,
  type AiMatchEvalReport,
} from "../src/core/ai-match-eval";
import { cloneAiProfile, defaultAiProfile, type OpponentModel } from "../src/core/ai-profile";

type Preset =
  | "profile-100"
  | "profile-20"
  | "profile-chunk"
  | "profile-100-chunked"
  | "opponent-matrix"
  | "opponent-chunk";

function parseArgs(argv: string[]): Record<string, string | number | boolean> {
  const args: Record<string, string | number | boolean> = {
    preset: "profile-100",
    resume: false,
    seed: 20260516,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--resume") {
      args.resume = true;
      continue;
    }
    const eq = token.replace(/^--/, "");
    if (eq.includes("=")) {
      const [key, value] = eq.split("=");
      if (key === "seed" || key === "games" || key === "chunk" || key === "chunks" || key === "start") {
        args[key] = Number(value);
      } else {
        args[key] = value;
      }
      continue;
    }
    if (eq === "preset" && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args.preset = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

const args = parseArgs(process.argv);
const preset = String(args.preset) as Preset;
const seed = Number(args.seed);
const outputDir = join(process.cwd(), "ai-match-reports");
mkdirSync(outputDir, { recursive: true });

const balanced = {
  maxPlies: 120,
  challengerBudget: 200,
  baselineBudget: 120,
  challengerDepth: 5,
  baselineDepth: 3,
  checkpointEvery: 10,
  clearEvalCacheEachGame: true,
  clearTranspositionEachGame: true,
  openingSearchDepth: 0,
};

function writeReport(path: string, report: AiMatchEvalReport): void {
  const out = { ...report };
  delete (out as { gameRecords?: unknown }).gameRecords;
  out.notes =
    (out.notes ? `${out.notes}; ` : "") +
    "棋力结论须对比多组报告，本报告 alone 不证明提升。";
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.error(`Wrote ${path}`);
}

function profileCompareOptions() {
  const challenger = cloneAiProfile(defaultAiProfile);
  const baseline = cloneAiProfile(defaultAiProfile);
  return {
    challenger,
    baseline,
    evalOptions: {
      maxPlies: balanced.maxPlies,
      clearEvalCacheEachGame: balanced.clearEvalCacheEachGame,
      clearTranspositionEachGame: balanced.clearTranspositionEachGame,
      challengerLabel: "newAI",
      baselineLabel: "oldAI",
      challengerMoveOptions: {
        maxDepth: balanced.challengerDepth,
        timeBudgetMs: balanced.challengerBudget,
        openingSearchDepth: balanced.openingSearchDepth,
      },
      baselineMoveOptions: {
        maxDepth: balanced.baselineDepth,
        timeBudgetMs: balanced.baselineBudget,
        openingSearchDepth: balanced.openingSearchDepth,
      },
    },
  };
}

function runProfileChunk(
  matchName: string,
  totalGames: number,
  chunkIndex: number,
  chunkCount: number,
  seedValue: number,
): AiMatchEvalReport {
  const gamesPerChunk = Math.ceil(totalGames / chunkCount);
  const startGameIndex = chunkIndex * gamesPerChunk;
  const games = Math.min(gamesPerChunk, totalGames - startGameIndex);
  if (games <= 0) {
    throw new Error(`Invalid chunk ${chunkIndex}/${chunkCount} for ${totalGames} games`);
  }

  const { challenger, baseline, evalOptions } = profileCompareOptions();
  return compareAiProfiles(matchName, challenger, baseline, {
    games,
    seed: seedValue,
    startGameIndex,
    totalGames,
    checkpointEvery: 0,
    ...evalOptions,
  });
}

function runChunkedBaseline(totalGames: number, seedValue: number): void {
  const matchName = "baseline_newAI_vs_oldAI";
  const fileSlug = `${matchName}_${totalGames}g_seed${seedValue}`;
  const outputPath = join(outputDir, `${fileSlug}.json`);
  const chunkCount = 10;
  const segments: AiMatchEvalReport[] = [];

  console.error(`[ai-match-batch] chunked: ${chunkCount} subprocesses × ~${totalGames / chunkCount} games`);

  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const chunkPath = join(outputDir, `${fileSlug}.chunk${String(chunk).padStart(2, "0")}.json`);
    if (existsSync(chunkPath)) {
      console.error(`[ai-match-batch] reuse chunk ${chunk}: ${chunkPath}`);
      segments.push(JSON.parse(readFileSync(chunkPath, "utf8")) as AiMatchEvalReport);
      continue;
    }

    const child = spawnSync(
      "npx",
      [
        "vite-node",
        "scripts/ai-match-batch.ts",
        `--preset=profile-chunk`,
        `--chunk=${chunk}`,
        `--chunks=${chunkCount}`,
        `--games=${totalGames}`,
        `--seed=${seedValue}`,
      ],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=1536" },
        shell: false,
      },
    );

    if (child.status !== 0) {
      console.error(`[ai-match-batch] chunk ${chunk} failed (exit ${child.status})`);
      process.exit(child.status ?? 1);
    }

    if (!existsSync(chunkPath)) {
      console.error(`[ai-match-batch] missing chunk output: ${chunkPath}`);
      process.exit(1);
    }

    segments.push(JSON.parse(readFileSync(chunkPath, "utf8")) as AiMatchEvalReport);
  }

  const merged = mergeMatchReports(segments, totalGames);
  writeReport(outputPath, { ...merged, games: totalGames, matchName });
  console.log(JSON.stringify(merged, null, 2));
}

function runOpponentChunk(
  modelA: OpponentModel,
  modelB: OpponentModel,
  gamesPerPair: number,
  chunkIndex: number,
  chunkCount: number,
  seedValue: number,
): AiMatchEvalReport {
  const gamesPerChunk = Math.ceil(gamesPerPair / chunkCount);
  const startGameIndex = chunkIndex * gamesPerChunk;
  const games = Math.min(gamesPerChunk, gamesPerPair - startGameIndex);
  if (games <= 0) {
    throw new Error(`Invalid opponent chunk ${chunkIndex}`);
  }

  const base = cloneAiProfile(defaultAiProfile);
  const challengerProfile = cloneAiProfile(base);
  const baselineProfile = cloneAiProfile(base);
  challengerProfile.opponentModel = modelA;
  baselineProfile.opponentModel = modelB;

  return compareAiProfiles(`opponent_${modelA}_vs_${modelB}`, challengerProfile, baselineProfile, {
    games,
    seed: seedValue,
    startGameIndex,
    totalGames: gamesPerPair,
    trackPhaseStats: true,
    clearEvalCacheEachGame: true,
    clearTranspositionEachGame: true,
    challengerLabel: modelA,
    baselineLabel: modelB,
    challengerMoveOptions: {
      maxDepth: balanced.challengerDepth,
      timeBudgetMs: balanced.challengerBudget,
      openingSearchDepth: balanced.openingSearchDepth,
    },
    baselineMoveOptions: {
      maxDepth: balanced.baselineDepth,
      timeBudgetMs: balanced.baselineBudget,
      openingSearchDepth: balanced.openingSearchDepth,
    },
  });
}

function runOpponentMatrixChunked(seedValue: number): void {
  const pairs: Array<[OpponentModel, OpponentModel]> = [
    ["paranoid", "maxn"],
    ["adaptive", "paranoid"],
    ["leader_targeting", "opportunistic"],
  ];
  const gamesPerPair = 20;
  const chunkCount = 4;

  for (const [modelA, modelB] of pairs) {
    const fileSlug = `opponent_${modelA}_vs_${modelB}_${gamesPerPair}g_seed${seedValue}`;
    const outputPath = join(outputDir, `${fileSlug}.json`);
    const segments: AiMatchEvalReport[] = [];

    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      const chunkPath = join(outputDir, `${fileSlug}.chunk${String(chunk).padStart(2, "0")}.json`);
      if (existsSync(chunkPath)) {
        segments.push(JSON.parse(readFileSync(chunkPath, "utf8")) as AiMatchEvalReport);
        continue;
      }

      const child = spawnSync(
        "npx",
        [
          "vite-node",
          "scripts/ai-match-batch.ts",
          `--preset=opponent-chunk`,
          `--modelA=${modelA}`,
          `--modelB=${modelB}`,
          `--chunk=${chunk}`,
          `--chunks=${chunkCount}`,
          `--games=${gamesPerPair}`,
          `--seed=${seedValue}`,
        ],
        {
          cwd: process.cwd(),
          stdio: "inherit",
          env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=1536" },
        },
      );

      if (child.status !== 0) {
        process.exit(child.status ?? 1);
      }

      segments.push(JSON.parse(readFileSync(chunkPath, "utf8")) as AiMatchEvalReport);
    }

    writeReport(outputPath, mergeMatchReports(segments, gamesPerPair));
    console.error(`[ai-match-batch] opponent matrix done: ${outputPath}`);
  }
}

if (preset === "profile-chunk") {
  const totalGames = Number(args.games) || 100;
  const chunkCount = Number(args.chunks) || 10;
  const chunkIndex = Number(args.chunk) || 0;
  const matchName = "baseline_newAI_vs_oldAI";
  const fileSlug = `${matchName}_${totalGames}g_seed${seed}`;
  const chunkPath = join(outputDir, `${fileSlug}.chunk${String(chunkIndex).padStart(2, "0")}.json`);

  const report = runProfileChunk(matchName, totalGames, chunkIndex, chunkCount, seed);
  writeReport(chunkPath, report);
} else if (preset === "profile-100-chunked") {
  runChunkedBaseline(100, seed);
} else if (preset === "profile-100" || preset === "profile-20") {
  const games = preset === "profile-100" ? 100 : 20;
  const matchName = "baseline_newAI_vs_oldAI";
  const fileSlug = `${matchName}_${games}g_seed${seed}`;
  const outputPath = join(outputDir, `${fileSlug}.json`);
  const checkpointPath = join(outputDir, `${fileSlug}.partial.json`);

  if (preset === "profile-100") {
    console.error("[ai-match-batch] profile-100 uses chunked runner (OOM-safe). Use profile-20 for quick single-process smoke.");
    runChunkedBaseline(games, seed);
    process.exit(0);
  }

  const segments: AiMatchEvalReport[] = [];
  let startGameIndex = 0;

  if (args.resume && existsSync(checkpointPath)) {
    const partial = loadMatchCheckpoint(checkpointPath);
    if (partial && partial.gamesCompleted > 0 && partial.gamesCompleted < games) {
      segments.push(partial);
      startGameIndex = partial.gamesCompleted;
      console.error(`[ai-match-batch] resume from game ${startGameIndex}/${games}`);
    }
  }

  const remaining = games - startGameIndex;
  if (remaining > 0) {
    const { challenger, baseline, evalOptions } = profileCompareOptions();
    const segment = compareAiProfiles(matchName, challenger, baseline, {
      games: remaining,
      seed,
      startGameIndex,
      totalGames: games,
      checkpointEvery: balanced.checkpointEvery,
      checkpointPath: startGameIndex === 0 ? checkpointPath : undefined,
      ...evalOptions,
    });
    segments.push(segment);
  }

  const report = segments.length === 1 ? segments[0] : mergeMatchReports(segments, games);
  writeReport(outputPath, { ...report, games, matchName });
  if (existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
  }
  console.log(JSON.stringify(report, null, 2));
} else if (preset === "opponent-chunk") {
  const modelA = String(args.modelA) as OpponentModel;
  const modelB = String(args.modelB) as OpponentModel;
  const gamesPerPair = Number(args.games) || 20;
  const chunkCount = Number(args.chunks) || 4;
  const chunkIndex = Number(args.chunk) || 0;
  const fileSlug = `opponent_${modelA}_vs_${modelB}_${gamesPerPair}g_seed${seed}`;
  const chunkPath = join(outputDir, `${fileSlug}.chunk${String(chunkIndex).padStart(2, "0")}.json`);
  const report = runOpponentChunk(modelA, modelB, gamesPerPair, chunkIndex, chunkCount, seed);
  writeReport(chunkPath, report);
} else if (preset === "opponent-matrix") {
  runOpponentMatrixChunked(seed);
} else {
  console.error("Unknown preset. Use profile-100, profile-20, profile-100-chunked, profile-chunk, opponent-matrix");
  process.exit(1);
}
