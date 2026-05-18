import { readFileSync, writeFileSync } from "node:fs";
import { chooseAiMove, clearEvalCache, clearTranspositionTable, createSearchStats, type AiMoveOptions, type SearchStats } from "./ai";
import { materialByController, pieceValue } from "./ai/evaluate";
import { isObviousBadMove } from "./ai-match-tactics";
import { aiStyleForKingdom, cloneAiProfile, defaultAiProfile, type AiProfile, type OpponentModel } from "./ai-profile";
import type { Kingdom } from "./board";
import { capturedPieceAt, createInitialGameState, type GameState } from "./game-state";
import { applyMove } from "./rules";

export type MaterialPhase = "leading" | "even" | "behind";

const kingdoms: Kingdom[] = ["wei", "shu", "wu"];

/** 单局内一方 AI 的配置（profile + 搜索选项 + 报告标签） */
export interface AiPlayerSlot {
  label: string;
  profile: AiProfile;
  moveOptions?: Partial<AiMoveOptions>;
}

export interface AiMatchSetup {
  matchName: string;
  kingdomSlots: Record<Kingdom, AiPlayerSlot>;
}

export interface AiMatchEvalOptions {
  games?: number;
  seed?: number;
  maxPlies?: number;
  /** 每局开始前是否清空置换表，保证对比公平 */
  clearTranspositionEachGame?: boolean;
  /** 是否使用开局变例种子（与 ai-lab 同源） */
  useOpeningSeeds?: boolean;
  /** 领先判定阈值（子力差） */
  materialLeadThreshold?: number;
  /** 自定义每局 kingdom 槽位轮换；默认按 gameIndex % 3 轮换 challenger */
  rotateKingdomSlots?: boolean;
  /** 是否在报告中包含逐局明细（大批量对弈建议关闭） */
  includeGameRecords?: boolean;
  /** 大批量对弈时每 N 局写入一次检查点 JSON（防中断丢数据） */
  checkpointEvery?: number;
  checkpointPath?: string;
  /** 每局结束后清空 eval 缓存（减轻大批量 OOM） */
  clearEvalCacheEachGame?: boolean;
  /** 是否记录子力阶段分段胜率 */
  trackPhaseStats?: boolean;
  /** 从第几局开始（用于断点续跑 / 分块对弈，保证座位轮换与随机序列连续） */
  startGameIndex?: number;
  /** 总目标局数（聚合时分母；默认等于 games 或 startGameIndex + games） */
  totalGames?: number;
}

export interface AiMatchGameRecord {
  gameIndex: number;
  winner: Kingdom | null;
  winnerLabel: string | null;
  endReason: "winner" | "repetition" | "ply-limit" | "no-move" | "stalemate";
  plies: number;
  finalScores: Record<Kingdom, number>;
  finalMaterial: Record<Kingdom, number>;
  defeatedKingdoms: Kingdom[];
  checkmateDefeats: number;
  timeoutMoves: number;
  zeroSearchMoves: number;
  obviousBadMoves: number;
  phaseSamples?: Array<{ label: string; phase: MaterialPhase }>;
  labels: Record<Kingdom, string>;
  perLabel: Record<
    string,
    {
      moves: number;
      totalNodes: number;
      totalQuiescenceNodes: number;
      totalTtHits: number;
      totalTtStores: number;
      totalThinkMs: number;
      captureProfit: number;
      timesChecked: number;
      timesDefeated: number;
      comebackLosses: number;
      hadMaterialLead: boolean;
      zeroSearchMoves: number;
      obviousBadMoves: number;
    }
  >;
  openingSignature: string;
}

export interface AiMatchEvalReport {
  matchName: string;
  games: number;
  seed: number;
  maxPlies: number;
  generatedAt: string;
  slotLabels: string[];
  winRate: Record<string, number>;
  avgTurns: number;
  endReasonCounts: Record<AiMatchGameRecord["endReason"], number>;
  avgNodes: Record<string, number>;
  /** 每步平均静态搜索节点数 */
  avgQuiescenceNodes: Record<string, number>;
  avgTtHits: Record<string, number>;
  avgTtStores: Record<string, number>;
  avgThinkMs: Record<string, number>;
  avgCaptureProfit: Record<string, number>;
  checkmateDefeats: Record<string, number>;
  timesChecked: Record<string, number>;
  comebackLosses: Record<string, number>;
  timeoutMoves: number;
  zeroSearchMoves: number;
  totalObviousBadMoves: number;
  obviousBadMovesByLabel: Record<string, number>;
  avgFinalScores: Record<Kingdom, number>;
  naturalWinRate: number;
  phaseWinRate?: Partial<Record<MaterialPhase, Record<string, number>>>;
  notes?: string;
  gamesCompleted: number;
  gameRecords?: AiMatchGameRecord[];
}

