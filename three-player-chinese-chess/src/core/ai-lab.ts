import { chooseAiMove, evaluateAiState, type AiMove } from "./ai";
import { aiStyleForKingdom, defaultAiProfile, type AiProfile } from "./ai-profile";
import { aiScenarios } from "./ai-scenarios";
import type { Kingdom } from "./board";
import { capturedPieceAt, createInitialGameState, type GameState } from "./game-state";
import { getLegalMoves } from "./moves";
import type { Piece } from "./pieces";
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
    naturalWins: number;
    repetitionStops: number;
    openingDiversity: number;
    averageSafety: number;
    profitableCaptureMisses: number;
    hangingPieceMisses: number;
    repeatedQuietMoves: number;
    averageThinkMs: number;
    endgameNaturalWins: number;
    endgameBlunders: number;
    missedKillMoves: number;
  };
}

export interface AiTuneResult {
  iterations: number;
  report: AiBenchmarkReport;
  profile: AiProfile;
  rejected: Array<{
    iteration: number;
    score: number;
    gain: number;
    reason: string;
  }>;
}

export interface AiBenchmarkOptions {
  selfPlayGames?: number;
  maxPlies?: number;
  seed?: number;
  detailed?: boolean;
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

export function runAiBenchmark(profile: AiProfile = defaultAiProfile, options: AiBenchmarkOptions = {}): AiBenchmarkReport {
  const scenario = runScenarioBenchmark(profile);
  const selfPlay = runSelfPlayBenchmark(profile, options);
  const scenarioScore = scenario.passed * 120 - scenario.failures.length * 250 - scenario.averageMs * 0.6;
  const selfPlayScore =
    selfPlay.averageScore -
    selfPlay.earlyDefeats * 260 -
    selfPlay.repetitionStops * 150 +
    selfPlay.naturalWins * 180 +
    selfPlay.openingDiversity * 22 +
    selfPlay.averageSafety * 0.08 +
    selfPlay.averagePlies * 1.1 -
    selfPlay.profitableCaptureMisses * 180 -
    selfPlay.hangingPieceMisses * 140 -
    selfPlay.repeatedQuietMoves * 110 -
    selfPlay.averageThinkMs * 0.08 +
    selfPlay.endgameNaturalWins * 220 -
    selfPlay.endgameBlunders * 180 -
    selfPlay.missedKillMoves * 320;

  return {
    score: Math.round(scenarioScore + selfPlayScore),
    scenario,
    selfPlay,
  };
}

export function tuneAiProfile(
  profile: AiProfile = defaultAiProfile,
  options: { iterations?: number; seed?: number; populationSize?: number; benchmark?: AiBenchmarkOptions } = {},
): AiTuneResult {
  const iterations = options.iterations ?? 8;
  const random = seededRandom(options.seed ?? 20260506);
  const populationSize = options.populationSize ?? 3;
  let bestProfile = cloneProfile(profile);
  let bestReport = runAiBenchmark(bestProfile, options.benchmark);
  const rejected: AiTuneResult["rejected"] = [];

  for (let index = 0; index < iterations; index += 1) {
    for (let member = 0; member < populationSize; member += 1) {
      const base = member === 0 ? bestProfile : blendProfiles(bestProfile, profile, random);
      const candidate = mutateProfile(base, random);
      const report = runAiBenchmark(candidate, options.benchmark);
      const gain = report.score - bestReport.score;

      if (report.score > bestReport.score && report.scenario.failures.length === 0) {
        bestProfile = candidate;
        bestReport = report;
        continue;
      }

      rejected.push({
        iteration: index + 1,
        score: report.score,
        gain,
        reason: report.scenario.failures.length ? `scenario failures: ${report.scenario.failures.join("; ")}` : "score did not improve",
      });
    }
  }

  return {
    iterations,
    report: bestReport,
    profile: bestProfile,
    rejected: rejected.slice(-24),
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
    const move = chooseAiMove(scenario.state, scenario.kingdom, profile, {
      style: aiStyleForKingdom(scenario.kingdom),
      maxDepth: profile.searchDepth,
    });
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

function runSelfPlayBenchmark(profile: AiProfile, options: AiBenchmarkOptions): AiBenchmarkReport["selfPlay"] {
  const targetGames = options.selfPlayGames ?? 3;
  const seeds = openingSeeds();
  const random = seededRandom(options.seed ?? 20260507);
  const games = Array.from({ length: targetGames }, (_, index) => {
    const seedIndex = index < seeds.length ? index : Math.floor(random() * seeds.length);

    return playSelfPlayGame(profile, seeds[seedIndex], {
      maxPlies: options.maxPlies ?? 24,
      seed: Math.floor(random() * 4294967296),
    });
  });
  const winners: Record<Kingdom | "none", number> = {
    wei: 0,
    shu: 0,
    wu: 0,
    none: 0,
  };

  for (const game of games) {
    winners[game.winner ?? "none"] += 1;
  }
  const endgame = runEndgameBenchmark(profile, options);

  return {
    games: games.length,
    averagePlies: Math.round(games.reduce((sum, game) => sum + game.plies, 0) / games.length),
    earlyDefeats: games.reduce((sum, game) => sum + game.earlyDefeats, 0),
    winners,
    averageScore: Math.round(games.reduce((sum, game) => sum + game.score, 0) / games.length),
    naturalWins: games.filter((game) => game.winner && game.reason === "winner").length,
    repetitionStops: games.filter((game) => game.reason === "repetition").length,
    openingDiversity: new Set(games.map((game) => game.openingSignature)).size,
    averageSafety: Math.round(games.reduce((sum, game) => sum + game.safety, 0) / games.length),
    profitableCaptureMisses: games.reduce((sum, game) => sum + game.profitableCaptureMisses, 0),
    hangingPieceMisses: games.reduce((sum, game) => sum + game.hangingPieceMisses, 0),
    repeatedQuietMoves: games.reduce((sum, game) => sum + game.repeatedQuietMoves, 0),
    averageThinkMs: Math.round(games.reduce((sum, game) => sum + game.thinkMs, 0) / Math.max(1, games.reduce((sum, game) => sum + game.aiMoves, 0))),
    endgameNaturalWins: endgame.naturalWins,
    endgameBlunders: endgame.blunders,
    missedKillMoves: endgame.missedKillMoves,
  };
}

function playSelfPlayGame(
  profile: AiProfile,
  seedMoves: Array<{ pieceId: string; target: string }>,
  options: { maxPlies: number; seed: number },
): {
  winner: Kingdom | null;
  plies: number;
  earlyDefeats: number;
  score: number;
  reason: "winner" | "repetition" | "ply-limit" | "no-move";
  openingSignature: string;
  safety: number;
  profitableCaptureMisses: number;
  hangingPieceMisses: number;
  repeatedQuietMoves: number;
  thinkMs: number;
  aiMoves: number;
} {
  let state = createInitialGameState();
  let plies = 0;
  let earlyDefeats = 0;
  let reason: "winner" | "repetition" | "ply-limit" | "no-move" = "ply-limit";
  const positions = new Map<string, number>();
  let profitableCaptureMisses = 0;
  let hangingPieceMisses = 0;
  let repeatedQuietMoves = 0;
  let thinkMs = 0;
  let aiMoves = 0;

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

  while (!state.winner && plies < options.maxPlies) {
    const key = selfPlayStateKey(state);
    const repetition = (positions.get(key) ?? 0) + 1;

    positions.set(key, repetition);

    if (repetition >= 3) {
      reason = "repetition";
      break;
    }

    const beforeDefeats = state.defeatedKingdoms.length;
    const tacticalBaseline = tacticalBaselineFor(state, state.currentKingdom, profile);
    const startedAt = performance.now();
    const move = chooseAiMove(state, state.currentKingdom, profile, {
      style: aiStyleForKingdom(state.currentKingdom),
      seed: options.seed + plies * 97,
      timeBudgetMs: 40,
      maxDepth: 1,
      explorationRate: plies < 8 ? 0.18 : 0,
      explorationTop: 4,
      explorationSlack: 680,
      explorationTemperature: 420,
      openingSearchDepth: 0,
      maxQuiescenceDepth: 1,
      skillProfile: "fast",
    });
    thinkMs += performance.now() - startedAt;

    if (!move) {
      reason = "no-move";
      break;
    }

    aiMoves += 1;
    const capturedPiece = capturedPieceAt(state, move.pieceId, move.target);

    if (tacticalBaseline.hasProfitableCapture && !capturedPiece) {
      profitableCaptureMisses += 1;
    }

    if (
      plies >= 12 &&
      tacticalBaseline.hangingPieceId &&
      move.pieceId !== tacticalBaseline.hangingPieceId &&
      !capturesThreateningPiece(state, move, tacticalBaseline.hangingPieceId)
    ) {
      hangingPieceMisses += 1;
    }

    if (!capturedPiece && reversesRecentOwnQuietMove(state, move)) {
      repeatedQuietMoves += 1;
    }

    state = applyMove(state, move.pieceId, move.target);
    plies += 1;

    if (plies <= 16 && state.defeatedKingdoms.length > beforeDefeats) {
      earlyDefeats += state.defeatedKingdoms.length - beforeDefeats;
    }
  }

  if (state.winner) {
    reason = "winner";
  }

  const score = kingdoms.reduce((sum, kingdom) => {
    return sum + evaluateAiState(state, kingdom, profile, aiStyleForKingdom(kingdom));
  }, 0);
  const safety = kingdoms.reduce((sum, kingdom) => {
    return sum + (state.defeatedKingdoms.includes(kingdom) ? -10_000 : evaluateAiState(state, kingdom, profile, aiStyleForKingdom(kingdom)));
  }, 0);

  return {
    winner: state.winner,
    plies,
    earlyDefeats,
    score,
    reason,
    openingSignature: seedMoves.map((move) => `${move.pieceId}-${move.target}`).join(",") || "initial",
    safety,
    profitableCaptureMisses,
    hangingPieceMisses,
    repeatedQuietMoves,
    thinkMs,
    aiMoves,
  };
}

function tacticalBaselineFor(
  state: GameState,
  kingdom: Kingdom,
  profile: AiProfile,
): {
  hasProfitableCapture: boolean;
  hangingPieceId: string | null;
} {
  const actions = state.pieces
    .filter((piece) => piece.controller === kingdom && piece.blocksMovement && !piece.defeated)
    .flatMap((piece) => {
      return getLegalMoves(state, piece).map((target) => ({ pieceId: piece.id, from: piece.position, target }));
    });
  const hasProfitableCapture = actions.some((action) => {
    const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
    const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

    return Boolean(
      movingPiece &&
        capturedPiece &&
        !capturedPiece.defeated &&
        (capturedPiece.type === "general" || localPieceValue(capturedPiece, profile) >= localPieceValue(movingPiece, profile) * 0.55),
    );
  });
  const hangingPiece = state.pieces
    .filter((piece) => piece.controller === kingdom && piece.blocksMovement && !piece.defeated)
    .filter((piece) => piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse")
    .find((piece) => isSeriouslyHanging(state, piece, kingdom, profile));

  return {
    hasProfitableCapture,
    hangingPieceId: hangingPiece?.id ?? null,
  };
}

function capturesThreateningPiece(state: GameState, move: AiMove, hangingPieceId: string): boolean {
  const hangingPiece = state.pieces.find((piece) => piece.id === hangingPieceId);
  const capturedPiece = capturedPieceAt(state, move.pieceId, move.target);

  return Boolean(hangingPiece && capturedPiece && getLegalMoves(state, capturedPiece).includes(hangingPiece.position));
}

function reversesRecentOwnQuietMove(state: GameState, move: AiMove): boolean {
  const movingPiece = state.pieces.find((piece) => piece.id === move.pieceId);
  const lastOwnMove = (state.moveHistory ?? []).filter((record) => record.kingdom === movingPiece?.controller).at(-1);

  return Boolean(lastOwnMove && lastOwnMove.pieceId === move.pieceId && lastOwnMove.from === move.target && lastOwnMove.target === move.from);
}

function isSeriouslyHanging(state: GameState, piece: Piece, kingdom: Kingdom, profile: AiProfile): boolean {
  const attackers = state.pieces.filter((candidate) => {
    return candidate.controller !== kingdom && candidate.blocksMovement && !candidate.defeated && getLegalMoves(state, candidate).includes(piece.position);
  });

  if (!attackers.length) {
    return false;
  }

  const defenders = state.pieces.filter((candidate) => {
    return candidate.controller === kingdom && candidate.id !== piece.id && candidate.blocksMovement && !candidate.defeated && getLegalMoves(state, candidate).includes(piece.position);
  });

  return defenders.length === 0 || Math.min(...attackers.map((attacker) => localPieceValue(attacker, profile))) < localPieceValue(piece, profile) - 220;
}

function localPieceValue(piece: Piece, profile: AiProfile): number {
  return profile.pieceValues[piece.type];
}

function runEndgameBenchmark(
  profile: AiProfile,
  options: AiBenchmarkOptions,
): {
  naturalWins: number;
  blunders: number;
  missedKillMoves: number;
} {
  let naturalWins = 0;
  let blunders = 0;
  let missedKillMoves = 0;

  for (const [index, startState] of endgameSeeds().entries()) {
    let state = startState;

    for (let ply = 0; !state.winner && ply < Math.min(10, options.maxPlies ?? 10); ply += 1) {
      const baseline = tacticalBaselineFor(state, state.currentKingdom, profile);
      const killMoves = directGeneralCaptureMoves(state, state.currentKingdom);
      const move = chooseAiMove(state, state.currentKingdom, profile, {
        style: aiStyleForKingdom(state.currentKingdom),
        seed: (options.seed ?? 20260507) + index * 997 + ply * 37,
        timeBudgetMs: 80,
        maxDepth: 2,
        openingSearchDepth: 0,
        maxQuiescenceDepth: 2,
        skillProfile: "tactical",
      });

      if (!move) {
        blunders += 1;
        break;
      }

      const capturedPiece = capturedPieceAt(state, move.pieceId, move.target);

      if (killMoves.length && !killMoves.some((item) => item.pieceId === move.pieceId && item.target === move.target)) {
        missedKillMoves += 1;
      }

      if (baseline.hangingPieceId && move.pieceId !== baseline.hangingPieceId && !capturesThreateningPiece(state, move, baseline.hangingPieceId)) {
        blunders += 1;
      }

      if (baseline.hasProfitableCapture && !capturedPiece) {
        blunders += 1;
      }

      state = applyMove(state, move.pieceId, move.target);
    }

    if (state.winner) {
      naturalWins += 1;
    }
  }

  return { naturalWins, blunders, missedKillMoves };
}

function directGeneralCaptureMoves(state: GameState, kingdom: Kingdom): AiMove[] {
  return state.pieces
    .filter((piece) => piece.controller === kingdom && piece.blocksMovement && !piece.defeated)
    .flatMap((piece) => {
      return getLegalMoves(state, piece).flatMap((target) => {
        const capturedPiece = capturedPieceAt(state, piece.id, target);

        return capturedPiece?.type === "general" ? [{ pieceId: piece.id, from: piece.position, target }] : [];
      });
    });
}

function endgameSeeds(): GameState[] {
  return [
    labState(
      [
        labPiece("wei-general", "general", "魏", "E5", "wei"),
        labPiece("wei-chariot", "chariot", "车", "A5", "wei"),
        labPiece("wu-general", "general", "吴", "F5", "wu"),
      ],
      "wei",
      ["shu"],
    ),
    labState(
      [
        labPiece("wu-general", "general", "吴", "J5", "wu"),
        labPiece("wu-chariot", "chariot", "车", "F5", "wu"),
        labPiece("wei-chariot", "chariot", "车", "F6", "wei"),
        labPiece("wei-general", "general", "魏", "E4", "wei"),
        labPiece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wu",
    ),
    labState(
      [
        labPiece("shu-general", "general", "蜀", "O5", "shu"),
        labPiece("shu-chariot", "chariot", "车", "K5", "shu"),
        labPiece("wei-general", "general", "魏", "A5", "wei"),
        labPiece("wu-general", "general", "吴", "J4", "wu"),
        labPiece("wu-horse", "horse", "马", "F6", "wu"),
      ],
      "shu",
    ),
  ];
}

function labState(pieces: Piece[], currentKingdom: Kingdom, defeatedKingdoms: Kingdom[] = []): GameState {
  return {
    pieces,
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom,
    checkedKingdoms: [],
    winner: null,
    lastMoveMessage: null,
    defeatedKingdoms,
    options: { defeatedPieceMode: "remove", defeatCondition: "capture" },
    moveHistory: [],
  };
}

function labPiece(id: string, type: Piece["type"], label: string, position: Piece["position"], kingdom: Kingdom): Piece {
  return {
    id,
    type,
    label,
    position,
    kingdom,
    controller: kingdom,
    color: kingdom === "wei" ? "red" : kingdom === "wu" ? "blue" : "green",
    defeated: false,
    blocksMovement: true,
  };
}

function openingSeeds(): Array<Array<{ pieceId: string; target: string }>> {
  return [
    [],
    [{ pieceId: "wei-soldier-5", target: "A5" }],
    [{ pieceId: "wei-horse-left", target: "C1" }],
    [
      { pieceId: "wei-soldier-5", target: "A5" },
      { pieceId: "shu-soldier-5", target: "O5" },
    ],
    [
      { pieceId: "wei-horse-left", target: "C1" },
      { pieceId: "shu-horse-left", target: "M1" },
    ],
    [
      { pieceId: "wei-soldier-3", target: "A3" },
      { pieceId: "shu-soldier-7", target: "O7" },
      { pieceId: "wu-soldier-5", target: "F5" },
    ],
  ];
}

function mutateProfile(profile: AiProfile, random: () => number): AiProfile {
  const next = cloneProfile(profile);
  const group = mutationGroups[Math.floor(random() * mutationGroups.length)];
  const fieldCount = 2 + Math.floor(random() * Math.min(3, group.length));
  const fields = shuffle([...group], random).slice(0, fieldCount);

  for (const field of fields) {
    const factor = 0.82 + random() * 0.4;
    const value = next.scoring[field];

    next.scoring[field] = Math.round(value * factor * 1000) / 1000;
  }

  return next;
}

const mutationGroups: Array<Array<keyof AiProfile["scoring"]>> = [
  ["rootActionWeight", "capturedValueMultiplier", "tradeDeltaMultiplier", "tacticalPieceRiskMultiplier"],
  ["badTradeMultiplier", "exposedTradeMultiplier", "directAttackerPenalty", "checkedSelfPenalty"],
  ["openingRaidPenalty", "defenderBonus", "generalAwayPenalty", "palacePressurePenalty"],
  ["kingDefensePalaceCapture", "kingDefenseAttackerCapture", "directCheckPenalty", "balanceGapPenalty"],
];

function blendProfiles(best: AiProfile, original: AiProfile, random: () => number): AiProfile {
  const next = cloneProfile(best);

  for (const field of tunableScalars) {
    if (random() < 0.18) {
      next.scoring[field] = original.scoring[field];
    }
  }

  return next;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const item = items[index];

    items[index] = items[swapIndex];
    items[swapIndex] = item;
  }

  return items;
}

function selfPlayStateKey(state: GameState): string {
  const pieces = state.pieces
    .filter((piece) => piece.blocksMovement)
    .map((piece) => `${piece.id}:${piece.position}:${piece.controller}:${piece.defeated ? 1 : 0}`)
    .sort()
    .join("|");

  return `${state.currentKingdom}|${pieces}`;
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
