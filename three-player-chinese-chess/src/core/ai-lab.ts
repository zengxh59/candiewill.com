import { chooseAiMove, evaluateAiState } from "./ai";
import { defaultAiProfile, type AiProfile } from "./ai-profile";
import { aiScenarios } from "./ai-scenarios";
import type { Kingdom } from "./board";
import { createInitialGameState } from "./game-state";
import { applyMove } from "./rules";

export interface AiBenchmarkReport {
  score: number;
  scenario: {
    passed: number;
    total: number;
    failures: string[];
    averageMs: number;
  };
  selfPlay: {
    games: number;
    averagePlies: number;
    earlyDefeats: number;
    winners: Record<Kingdom | "none", number>;
    averageScore: number;
  };
}

export interface AiTuneResult {
  iterations: number;
  report: AiBenchmarkReport;
  profile: AiProfile;
}

const kingdoms: Kingdom[] = ["wei", "shu", "wu"];
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

export function runAiBenchmark(profile: AiProfile = defaultAiProfile): AiBenchmarkReport {
  const scenario = runScenarioBenchmark(profile);
  const selfPlay = runSelfPlayBenchmark(profile);
  const scenarioScore = scenario.passed * 120 - scenario.failures.length * 250 - scenario.averageMs * 0.6;
  const selfPlayScore = selfPlay.averageScore - selfPlay.earlyDefeats * 220 + selfPlay.averagePlies * 1.4;

  return {
    score: Math.round(scenarioScore + selfPlayScore),
    scenario,
    selfPlay,
  };
}

export function tuneAiProfile(
  profile: AiProfile = defaultAiProfile,
  options: { iterations?: number; seed?: number } = {},
): AiTuneResult {
  const iterations = options.iterations ?? 8;
  const random = seededRandom(options.seed ?? 20260506);
  let bestProfile = cloneProfile(profile);
  let bestReport = runAiBenchmark(bestProfile);

  for (let index = 0; index < iterations; index += 1) {
    const candidate = mutateProfile(bestProfile, random);
    const report = runAiBenchmark(candidate);

    if (report.score > bestReport.score) {
      bestProfile = candidate;
      bestReport = report;
    }
  }

  return {
    iterations,
    report: bestReport,
    profile: bestProfile,
  };
}

export function cloneAiProfile(profile: AiProfile): AiProfile {
  return cloneProfile(profile);
}

function runScenarioBenchmark(profile: AiProfile): AiBenchmarkReport["scenario"] {
  const failures: string[] = [];
  let totalMs = 0;

  for (const scenario of aiScenarios) {
    const startedAt = performance.now();
    const move = chooseAiMove(scenario.state, scenario.kingdom, profile);
    totalMs += performance.now() - startedAt;

    if (!move) {
      failures.push(`${scenario.id}: no move`);
      continue;
    }

    if (scenario.expected && (move.pieceId !== scenario.expected.pieceId || move.target !== scenario.expected.target)) {
      failures.push(`${scenario.id}: expected ${scenario.expected.pieceId}-${scenario.expected.target}, got ${move.pieceId}-${move.target}`);
    }

    if (scenario.avoid && move.pieceId === scenario.avoid.pieceId && move.target === scenario.avoid.target) {
      failures.push(`${scenario.id}: avoided move selected ${move.pieceId}-${move.target}`);
    }
  }

  return {
    passed: aiScenarios.length - failures.length,
    total: aiScenarios.length,
    failures,
    averageMs: Math.round((totalMs / aiScenarios.length) * 10) / 10,
  };
}

function runSelfPlayBenchmark(profile: AiProfile): AiBenchmarkReport["selfPlay"] {
  const games = openingSeeds().map((seed) => playSelfPlayGame(profile, seed));
  const winners: Record<Kingdom | "none", number> = {
    wei: 0,
    shu: 0,
    wu: 0,
    none: 0,
  };

  for (const game of games) {
    winners[game.winner ?? "none"] += 1;
  }

  return {
    games: games.length,
    averagePlies: Math.round(games.reduce((sum, game) => sum + game.plies, 0) / games.length),
    earlyDefeats: games.reduce((sum, game) => sum + game.earlyDefeats, 0),
    winners,
    averageScore: Math.round(games.reduce((sum, game) => sum + game.score, 0) / games.length),
  };
}

function playSelfPlayGame(profile: AiProfile, seedMoves: Array<{ pieceId: string; target: string }>): {
  winner: Kingdom | null;
  plies: number;
  earlyDefeats: number;
  score: number;
} {
  let state = createInitialGameState();
  let plies = 0;
  let earlyDefeats = 0;

  for (const seed of seedMoves) {
    if (state.winner) {
      break;
    }

    try {
      state = applyMove(state, seed.pieceId, seed.target as never);
      plies += 1;
    } catch {
      break;
    }
  }

  while (!state.winner && plies < 28) {
    const beforeDefeats = state.defeatedKingdoms.length;
    const move = chooseAiMove(state, state.currentKingdom, profile);

    if (!move) {
      break;
    }

    state = applyMove(state, move.pieceId, move.target);
    plies += 1;

    if (plies <= 16 && state.defeatedKingdoms.length > beforeDefeats) {
      earlyDefeats += state.defeatedKingdoms.length - beforeDefeats;
    }
  }

  const score = kingdoms.reduce((sum, kingdom) => {
    return sum + evaluateAiState(state, kingdom, profile);
  }, 0);

  return {
    winner: state.winner,
    plies,
    earlyDefeats,
    score,
  };
}

function openingSeeds(): Array<Array<{ pieceId: string; target: string }>> {
  return [
    [],
    [{ pieceId: "wei-soldier-5", target: "A5" }],
    [{ pieceId: "wei-horse-left", target: "C1" }],
  ];
}

function mutateProfile(profile: AiProfile, random: () => number): AiProfile {
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

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed;

  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
