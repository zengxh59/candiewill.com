import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  compareAiProfiles,
  compareOpponentModels,
  runAiMatchEval,
  createHeadToHeadMatchSetup,
} from "../src/core/ai-match-eval";
import { cloneAiProfile, defaultAiProfile, type OpponentModel } from "../src/core/ai-profile";

const OPPONENT_MODELS = new Set<OpponentModel>(["maxn", "paranoid", "leader_targeting", "opportunistic", "adaptive"]);

function parseArgs(argv: string[]): Record<string, string | number | boolean> {
  const args: Record<string, string | number | boolean> = {
    games: 100,
    seed: 20260515,
    maxPlies: 240,
    matchName: "newAI_vs_oldAI",
    output: "",
    includeGames: false,
    mode: "profile",
    modelA: "paranoid",
    modelB: "maxn",
    challengerBudget: 200,
    baselineBudget: 120,
    challengerDepth: defaultAiProfile.searchDepth,
    baselineDepth: Math.max(2, defaultAiProfile.searchDepth - 2),
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--include-games") {
      args.includeGames = true;
      continue;
    }

    const [key, value] = token.replace(/^--/, "").split("=");

    if (value === undefined) {
      continue;
    }

    if (
      key === "games" ||
      key === "seed" ||
      key === "maxPlies" ||
      key === "challengerBudget" ||
      key === "baselineBudget" ||
      key === "challengerDepth" ||
      key === "baselineDepth"
    ) {
      args[key] = Number(value);
    } else {
      args[key] = value;
    }
  }

  return args;
}

const args = parseArgs(process.argv);
const games = Number(args.games);
const seed = Number(args.seed);
const maxPlies = Number(args.maxPlies);
const includeGames = Boolean(args.includeGames);
const mode = String(args.mode);
const challengerBudget = Number(args.challengerBudget);
const baselineBudget = Number(args.baselineBudget);
const challengerDepth = Number(args.challengerDepth);
const baselineDepth = Number(args.baselineDepth);

const outputDir = join(process.cwd(), "ai-match-reports");
mkdirSync(outputDir, { recursive: true });
const fileSlug =
  mode === "opponent"
    ? `${String(args.matchName || "models")}_${String(args.modelA)}_vs_${String(args.modelB)}_${games}g_seed${seed}`
    : `${String(args.matchName)}_${games}g_seed${seed}`;
const fileName = `${fileSlug}.json`;
const outputPath = args.output ? String(args.output) : join(outputDir, fileName);
const checkpointPath = join(outputDir, `${fileSlug}.partial.json`);
const checkpointEvery = games >= 20 ? 10 : 0;

const matchEvalExtras = {
  checkpointEvery,
  checkpointPath: checkpointEvery > 0 ? checkpointPath : undefined,
};

let report;

if (mode === "opponent") {
  const modelA = String(args.modelA) as OpponentModel;
  const modelB = String(args.modelB) as OpponentModel;

  if (!OPPONENT_MODELS.has(modelA) || !OPPONENT_MODELS.has(modelB)) {
    console.error("modelA/modelB must be one of:", [...OPPONENT_MODELS].join(", "));
    process.exit(1);
  }

  const matchName = String(args.matchName || `${modelA}_vs_${modelB}`);

  report = compareOpponentModels(matchName, modelA, modelB, {
    games,
    seed,
    maxPlies,
    ...matchEvalExtras,
    challengerMoveOptions: {
      maxDepth: challengerDepth,
      timeBudgetMs: challengerBudget,
    },
    baselineMoveOptions: {
      maxDepth: baselineDepth,
      timeBudgetMs: baselineBudget,
    },
  });
} else if (mode === "profile") {
  const matchName = String(args.matchName);

  const challenger = cloneAiProfile(defaultAiProfile);
  const baseline = cloneAiProfile(defaultAiProfile);

  report = compareAiProfiles(matchName, challenger, baseline, {
    games,
    seed,
    maxPlies,
    ...matchEvalExtras,
    challengerLabel: "newAI",
    baselineLabel: "oldAI",
    challengerMoveOptions: {
      maxDepth: challengerDepth,
      timeBudgetMs: challengerBudget,
    },
    baselineMoveOptions: {
      maxDepth: baselineDepth,
      timeBudgetMs: baselineBudget,
    },
  });
} else if (mode === "symmetric") {
  /** 同深度同时限，仅对比 profile 差异（需自行改代码注入候选 profile） */
  report = runAiMatchEval(
    createHeadToHeadMatchSetup(
      String(args.matchName),
      { label: "A", profile: cloneAiProfile(defaultAiProfile) },
      { label: "B", profile: cloneAiProfile(defaultAiProfile) },
      "wei",
    ),
    { games, seed, maxPlies },
  );
} else {
  console.error('mode must be "profile", "opponent", or "symmetric"');
  process.exit(1);
}

if (!includeGames) {
  delete (report as { gameRecords?: unknown }).gameRecords;
}

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.error(`\nWrote report to ${outputPath}`);