/** 对弈评估默认关闭探索；具体时限由 slot.moveOptions 覆盖 */
export const defaultMatchMoveOptions: Partial<AiMoveOptions> = {
  explorationRate: 0,
  openingSearchDepth: 0,
  skillProfile: "balanced",
  maxQuiescenceDepth: 3,
};

/**
 * 构建 1v2 对比：指定一方为 challenger，其余两方为 baseline（标签用于胜率统计）。
 */
export function createHeadToHeadMatchSetup(
  matchName: string,
  challenger: AiPlayerSlot,
  baseline: AiPlayerSlot,
  challengerKingdom: Kingdom,
): AiMatchSetup {
  const kingdomSlots = {} as Record<Kingdom, AiPlayerSlot>;

  for (const kingdom of kingdoms) {
    kingdomSlots[kingdom] = kingdom === challengerKingdom ? challenger : baseline;
  }

  return { matchName, kingdomSlots };
}

/**
 * 轮换 challenger 所在势力，使三方座位公平。
 */
export function rotateHeadToHeadSetup(
  matchName: string,
  challenger: AiPlayerSlot,
  baseline: AiPlayerSlot,
  gameIndex: number,
): AiMatchSetup {
  const challengerKingdom = kingdoms[gameIndex % kingdoms.length];
  return createHeadToHeadMatchSetup(matchName, challenger, baseline, challengerKingdom);
}

export function runAiMatchEval(setup: AiMatchSetup, options: AiMatchEvalOptions = {}): AiMatchEvalReport {
  const games = options.games ?? 100;
  const startGameIndex = options.startGameIndex ?? 0;
  const totalGames = options.totalGames ?? startGameIndex + games;
  const seed = options.seed ?? 20260515;
  const maxPlies = options.maxPlies ?? 240;
  const clearTt = options.clearTranspositionEachGame ?? true;
  const clearEvalEach = options.clearEvalCacheEachGame ?? totalGames >= 20;
  const useOpeningSeeds = options.useOpeningSeeds ?? true;
  const leadThreshold = options.materialLeadThreshold ?? 600;
  const random = seededRandom(seed);
  const gameRecords: AiMatchGameRecord[] = [];
  const openingSeeds = useOpeningSeeds ? matchOpeningSeeds() : [[]];

  for (let offset = 0; offset < startGameIndex; offset += 1) {
    random();
  }

  for (let offset = 0; offset < games; offset += 1) {
    const gameIndex = startGameIndex + offset;
    const rotatedSetup =
      options.rotateKingdomSlots === false
        ? setup
        : inferRotatedSetup(setup, gameIndex);
    const seedMoves = openingSeeds[gameIndex % openingSeeds.length];
    const gameSeed = Math.floor(random() * 4294967296);

    if (clearTt) {
      clearTranspositionTable();
    } else if (clearEvalEach) {
      clearEvalCache();
    }

    gameRecords.push(
      playMatchGame(rotatedSetup, {
        gameIndex,
        seedMoves,
        gameSeed,
        maxPlies,
        leadThreshold,
        trackPhaseStats: options.trackPhaseStats ?? false,
      }),
    );

    if (clearEvalEach) {
      clearEvalCache();
    }

    if ((gameIndex + 1) % 10 === 0 || offset + 1 === games) {
      console.error(`[ai-match-eval] ${setup.matchName}: ${gameIndex + 1}/${totalGames} games`);
    }

    const checkpointEvery = options.checkpointEvery ?? 0;
    if (
      options.checkpointPath &&
      checkpointEvery > 0 &&
      (gameIndex + 1) % checkpointEvery === 0
    ) {
      writeCheckpoint(
        options.checkpointPath,
        aggregateMatchReport(setup.matchName, totalGames, seed, maxPlies, gameRecords, true),
      );
    }
  }

  const report = aggregateMatchReport(setup.matchName, totalGames, seed, maxPlies, gameRecords, false);

  if (!options.includeGameRecords) {
    delete (report as { gameRecords?: AiMatchGameRecord[] }).gameRecords;
  }

  return report;
}

function inferRotatedSetup(setup: AiMatchSetup, gameIndex: number): AiMatchSetup {
  const labels = uniqueSlotLabels(setup);
  if (labels.length !== 2) {
    return setup;
  }

  const [challengerLabel, baselineLabel] = pickChallengerBaselineLabels(setup, labels);
  const challengerSlot = kingdoms.map((k) => setup.kingdomSlots[k]).find((s) => s.label === challengerLabel)!;
  const baselineSlot = kingdoms.map((k) => setup.kingdomSlots[k]).find((s) => s.label === baselineLabel)!;
  return rotateHeadToHeadSetup(setup.matchName, challengerSlot, baselineSlot, gameIndex);
}

function pickChallengerBaselineLabels(setup: AiMatchSetup, labels: string[]): [string, string] {
  const counts = new Map<string, number>();
  for (const kingdom of kingdoms) {
    const label = setup.kingdomSlots[kingdom].label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const sorted = [...labels].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));
  return [sorted[0], sorted[1]];
}

function uniqueSlotLabels(setup: AiMatchSetup): string[] {
  return [...new Set(kingdoms.map((k) => setup.kingdomSlots[k].label))];
}

export function classifyMaterialPhase(state: GameState, kingdom: Kingdom, profile: AiProfile = defaultAiProfile): MaterialPhase {
  if (state.defeatedKingdoms.includes(kingdom)) {
    return "behind";
  }

  const material = materialByController(state, profile);
  const opponents = kingdoms.filter((k) => k !== kingdom && !state.defeatedKingdoms.includes(k));
  const aiMat = material[kingdom];
  const maxOpp = opponents.length ? Math.max(...opponents.map((k) => material[k])) : 0;
  const minOpp = opponents.length ? Math.min(...opponents.map((k) => material[k])) : 0;
  const leadVsMax = aiMat - maxOpp;

  if (leadVsMax >= 500) {
    return "leading";
  }

  if (leadVsMax <= -400) {
    return "behind";
  }

  if (maxOpp - minOpp < 350) {
    return "even";
  }

  return aiMat >= (maxOpp + minOpp) / 2 ? "leading" : "behind";
}

function playMatchGame(
  setup: AiMatchSetup,
  options: {
    gameIndex: number;
    seedMoves: Array<{ pieceId: string; target: string }>;
    gameSeed: number;
    maxPlies: number;
    leadThreshold: number;
    trackPhaseStats: boolean;
  },
): AiMatchGameRecord {
  let state = createInitialGameState();
  let plies = 0;
  let endReason: AiMatchGameRecord["endReason"] = "ply-limit";
  let timeoutMoves = 0;
  let zeroSearchMoves = 0;
  let obviousBadMoves = 0;
  const phaseSamples: Array<{ label: string; phase: MaterialPhase }> = [];
  const positions = new Map<string, number>();
  const labels: Record<Kingdom, string> = {
    wei: setup.kingdomSlots.wei.label,
    shu: setup.kingdomSlots.shu.label,
    wu: setup.kingdomSlots.wu.label,
  };

  const perLabel = initPerLabelStats(uniqueSlotLabels(setup));

  const leadTracker = new Map<string, { maxLead: number; hadLead: boolean }>();
  for (const label of Object.keys(perLabel)) {
    leadTracker.set(label, { maxLead: 0, hadLead: false });
  }

  for (const seed of options.seedMoves) {
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
    const key = matchStateKey(state);
    const repetition = (positions.get(key) ?? 0) + 1;
    positions.set(key, repetition);

    if (repetition >= 3) {
      endReason = "repetition";
      break;
    }

    const kingdom = state.currentKingdom;
    const slot = setup.kingdomSlots[kingdom];
    const label = slot.label;

    if (options.trackPhaseStats) {
      phaseSamples.push({
        label,
        phase: classifyMaterialPhase(state, kingdom, slot.profile),
      });
    }

    const beforeDefeated = new Set(state.defeatedKingdoms);
    const stats = createSearchStats();
    const startedAt = performance.now();
    let move: ReturnType<typeof chooseAiMove>;
    try {
      move = chooseAiMove(state, kingdom, slot.profile, buildMoveOptions(slot, kingdom, options.gameSeed, plies, stats));
    } catch (error) {
      console.error(`[ai-match-eval] chooseAiMove failed game ${options.gameIndex} ply ${plies}:`, error);
      endReason = "no-move";
      break;
    }
    const thinkMs = performance.now() - startedAt;

    if (!move) {
      endReason = state.defeatedKingdoms.includes(kingdom) ? "stalemate" : "no-move";
      break;
    }

    const captured = capturedPieceAt(state, move.pieceId, move.target);
    const movingPiece = state.pieces.find((piece) => piece.id === move.pieceId);
    const labelStats = perLabel[label];

    labelStats.moves += 1;
    labelStats.totalNodes += stats.nodes;
    labelStats.totalQuiescenceNodes += stats.quiescenceNodes;
    labelStats.totalTtHits += stats.ttHits;
    labelStats.totalTtStores += stats.ttStores;
    labelStats.totalThinkMs += thinkMs;

    if (stats.timedOut) {
      timeoutMoves += 1;
    }

    if (stats.nodes === 0) {
      zeroSearchMoves += 1;
      labelStats.zeroSearchMoves += 1;
    }

    if (isObviousBadMove(state, kingdom, move, slot.profile, plies)) {
      obviousBadMoves += 1;
      labelStats.obviousBadMoves += 1;
    }

    if (captured && movingPiece && !captured.defeated) {
      labelStats.captureProfit += pieceValue(captured, slot.profile) - pieceValue(movingPiece, slot.profile) * 0.15;
    }

    state = applyMove(state, move.pieceId, move.target);
    plies += 1;

    if (state.checkedKingdoms.includes(kingdom)) {
      labelStats.timesChecked += 1;
    }

    for (const defeated of state.defeatedKingdoms) {
      if (!beforeDefeated.has(defeated)) {
        const defeatedLabel = labels[defeated];
        perLabel[defeatedLabel].timesDefeated += 1;
      }
    }

    updateMaterialLeads(state, setup, leadTracker, options.leadThreshold);
  }

  if (state.winner) {
    endReason = "winner";
  }

  const finalMaterial = materialByController(state, defaultAiProfile);
  const finalScores: Record<Kingdom, number> = { wei: 0, shu: 0, wu: 0 };
  for (const kingdom of kingdoms) {
    finalScores[kingdom] = finalMaterial[kingdom];
  }

  const winnerLabel = state.winner ? labels[state.winner] : null;

  for (const label of Object.keys(perLabel)) {
    const tracker = leadTracker.get(label)!;
    perLabel[label].hadMaterialLead = tracker.hadLead;

    const lostAfterLead =
      tracker.hadLead && (perLabel[label].timesDefeated > 0 || (state.winner !== null && labels[state.winner] !== label));

    if (lostAfterLead) {
      perLabel[label].comebackLosses += 1;
    }
  }

  let checkmateDefeats = 0;
  for (const kingdom of state.defeatedKingdoms) {
    if (wasCheckmateDefeat(state, kingdom)) {
      checkmateDefeats += 1;
    }
  }

  return {
    gameIndex: options.gameIndex,
    winner: state.winner,
    winnerLabel,
    endReason,
    plies,
    finalScores,
    finalMaterial,
    defeatedKingdoms: [...state.defeatedKingdoms],
    checkmateDefeats,
    timeoutMoves,
    zeroSearchMoves,
    obviousBadMoves,
    phaseSamples: options.trackPhaseStats ? phaseSamples : undefined,
    labels,
    perLabel,
    openingSignature: options.seedMoves.map((m) => `${m.pieceId}-${m.target}`).join(",") || "initial",
  };
}

function buildMoveOptions(
  slot: AiPlayerSlot,
  kingdom: Kingdom,
  gameSeed: number,
  ply: number,
  stats: SearchStats,
): AiMoveOptions {
  return {
    style: aiStyleForKingdom(kingdom),
    seed: gameSeed + ply * 97,
    debugStats: stats,
    maxDepth: slot.profile.searchDepth,
    ...defaultMatchMoveOptions,
    ...slot.moveOptions,
  };
}

function initPerLabelStats(labels: string[]): AiMatchGameRecord["perLabel"] {
  const perLabel: AiMatchGameRecord["perLabel"] = {};
  for (const label of labels) {
    perLabel[label] = {
      moves: 0,
      totalNodes: 0,
      totalQuiescenceNodes: 0,
      totalTtHits: 0,
      totalTtStores: 0,
      totalThinkMs: 0,
      captureProfit: 0,
      timesChecked: 0,
      timesDefeated: 0,
      comebackLosses: 0,
      hadMaterialLead: false,
      zeroSearchMoves: 0,
      obviousBadMoves: 0,
    };
  }
  return perLabel;
}

function updateMaterialLeads(
  state: GameState,
  setup: AiMatchSetup,
  leadTracker: Map<string, { maxLead: number; hadLead: boolean }>,
  threshold: number,
): void {
  const material = materialByController(state, defaultAiProfile);
  const byLabel = new Map<string, number>();

  for (const kingdom of kingdoms) {
    if (state.defeatedKingdoms.includes(kingdom)) {
      continue;
    }
    const label = setup.kingdomSlots[kingdom].label;
    byLabel.set(label, (byLabel.get(label) ?? 0) + material[kingdom]);
  }

  const totals = [...byLabel.entries()];
  for (const [label, total] of totals) {
    const others = totals.filter(([other]) => other !== label).map(([, value]) => value);
    const second = others.length ? Math.max(...others) : 0;
    const lead = total - second;
    const tracker = leadTracker.get(label)!;
    tracker.maxLead = Math.max(tracker.maxLead, lead);
    if (lead >= threshold) {
      tracker.hadLead = true;
    }
  }
}

function wasCheckmateDefeat(state: GameState, kingdom: Kingdom): boolean {
  if (state.options.defeatCondition !== "checkmate") {
    return false;
  }
  const general = state.pieces.find((piece) => piece.kingdom === kingdom && piece.type === "general");
  return Boolean(general && !general.defeated && state.checkedKingdoms.includes(kingdom));
}

function writeCheckpoint(path: string, report: AiMatchEvalReport): void {
  const snapshot = { ...report, partial: true as const };
  delete (snapshot as { gameRecords?: AiMatchGameRecord[] }).gameRecords;
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export function loadMatchCheckpoint(path: string): AiMatchEvalReport | null {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as AiMatchEvalReport;
  } catch {
    return null;
  }
}

/** 合并多段对弈报告（分块子进程或断点续跑后的各段） */
export function mergeMatchReports(
  segments: AiMatchEvalReport[],
  totalGames: number,
): AiMatchEvalReport {
  if (segments.length === 0) {
    throw new Error("mergeMatchReports: no segments");
  }

  const base = segments[0];
  const slotLabels = [...new Set(segments.flatMap((s) => s.slotLabels))];
  let completed = 0;
  const winCounts = Object.fromEntries(slotLabels.map((l) => [l, 0])) as Record<string, number>;
  let draws = 0;
  const endReasonCounts: AiMatchEvalReport["endReasonCounts"] = {
    winner: 0,
    repetition: 0,
    "ply-limit": 0,
    "no-move": 0,
    stalemate: 0,
  };
  const sumNodes = Object.fromEntries(slotLabels.map((l) => [l, 0])) as Record<string, number>;
  const sumQuiescence = { ...sumNodes };
  const sumTtHits = { ...sumNodes };
  const sumTtStores = { ...sumNodes };
  const sumThink = { ...sumNodes };
  const sumCapture = { ...sumNodes };
  const sumMoves = { ...sumNodes };
  const checkmateDefeats: Record<string, number> = { ...sumNodes };
  const timesChecked: Record<string, number> = { ...sumNodes };
  const comebackLosses: Record<string, number> = { ...sumNodes };
  const obviousBadMovesByLabel: Record<string, number> = { ...sumNodes };
  let timeoutMoves = 0;
  let zeroSearchMoves = 0;
  let totalObviousBadMoves = 0;
  let totalPlies = 0;
  let naturalWins = 0;
  const sumFinalScores: Record<Kingdom, number> = { wei: 0, shu: 0, wu: 0 };
  const phaseWins: Record<MaterialPhase, Record<string, number>> = {
    leading: {},
    even: {},
    behind: {},
  };
  const phaseGames: Record<MaterialPhase, Record<string, number>> = {
    leading: {},
    even: {},
    behind: {},
  };

  for (const segment of segments) {
    const n = segment.gamesCompleted;
    completed += n;
    totalPlies += segment.avgTurns * n;
    timeoutMoves += segment.timeoutMoves;
    zeroSearchMoves += segment.zeroSearchMoves;
    totalObviousBadMoves += segment.totalObviousBadMoves;
    naturalWins += segment.endReasonCounts.winner;

    for (const reason of Object.keys(endReasonCounts) as Array<keyof typeof endReasonCounts>) {
      endReasonCounts[reason] += segment.endReasonCounts[reason];
    }

    draws += (segment.winRate.draw ?? 0) * n;

    for (const label of slotLabels) {
      winCounts[label] += (segment.winRate[label] ?? 0) * n;
    }

    for (const kingdom of kingdoms) {
      sumFinalScores[kingdom] += segment.avgFinalScores[kingdom] * n;
    }

    for (const label of slotLabels) {
      const moves = estimateMoves(segment, label);
      sumNodes[label] = (sumNodes[label] ?? 0) + (segment.avgNodes[label] ?? 0) * moves;
      sumQuiescence[label] = (sumQuiescence[label] ?? 0) + (segment.avgQuiescenceNodes[label] ?? 0) * moves;
      sumTtHits[label] = (sumTtHits[label] ?? 0) + (segment.avgTtHits[label] ?? 0) * moves;
      sumTtStores[label] = (sumTtStores[label] ?? 0) + (segment.avgTtStores[label] ?? 0) * moves;
      sumThink[label] = (sumThink[label] ?? 0) + (segment.avgThinkMs[label] ?? 0) * moves;
      sumCapture[label] = (sumCapture[label] ?? 0) + (segment.avgCaptureProfit[label] ?? 0) * moves;
      sumMoves[label] = (sumMoves[label] ?? 0) + moves;
      checkmateDefeats[label] = (checkmateDefeats[label] ?? 0) + (segment.checkmateDefeats[label] ?? 0);
      timesChecked[label] = (timesChecked[label] ?? 0) + (segment.timesChecked[label] ?? 0);
      comebackLosses[label] = (comebackLosses[label] ?? 0) + (segment.comebackLosses[label] ?? 0);
      obviousBadMovesByLabel[label] =
        (obviousBadMovesByLabel[label] ?? 0) + (segment.obviousBadMovesByLabel[label] ?? 0);
    }

    if (segment.phaseWinRate) {
      for (const phase of ["leading", "even", "behind"] as MaterialPhase[]) {
        const phaseRecord = segment.phaseWinRate[phase];
        if (!phaseRecord) {
          continue;
        }
        for (const label of slotLabels) {
          const rate = phaseRecord[label];
          if (rate === undefined) {
            continue;
          }
          const gamesInPhase = Math.max(1, Math.round(n / 3));
          phaseWins[phase][label] = (phaseWins[phase][label] ?? 0) + Math.round(rate * gamesInPhase);
          phaseGames[phase][label] = (phaseGames[phase][label] ?? 0) + gamesInPhase;
        }
      }
    }
  }

  const winRate: Record<string, number> = {};
  for (const label of slotLabels) {
    winRate[label] = Math.round(((winCounts[label] ?? 0) / totalGames) * 1000) / 1000;
  }
  winRate.draw = Math.round((draws / totalGames) * 1000) / 1000;
  const winSum = slotLabels.reduce((sum, label) => sum + (winCounts[label] ?? 0), 0);
  if (Math.round(winSum + draws) < totalGames) {
    winRate.draw = Math.round(((totalGames - winSum) / totalGames) * 1000) / 1000;
  }

  const avgNodes: Record<string, number> = {};
  const avgQuiescenceNodes: Record<string, number> = {};
  const avgTtHits: Record<string, number> = {};
  const avgTtStores: Record<string, number> = {};
  const avgThinkMs: Record<string, number> = {};
  const avgCaptureProfit: Record<string, number> = {};

  for (const label of slotLabels) {
    const moves = sumMoves[label] || 1;
    avgNodes[label] = Math.round(sumNodes[label] / moves);
    avgQuiescenceNodes[label] = Math.round(sumQuiescence[label] / moves);
    avgTtHits[label] = Math.round(sumTtHits[label] / moves);
    avgTtStores[label] = Math.round(sumTtStores[label] / moves);
    avgThinkMs[label] = Math.round((sumThink[label] / moves) * 10) / 10;
    avgCaptureProfit[label] = Math.round(sumCapture[label] / moves);
  }

  const avgFinalScores: Record<Kingdom, number> = {
    wei: Math.round(sumFinalScores.wei / completed),
    shu: Math.round(sumFinalScores.shu / completed),
    wu: Math.round(sumFinalScores.wu / completed),
  };

  const phaseWinRate: Partial<Record<MaterialPhase, Record<string, number>>> = {};
  for (const phase of ["leading", "even", "behind"] as MaterialPhase[]) {
    const phaseRecord: Record<string, number> = {};
    for (const label of slotLabels) {
      const gamesInPhase = phaseGames[phase][label] ?? 0;
      if (gamesInPhase > 0) {
        phaseRecord[label] = Math.round(((phaseWins[phase][label] ?? 0) / gamesInPhase) * 1000) / 1000;
      }
    }
    if (Object.keys(phaseRecord).length > 0) {
      phaseWinRate[phase] = phaseRecord;
    }
  }

  return {
    matchName: base.matchName,
    games: totalGames,
    seed: base.seed,
    maxPlies: base.maxPlies,
    generatedAt: new Date().toISOString(),
    slotLabels,
    winRate,
    avgTurns: Math.round(totalPlies / completed),
    endReasonCounts,
    avgNodes,
    avgQuiescenceNodes,
    avgTtHits,
    avgTtStores,
    avgThinkMs,
    avgCaptureProfit,
    checkmateDefeats,
    timesChecked,
    comebackLosses,
    timeoutMoves,
    zeroSearchMoves,
    totalObviousBadMoves,
    obviousBadMovesByLabel,
    avgFinalScores,
    naturalWinRate: Math.round((naturalWins / totalGames) * 1000) / 1000,
    phaseWinRate: Object.keys(phaseWinRate).length > 0 ? phaseWinRate : undefined,
    gamesCompleted: completed,
    notes: `merged from ${segments.length} segment(s); ${completed}/${totalGames} games`,
  };
}

function estimateMoves(segment: AiMatchEvalReport, label: string): number {
  const avgNodes = segment.avgNodes[label] ?? 0;
  if (avgNodes <= 0) {
    return Math.max(1, Math.round(segment.avgTurns * 0.5));
  }
  return Math.max(1, Math.round(segment.avgTurns));
}

function aggregateMatchReport(
  matchName: string,
  games: number,
  seed: number,
  maxPlies: number,
  gameRecords: AiMatchGameRecord[],
  partial = false,
): AiMatchEvalReport {
  const completed = gameRecords.length;
  const rateDivisor = partial ? Math.max(1, completed) : games;
  const turnsDivisor = partial ? Math.max(1, completed) : games;
  const slotLabels = [
    ...new Set(gameRecords.flatMap((game) => Object.values(game.labels))),
  ];
  const winCounts = Object.fromEntries(slotLabels.map((label) => [label, 0])) as Record<string, number>;
  let draws = 0;

  const endReasonCounts: AiMatchEvalReport["endReasonCounts"] = {
    winner: 0,
    repetition: 0,
    "ply-limit": 0,
    "no-move": 0,
    stalemate: 0,
  };

  const sumNodes = Object.fromEntries(slotLabels.map((l) => [l, 0])) as Record<string, number>;
  const sumQuiescence = { ...sumNodes };
  const sumTtHits = { ...sumNodes };
  const sumTtStores = { ...sumNodes };
  const sumThink = { ...sumNodes };
  const sumCapture = { ...sumNodes };
  const sumMoves = { ...sumNodes };
  const checkmateDefeats: Record<string, number> = { ...sumNodes };
  const timesChecked: Record<string, number> = { ...sumNodes };
  const comebackLosses: Record<string, number> = { ...sumNodes };
  const obviousBadMovesByLabel: Record<string, number> = { ...sumNodes };
  let timeoutMoves = 0;
  let zeroSearchMoves = 0;
  let totalObviousBadMoves = 0;
  let totalPlies = 0;
  let naturalWins = 0;
  const sumFinalScores: Record<Kingdom, number> = { wei: 0, shu: 0, wu: 0 };
  const phaseWins: Record<MaterialPhase, Record<string, number>> = {
    leading: {},
    even: {},
    behind: {},
  };
  const phaseGames: Record<MaterialPhase, Record<string, number>> = {
    leading: {},
    even: {},
    behind: {},
  };

  for (const game of gameRecords) {
    endReasonCounts[game.endReason] += 1;
    totalPlies += game.plies;
    timeoutMoves += game.timeoutMoves;
    zeroSearchMoves += game.zeroSearchMoves;
    totalObviousBadMoves += game.obviousBadMoves;

    if (game.endReason === "winner") {
      naturalWins += 1;
    }

    for (const kingdom of kingdoms) {
      sumFinalScores[kingdom] += game.finalScores[kingdom];
    }

    if (game.winnerLabel) {
      winCounts[game.winnerLabel] = (winCounts[game.winnerLabel] ?? 0) + 1;
    } else {
      draws += 1;
    }

    if (game.phaseSamples?.length && game.winnerLabel) {
      const winnerSamples = game.phaseSamples.filter((s) => s.label === game.winnerLabel);
      const phaseCounts: Record<MaterialPhase, number> = { leading: 0, even: 0, behind: 0 };
      for (const sample of winnerSamples) {
        phaseCounts[sample.phase] += 1;
      }
      const dominant = (["leading", "even", "behind"] as MaterialPhase[]).sort(
        (a, b) => phaseCounts[b] - phaseCounts[a],
      )[0];
      phaseWins[dominant][game.winnerLabel] = (phaseWins[dominant][game.winnerLabel] ?? 0) + 1;
      for (const label of slotLabels) {
        const labelPhases = new Set(game.phaseSamples.filter((s) => s.label === label).map((s) => s.phase));
        for (const phase of labelPhases) {
          phaseGames[phase][label] = (phaseGames[phase][label] ?? 0) + 1;
        }
      }
    }

    for (const label of slotLabels) {
      const stats = game.perLabel[label];
      if (!stats) {
        continue;
      }
      sumNodes[label] += stats.totalNodes;
      sumQuiescence[label] += stats.totalQuiescenceNodes;
      sumTtHits[label] += stats.totalTtHits;
      sumTtStores[label] += stats.totalTtStores;
      sumThink[label] += stats.totalThinkMs;
      sumCapture[label] += stats.captureProfit;
      sumMoves[label] += stats.moves;
      checkmateDefeats[label] += stats.timesDefeated;
      timesChecked[label] += stats.timesChecked;
      comebackLosses[label] += stats.comebackLosses;
      obviousBadMovesByLabel[label] += stats.obviousBadMoves;
    }
  }

  const winRate: Record<string, number> = {};
  for (const label of slotLabels) {
    winRate[label] = Math.round(((winCounts[label] ?? 0) / rateDivisor) * 1000) / 1000;
  }
  winRate.draw = Math.round((draws / rateDivisor) * 1000) / 1000;

  const avgNodes: Record<string, number> = {};
  const avgQuiescenceNodes: Record<string, number> = {};
  const avgTtHits: Record<string, number> = {};
  const avgTtStores: Record<string, number> = {};
  const avgThinkMs: Record<string, number> = {};
  const avgCaptureProfit: Record<string, number> = {};

  for (const label of slotLabels) {
    const moves = sumMoves[label] || 1;
    avgNodes[label] = Math.round(sumNodes[label] / moves);
    avgQuiescenceNodes[label] = Math.round(sumQuiescence[label] / moves);
    avgTtHits[label] = Math.round(sumTtHits[label] / moves);
    avgTtStores[label] = Math.round(sumTtStores[label] / moves);
    avgThinkMs[label] = Math.round((sumThink[label] / moves) * 10) / 10;
    avgCaptureProfit[label] = Math.round(sumCapture[label] / moves);
  }

  const avgFinalScores: Record<Kingdom, number> = {
    wei: Math.round(sumFinalScores.wei / turnsDivisor),
    shu: Math.round(sumFinalScores.shu / turnsDivisor),
    wu: Math.round(sumFinalScores.wu / turnsDivisor),
  };

  const naturalWinRate = Math.round((naturalWins / turnsDivisor) * 1000) / 1000;

  const phaseWinRate: Partial<Record<MaterialPhase, Record<string, number>>> = {};
  for (const phase of ["leading", "even", "behind"] as MaterialPhase[]) {
    const phaseRecord: Record<string, number> = {};
    for (const label of slotLabels) {
      const gamesInPhase = phaseGames[phase][label] ?? 0;
      if (gamesInPhase > 0) {
        phaseRecord[label] = Math.round(((phaseWins[phase][label] ?? 0) / gamesInPhase) * 1000) / 1000;
      }
    }
    if (Object.keys(phaseRecord).length > 0) {
      phaseWinRate[phase] = phaseRecord;
    }
  }

  return {
    matchName,
    games,
    seed,
    maxPlies,
    generatedAt: new Date().toISOString(),
    slotLabels,
    winRate,
    avgTurns: Math.round(totalPlies / turnsDivisor),
    endReasonCounts,
    avgNodes,
    avgQuiescenceNodes,
    avgTtHits,
    avgTtStores,
    avgThinkMs,
    avgCaptureProfit,
    checkmateDefeats,
    timesChecked,
    comebackLosses,
    timeoutMoves,
    zeroSearchMoves,
    totalObviousBadMoves,
    obviousBadMovesByLabel,
    avgFinalScores,
    naturalWinRate,
    phaseWinRate: Object.keys(phaseWinRate).length > 0 ? phaseWinRate : undefined,
    gamesCompleted: gameRecords.length,
    gameRecords,
  };
}

function matchStateKey(state: GameState): string {
  const pieces = state.pieces
    .filter((piece) => piece.blocksMovement)
    .map((piece) => `${piece.id}:${piece.position}:${piece.controller}:${piece.defeated ? 1 : 0}`)
    .sort()
    .join("|");

  return `${state.currentKingdom}|${state.defeatedKingdoms.join(",")}|${pieces}`;
}

function matchOpeningSeeds(): Array<Array<{ pieceId: string; target: string }>> {
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

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed;

  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** 便捷：对比两个 profile（1 方 new vs 2 方 old，座位轮换） */
export function compareAiProfiles(
  matchName: string,
  challengerProfile: AiProfile,
  baselineProfile: AiProfile,
  options: AiMatchEvalOptions & {
    challengerLabel?: string;
    baselineLabel?: string;
    challengerMoveOptions?: Partial<AiMoveOptions>;
    baselineMoveOptions?: Partial<AiMoveOptions>;
  } = {},
): AiMatchEvalReport {
  const challenger: AiPlayerSlot = {
    label: options.challengerLabel ?? "challenger",
    profile: challengerProfile,
    moveOptions: options.challengerMoveOptions,
  };
  const baseline: AiPlayerSlot = {
    label: options.baselineLabel ?? "baseline",
    profile: baselineProfile,
    moveOptions: options.baselineMoveOptions,
  };

  return runAiMatchEval(
    createHeadToHeadMatchSetup(matchName, challenger, baseline, "wei"),
    { ...options, rotateKingdomSlots: options.rotateKingdomSlots ?? true },
  );
}

/** 在相同子力参数下对比两种 opponentModel（座位轮换） */
export function compareOpponentModels(
  matchName: string,
  modelChallenger: OpponentModel,
  modelBaseline: OpponentModel,
  options: AiMatchEvalOptions & {
    baseProfile?: AiProfile;
    challengerMoveOptions?: Partial<AiMoveOptions>;
    baselineMoveOptions?: Partial<AiMoveOptions>;
  } = {},
): AiMatchEvalReport {
  const base = options.baseProfile ?? defaultAiProfile;
  const challengerProfile = cloneAiProfile(base);
  const baselineProfile = cloneAiProfile(base);

  challengerProfile.opponentModel = modelChallenger;
  baselineProfile.opponentModel = modelBaseline;

  return compareAiProfiles(matchName, challengerProfile, baselineProfile, {
    ...options,
    challengerLabel: modelChallenger,
    baselineLabel: modelBaseline,
  });
}
