import type { Kingdom, PointId } from "../board";
import { kingdomOf, kingdomRows, parsePointId } from "../board";
import { capturedPieceAt, nextActiveKingdom, turnOrder, type GameState } from "../game-state";
import { getCheckedKingdoms, getLegalMoves, getPseudoLegalMoves } from "../moves";
import { aiStyleForKingdom, defaultAiProfile, type AiProfile, type AiStyleProfile } from "../ai-profile";
import { lookupOpeningBook } from "./opening-book";
import type { Piece } from "../pieces";

import {
  applySearchMove,
  makeSearchMove,
  unmakeSearchMove,
  type UndoInfo,
  isPointControlledByOpponent,
  isKingDefenseCapture,
  givesDirectCheck,
  attackersOf,
  isPieceHanging,
  staticExchangeScore,
  isProfitableCapture,
  addressesHangingPiece,
  generalFor,
  nearestOpponentGeneralDistance,
  isEndgameForcingAction,
  isInsideOwnPalace,
  pieceAttacksSquare,
} from "./tactical";

import {
  evaluateState,
  pieceValue,
  isNeutralBlocker,
  soldierAdvance,
  gamePhaseFor,
  isOpeningPhase,
  isOriginalBackRank,
  isOwnKingdomPoint,
  materialByController,
  developmentScore,
  repetitiveQuietMovePenalty,
  kingSafetyScore,
  strongestOpponent,
  tacticalStabilityScore,
} from "./evaluate";

export interface AiMove {
  pieceId: string;
  from: PointId;
  target: PointId;
}

export interface AiMoveOptions {
  random?: () => number;
  explorationRate?: number;
  explorationTop?: number;
  explorationSlack?: number;
  explorationTemperature?: number;
  openingSearchDepth?: number;
  openingRootBeam?: number;
  openingResponseBeam?: number;
  openingThirdPlayerBeam?: number;
  timeBudgetMs?: number;
  style?: AiStyleProfile;
  seed?: number;
  maxDepth?: number;
  skillProfile?: "fast" | "balanced" | "tactical";
  styleDiversitySeed?: number;
  debugStats?: SearchStats;
  maxQuiescenceDepth?: number;
}

export interface SearchStats {
  completedDepth: number;
  nodes: number;
  ttHits: number;
  cutoffs: number;
  timedOut: boolean;
  principalVariation: AiMove[];
  topCandidates: Array<{
    move: AiMove;
    score: number;
  }>;
  startTimeMs: number;
  endTimeMs: number;
  nodesPerSecond: number;
}

const minimumSearchBudgetMs = 12;
const defaultSearchBudgetMs = 1000;

const TT_MAX_SIZE = 500_000;
const persistentTT = new Map<string, TranspositionEntry>();

const EVAL_CACHE_MAX_SIZE = 100_000;
const evalCache = new Map<string, number>();

export function clearTranspositionTable(): void {
  persistentTT.clear();
  evalCache.clear();
}

interface SearchContext {
  deadline: number;
  timedOut: boolean;
  stats: SearchStats;
  tt: Map<string, TranspositionEntry>;
  killerMoves: Map<number, AiMove[]>;
  history: Map<string, number>;
  maxQuiescenceDepth: number;
  principalVariation: AiMove[];
}

interface TranspositionEntry {
  depth: number;
  score: number;
  flag: "exact" | "lower" | "upper";
  bestMove: AiMove | null;
}

export function createSearchStats(): SearchStats {
  return {
    completedDepth: 0,
    nodes: 0,
    ttHits: 0,
    cutoffs: 0,
    timedOut: false,
    principalVariation: [],
    topCandidates: [],
    startTimeMs: 0,
    endTimeMs: 0,
    nodesPerSecond: 0,
  };
}

export function chooseAiMove(
  state: GameState,
  kingdom: Kingdom,
  profile: AiProfile = defaultAiProfile,
  options: AiMoveOptions = {},
): AiMove | null {
  const moveOptions = options.random || options.seed === undefined ? options : { ...options, random: seededRandom(options.seed) };
  const style = options.style ?? aiStyleForKingdom(kingdom);
  const context = createSearchContext(moveOptions, state, kingdom, profile);
  context.stats.startTimeMs = performance.now();
  const phase = gamePhaseFor(state);
  const fastOpening =
    phase === "opening" &&
    moveOptions.timeBudgetMs === undefined &&
    moveOptions.openingSearchDepth === undefined &&
    (moveOptions.explorationRate ?? 0) <= 0 &&
    !state.checkedKingdoms.includes(kingdom);
  const lowBudget = phase === "opening" && (moveOptions.timeBudgetMs ?? Number.POSITIVE_INFINITY) <= 150 && !state.checkedKingdoms.includes(kingdom);
  const fastCandidates = fastOpening || lowBudget;
  const actions = fastCandidates ? getFastOpeningCandidateActions(state, kingdom, profile, style) : getCandidateActions(state, kingdom, profile, style, context);

  if (!actions.length) {
    return null;
  }

  // Try opening book lookup for early game (skip when exploring for diversity)
  if (phase === "opening" && (moveOptions.explorationRate ?? 0) <= 0 && state.moveHistory && state.moveHistory.length <= 9 && !state.checkedKingdoms.includes(kingdom)) {
    const bookMove = lookupOpeningBook(state.moveHistory, kingdom, moveOptions.random);

    if (bookMove) {
      const validMove = actions.find((action) => action.pieceId === bookMove.pieceId && action.target === bookMove.target);

      if (validMove) {
        return validMove;
      }
    }
  }

  const urgentKingDefense = actions.find((action) => isKingDefenseCapture(state, action, kingdom));

  if (urgentKingDefense) {
    return urgentKingDefense;
  }

  const generalCapture = actions.find((action) => {
    const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

    return capturedPiece?.type === "general" && !isNeutralBlocker(capturedPiece);
  });

  if (generalCapture) {
    return generalCapture;
  }

  const profitableCapture = actions
    .filter((action) => {
      return isProfitableCapture(state, action, kingdom, profile) && doesNotLeaveKingdomInCheck(state, action, kingdom);
    })
    .sort((left, right) => {
      return staticExchangeScore(state, right, kingdom, profile) - staticExchangeScore(state, left, kingdom, profile) || compareAction(left, right);
    })[0];

  if (profitableCapture && staticExchangeScore(state, profitableCapture, kingdom, profile) >= profile.pieceValues.soldier) {
    return profitableCapture;
  }

  const urgentHangingDefense = (moveOptions.explorationRate ?? 0) > 0 ? null : actions
    .filter((action) => {
      const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);

      return (
        Boolean(movingPiece && pieceValue(movingPiece, profile) >= profile.pieceValues.horse) &&
        addressesHangingPiece(state, action, kingdom, profile) &&
        doesNotLeaveKingdomInCheck(state, action, kingdom)
      );
    })
    .sort((left, right) => actionOrderingScore(state, right, kingdom, profile, style, context) - actionOrderingScore(state, left, kingdom, profile, style, context))[0];

  if (urgentHangingDefense) {
    return urgentHangingDefense;
  }

  const targetDepth = lowBudget ? Math.min(1, searchDepthForState(state, profile, moveOptions)) : searchDepthForState(state, profile, moveOptions);
  const rootLimit = rootBeamForState(state, profile, moveOptions, targetDepth);
  const rootActions = fastCandidates ? actions.slice(0, rootLimit) : rootActionWindow(state, actions, kingdom, profile, style, rootLimit);
  let bestAction = rootActions[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let scoredActions: Array<{ action: AiMove; score: number }> = [];
  let prevIterationScores: Array<{ action: AiMove; score: number }> = [];
  // Aspiration window: narrow search bounds around previous iteration's score
  const aspirationWindow = 200;
  let aspirationAlpha = Number.NEGATIVE_INFINITY;
  let aspirationBeta = Number.POSITIVE_INFINITY;

  for (let depth = 0; depth <= targetDepth; depth += 1) {
    if (!hasSearchTime(context) && scoredActions.length > 0) {
      break;
    }

    // Set aspiration window after first completed iteration
    if (depth > 1 && scoredActions.length > 0) {
      aspirationAlpha = bestScore - aspirationWindow;
      aspirationBeta = bestScore + aspirationWindow;
    }

    const searchProfile = searchProfileForState(state, profile, moveOptions, depth);
    const orderedRootActions = orderRootActions(state, rootActions, kingdom, searchProfile, style, context, context.principalVariation[0], prevIterationScores);
    let iterationScores: Array<{ action: AiMove; score: number }> = [];
    let iterationBestAction = bestAction;
    let iterationBestScore = Number.NEGATIVE_INFINITY;
    let windowFail = false;

    for (const action of orderedRootActions) {
      if (!hasSearchTime(context) && iterationScores.length > 0) {
        break;
      }

      const nextState = applySearchMove(state, action.pieceId, action.target);
      const rawScore = depth > 0
        ? evaluateAfterResponses(nextState, kingdom, depth, searchProfile, style, context)
        : evaluateState(nextState, kingdom, searchProfile, style) + forcingOpportunityScore(nextState, kingdom, searchProfile, style);
      const score =
        rawScore +
        cheapActionScore(state, action, kingdom, profile, style) * profile.scoring.rootActionWeight +
        styleRootPolicyScore(state, action, kingdom, profile, style, moveOptions);

      iterationScores.push({ action, score });

      if (score > iterationBestScore || (score === iterationBestScore && compareRootAction(action, iterationBestAction, style, moveOptions) < 0)) {
        iterationBestAction = action;
        iterationBestScore = score;
      }

      // Aspiration window check: if score falls outside window, widen and restart
      if (depth > 1 && iterationScores.length === orderedRootActions.length) {
        if (iterationBestScore <= aspirationAlpha || iterationBestScore >= aspirationBeta) {
          windowFail = true;
        }
      }
    }

    // Re-search with full window if aspiration failed
    if (windowFail && hasSearchTime(context)) {
      aspirationAlpha = Number.NEGATIVE_INFINITY;
      aspirationBeta = Number.POSITIVE_INFINITY;

      const retryScores: Array<{ action: AiMove; score: number }> = [];
      let retryBestAction = iterationBestAction;
      let retryBestScore = Number.NEGATIVE_INFINITY;

      for (const action of orderedRootActions) {
        if (!hasSearchTime(context) && retryScores.length > 0) {
          break;
        }

        const nextState = applySearchMove(state, action.pieceId, action.target);
        const score =
          (depth > 0
            ? evaluateAfterResponses(nextState, kingdom, depth, searchProfile, style, context)
            : evaluateState(nextState, kingdom, searchProfile, style) + forcingOpportunityScore(nextState, kingdom, searchProfile, style)) +
          cheapActionScore(state, action, kingdom, profile, style) * profile.scoring.rootActionWeight +
          styleRootPolicyScore(state, action, kingdom, profile, style, moveOptions);

        retryScores.push({ action, score });

        if (score > retryBestScore || (score === retryBestScore && compareRootAction(action, retryBestAction, style, moveOptions) < 0)) {
          retryBestAction = action;
          retryBestScore = score;
        }
      }

      if (retryScores.length > 0) {
        iterationScores = retryScores;
        iterationBestAction = retryBestAction;
        iterationBestScore = retryBestScore;
      }
    }

    if (iterationScores.length === orderedRootActions.length || !context.timedOut) {
      bestAction = iterationBestAction;
      bestScore = iterationBestScore;
      scoredActions = iterationScores.sort((left, right) => right.score - left.score || compareAction(left.action, right.action));
      prevIterationScores = scoredActions;
      context.stats.completedDepth = depth;
      context.principalVariation = [bestAction, ...principalVariationFor(applySearchMove(state, bestAction.pieceId, bestAction.target), kingdom, context)];
    }

    if (context.timedOut) {
      break;
    }
  }

  context.stats.timedOut = context.timedOut;
  context.stats.principalVariation = context.principalVariation;
  context.stats.topCandidates = scoredActions.slice(0, 5).map((item) => ({ move: item.action, score: Math.round(item.score) }));
  context.stats.endTimeMs = performance.now();
  const elapsedMs = context.stats.endTimeMs - context.stats.startTimeMs;
  context.stats.nodesPerSecond = elapsedMs > 0 ? Math.round(context.stats.nodes / (elapsedMs / 1000)) : 0;

  const exploratoryAction = pickExploratoryAction(scoredActions, bestScore, moveOptions);

  if (exploratoryAction) {
    return exploratoryAction;
  }

  return bestAction;
}

function searchDepthForState(state: GameState, profile: AiProfile, options: AiMoveOptions): number {
  const profileDepth = Math.min(profile.searchDepth, options.maxDepth ?? profile.searchDepth);
  const phase = gamePhaseFor(state);

  if (phase === "endgame") {
    return Math.min((options.maxDepth ?? profile.searchDepth) + 1, profileDepth + 1);
  }

  if (phase !== "opening") {
    return profileDepth;
  }

  return Math.max(0, Math.min(profileDepth, options.openingSearchDepth ?? 0));
}

function rootBeamForState(state: GameState, profile: AiProfile, options: AiMoveOptions, depth: number): number {
  const phase = gamePhaseFor(state);

  if (phase === "endgame") {
    return Math.min(getAllActions(state, state.currentKingdom).length || profile.rootBeam, profile.rootBeam + 6);
  }

  if (phase !== "opening" || depth <= 0) {
    return profile.rootBeam;
  }

  return Math.min(profile.rootBeam, options.openingRootBeam ?? 5 + Math.max(0, depth - 1) * 4);
}

function searchProfileForState(state: GameState, profile: AiProfile, options: AiMoveOptions, depth: number): AiProfile {
  const phase = gamePhaseFor(state);

  if (phase === "endgame") {
    return {
      ...profile,
      responseBeam: Math.min(profile.responseBeam + 1, profile.rootBeam),
      thirdPlayerBeam: Math.min(profile.thirdPlayerBeam + 1, profile.responseBeam),
      safetyScanLimit: Math.max(profile.safetyScanLimit, 24),
    };
  }

  if (phase !== "opening" || depth <= 0) {
    return profile;
  }

  return {
    ...profile,
    responseBeam: Math.min(profile.responseBeam, options.openingResponseBeam ?? Math.max(2, Math.min(4, depth + 1))),
    thirdPlayerBeam: Math.min(profile.thirdPlayerBeam, options.openingThirdPlayerBeam ?? Math.max(1, Math.min(3, depth))),
  };
}

function extractThreatActions(
  state: GameState,
  currentKingdom: Kingdom,
  aiKingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
): AiMove[] {
  // Find moves by currentKingdom that directly threaten the AI
  const aiGeneral = generalFor(state, aiKingdom);
  if (!aiGeneral) return [];

  const threats: AiMove[] = [];
  const allMoves = getAllActions(state, currentKingdom);

  for (const action of allMoves) {
    const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);
    const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);

    if (!movingPiece) continue;

    // Threat 1: Direct check on AI general
    if (givesDirectCheck(state, action, currentKingdom)) {
      const nextState = applySearchMove(state, action.pieceId, action.target);
      if (nextState.checkedKingdoms.includes(aiKingdom)) {
        threats.push(action);
        continue;
      }
    }

    // Threat 2: Capturing AI high-value pieces (chariot, horse, cannon)
    if (capturedPiece && !isNeutralBlocker(capturedPiece) && capturedPiece.controller === aiKingdom) {
      const capturedValue = pieceValue(capturedPiece, profile);
      if (capturedValue >= profile.pieceValues.horse) {
        threats.push(action);
        continue;
      }
    }

    // Threat 3: Moving a piece to attack AI general position
    if (pieceAttacksSquare(state, movingPiece, aiGeneral.position)) {
      threats.push(action);
    }
  }

  return threats.slice(0, 5);
}

function pickExploratoryAction(
  scoredActions: Array<{ action: AiMove; score: number }>,
  bestScore: number,
  options: AiMoveOptions,
): AiMove | null {
  if (!options.random || (options.explorationRate ?? 0) <= 0 || options.random() >= (options.explorationRate ?? 0)) {
    return null;
  }

  const random = options.random;
  const slack = options.explorationSlack ?? Math.max(420, Math.abs(bestScore) * 0.06);
  const topCount = Math.max(1, options.explorationTop ?? 3);
  const candidates = scoredActions
    .filter((item) => item.score >= bestScore - slack)
    .sort((left, right) => right.score - left.score || compareAction(left.action, right.action))
    .slice(0, topCount);

  if (candidates.length <= 1) {
    return null;
  }

  const temperature = Math.max(1, options.explorationTemperature ?? 480);
  const weights = candidates.map((item) => Math.exp((item.score - bestScore) / temperature));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * totalWeight;

  for (let index = 0; index < candidates.length; index += 1) {
    roll -= weights[index];

    if (roll <= 0) {
      return candidates[index].action;
    }
  }

  return candidates[candidates.length - 1].action;
}

export function getAiActions(state: GameState, kingdom: Kingdom, profile: AiProfile = defaultAiProfile): AiMove[] {
  return getCandidateActions(state, kingdom, profile, aiStyleForKingdom(kingdom));
}

function search(
  state: GameState,
  aiKingdom: Kingdom,
  depth: number,
  alpha: number,
  beta: number,
  profile: AiProfile,
  aiStyle: AiStyleProfile,
  context: SearchContext,
): number {
  context.stats.nodes += 1;

  if (!hasSearchTime(context)) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  if (state.winner) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  if (depth === 0) {
    const evalKey = `e|${aiKingdom}|${searchStateKey(state)}`;
    const cached = evalCache.get(evalKey);
    if (cached !== undefined) {
      context.stats.ttHits += 1;
      return cached;
    }

    const score =
      quiescenceSearch(state, aiKingdom, profile, aiStyle, context, 0) +
      tacticalStabilityScore(state, aiKingdom, profile, aiStyle) +
      forcingOpportunityScore(state, aiKingdom, profile, aiStyle);

    if (evalCache.size < EVAL_CACHE_MAX_SIZE) {
      evalCache.set(evalKey, score);
    } else {
      // Evict ~20% of entries when full
      let count = 0;
      for (const key of evalCache.keys()) {
        evalCache.delete(key);
        count++;
        if (count >= EVAL_CACHE_MAX_SIZE * 0.2) break;
      }
      evalCache.set(evalKey, score);
    }

    return score;
  }

  // Null move pruning adapted for 3-player chess
  // Conditions: it's our turn, not in check, enough depth, enough material to sacrifice
  if (state.currentKingdom === aiKingdom && !state.checkedKingdoms.includes(aiKingdom) && depth >= 3 && hasEnoughMaterialForNullMove(state, aiKingdom, profile)) {
    const nullState = skipTurn(state);

    if (nullState) {
      // Use reduced depth R=2 (not R=3, since skipping in 3-player is riskier)
      const nullScore = search(nullState, aiKingdom, depth - 2, beta, beta + 1, profile, aiStyle, context);

      if (nullScore >= beta && hasSearchTime(context)) {
        // Verification: do a shallow search to confirm the position is really good
        const verifyScore = search(
          state,
          aiKingdom,
          1,
          beta - 1,
          beta,
          profile,
          aiStyle,
          context,
        );

        if (verifyScore >= beta) {
          return nullScore;
        }
      }
    }
  }

  const originalAlpha = alpha;
  const originalBeta = beta;
  const ttKey = `${aiKingdom}|${searchStateKey(state)}`;
  const ttEntry = context.tt.get(ttKey);

  if (ttEntry && ttEntry.depth >= depth) {
    context.stats.ttHits += 1;

    if (ttEntry.flag === "exact") {
      return ttEntry.score;
    }

    if (ttEntry.flag === "lower") {
      alpha = Math.max(alpha, ttEntry.score);
    } else {
      beta = Math.min(beta, ttEntry.score);
    }

    if (alpha >= beta) {
      return ttEntry.score;
    }
  }

  // Internal Iterative Deepening: if no TT bestMove, do a shallow search to get move ordering info
  if ((!ttEntry || !ttEntry.bestMove) && depth >= 4 && hasSearchTime(context)) {
    search(state, aiKingdom, depth - 2, alpha, beta, profile, aiStyle, context);
  }

  const currentKingdom = state.currentKingdom;
  const currentStyle = currentKingdom === aiKingdom ? aiStyle : aiStyleForKingdom(currentKingdom);
  const isTactical = state.checkedKingdoms.length > 0;
  const baseBeam = currentKingdom === aiKingdom ? profile.responseBeam : profile.thirdPlayerBeam;
  // Reduce beam when running low on time
  const timePressure = context.deadline !== Number.POSITIVE_INFINITY ? (context.deadline - performance.now()) / (context.deadline - (context.deadline - 200)) : 1;
  const pressureMultiplier = timePressure < 0.3 ? 0.5 : timePressure < 0.6 ? 0.75 : 1;
  const beamLimit = Math.max(2, Math.floor((isTactical ? Math.min(baseBeam + 4, baseBeam * 2) : baseBeam) * pressureMultiplier));
  let actions = orderActions(state, getCandidateActions(state, currentKingdom, profile, currentStyle, context), currentKingdom, profile, currentStyle, context, depth, ttEntry?.bestMove).slice(
    0,
    beamLimit,
  );

  if (!actions.length) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  if (currentKingdom === aiKingdom) {
    let value = Number.NEGATIVE_INFINITY;
    let bestMove: AiMove | null = null;
    let cutCount = 0;
    const inCheck = state.checkedKingdoms.includes(aiKingdom);
    // Static eval for futility pruning
    const staticEval = evaluateState(state, aiKingdom, profile, aiStyle);
    const futilityMargin = [0, 400, 900][Math.min(2, depth)] ?? 900;

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);
      const givesCheck = givesDirectCheck(state, action, aiKingdom);
      const isCapture = Boolean(capturedPiece && !isNeutralBlocker(capturedPiece));
      const isQuiet = !isCapture && !givesCheck && !inCheck;
      const isGeneralCapture = capturedPiece?.type === "general";

      // Futility pruning: skip quiet moves that can't possibly raise alpha
      if (isQuiet && index > 0 && depth <= 2 && value > Number.NEGATIVE_INFINITY && staticEval + futilityMargin <= alpha) {
        continue;
      }

      const isReduced = index >= 3 && depth >= 3 && !inCheck && !givesCheck && !isCapture;
      let score: number;

      // Use make/unmake for non-general captures (fast path), fallback for general captures
      const useMakeUnmake = !isGeneralCapture;
      let undo: UndoInfo | null = null;

      if (useMakeUnmake) {
        undo = makeSearchMove(state, action.pieceId, action.target);
      }

      const searchState = useMakeUnmake ? state : applySearchMove(state, action.pieceId, action.target);

      if (index === 0) {
        // PVS: first move gets full window search
        score = search(searchState, aiKingdom, depth - 1, alpha, beta, profile, aiStyle, context);
      } else {
        // LMR: reduce depth for late quiet moves
        const reducedDepth = isReduced ? Math.max(1, depth - 2) : depth - 1;

        // PVS: zero-window search
        score = search(searchState, aiKingdom, reducedDepth, alpha, alpha + 1, profile, aiStyle, context);

        // Re-search with full depth and full window if reduced search beats alpha
        if (isReduced && score > alpha && hasSearchTime(context)) {
          score = search(searchState, aiKingdom, depth - 1, alpha, alpha + 1, profile, aiStyle, context);
        }

        // Re-search with full window if zero-window fails
        if (score > alpha && score < beta && hasSearchTime(context)) {
          score = search(searchState, aiKingdom, depth - 1, alpha, beta, profile, aiStyle, context);
        }
      }

      if (useMakeUnmake && undo) {
        unmakeSearchMove(state, undo);
      }

      if (score > value) {
        value = score;
        bestMove = action;
      }

      alpha = Math.max(alpha, value);

      if (beta <= alpha) {
        recordCutoff(context, depth, action);
        cutCount++;
        // Multi-Cut: if multiple moves cause cutoff, high confidence this is a cut-node
        if (cutCount >= 3 && depth >= 2 && depth <= 4 && !inCheck) {
          storeTransposition(context, ttKey, depth, value, originalAlpha, originalBeta, bestMove);
          return value;
        }
        break;
      }
    }

    storeTransposition(context, ttKey, depth, value, originalAlpha, originalBeta, bestMove);
    return value;
  }

  let bestActorScore = Number.NEGATIVE_INFINITY;
  let selectedAiScore = Number.POSITIVE_INFINITY;
  let bestMove: AiMove | null = null;

  // Threat Space Search: when opponent has threatening moves against AI,
  // ensure they are searched first (even if not in the beam)
  if (depth >= 2 && currentKingdom !== aiKingdom) {
    const threatActions = extractThreatActions(state, currentKingdom, aiKingdom, profile, currentStyle);
    const actionKeys = new Set(actions.map(actionKey));
    const newThreats = threatActions.filter((action) => !actionKeys.has(actionKey(action)));

    if (newThreats.length > 0) {
      // Prepend threat actions so they get searched before the regular beam
      actions = uniqueActions([...newThreats, ...actions]).slice(0, beamLimit + newThreats.length);
    }
  }

  for (const action of actions) {
    const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);
    const isGeneralCapture = capturedPiece?.type === "general";
    const useMakeUnmake = !isGeneralCapture;
    let undo: UndoInfo | null = null;

    if (useMakeUnmake) {
      undo = makeSearchMove(state, action.pieceId, action.target);
    }

    const searchState = useMakeUnmake ? state : applySearchMove(state, action.pieceId, action.target);

    const actorScore = search(
      searchState,
      currentKingdom,
      depth - 1,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      profile,
      currentStyle,
      context,
    );
    const aiScore = search(searchState, aiKingdom, depth - 1, alpha, beta, profile, aiStyle, context);
    const pressureBonus = coalitionPressureScore(searchState, currentKingdom, aiKingdom, profile, currentStyle);

    if (useMakeUnmake && undo) {
      unmakeSearchMove(state, undo);
    }

    const actorDecisionScore = actorScore + pressureBonus;

    if (
      actorDecisionScore > bestActorScore ||
      (actorDecisionScore === bestActorScore && aiScore < selectedAiScore) ||
      (actorDecisionScore === bestActorScore && aiScore === selectedAiScore && compareAction(action, actions[0]) < 0)
    ) {
      bestActorScore = actorDecisionScore;
      selectedAiScore = aiScore;
      bestMove = action;
    }

    beta = Math.min(beta, selectedAiScore);

    if (beta <= alpha) {
      recordCutoff(context, depth, action);
      break;
    }
  }

  storeTransposition(context, ttKey, depth, selectedAiScore, originalAlpha, originalBeta, bestMove);
  return selectedAiScore;
}

function getCandidateActions(
  state: GameState,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
  context?: SearchContext,
): AiMove[] {
  const deepMode = context !== undefined;
  const actions = getAllActions(state, kingdom).sort((left, right) => {
    const scoreDiff = cheapActionScore(state, right, kingdom, profile, style, deepMode) - cheapActionScore(state, left, kingdom, profile, style, deepMode);

    return scoreDiff || compareAction(left, right);
  });
  const inCheck = state.checkedKingdoms.includes(kingdom);
  const phase = gamePhaseFor(state);
  const highPriorityActions = actions.filter((action) => {
    const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

    return (
      (capturedPiece && !isNeutralBlocker(capturedPiece)) ||
      isKingDefenseCapture(state, action, kingdom) ||
      givesDirectCheck(state, action, kingdom) ||
      addressesHangingPiece(state, action, kingdom, profile) ||
      (phase === "endgame" && isEndgameForcingAction(state, action, kingdom, profile))
    );
  });
  const scanLimit = phase === "endgame" ? Math.max(profile.safetyScanLimit, 28) : profile.safetyScanLimit;
  const scanActions = inCheck ? actions : uniqueActions([...highPriorityActions, ...actions.slice(0, scanLimit)]);
  const safeActions = scanActions.filter((action) => doesNotLeaveKingdomInCheck(state, action, kingdom));
  const candidates = safeActions.length ? safeActions : scanActions;

  return orderActions(state, candidates, kingdom, profile, style, context, 0);
}

function getAllActions(state: GameState, kingdom: Kingdom): AiMove[] {
  return state.pieces
    .filter((piece) => piece.controller === kingdom && piece.blocksMovement)
    .flatMap((piece) => {
      return getLegalMoves(state, piece).map((target) => ({
        pieceId: piece.id,
        from: piece.position,
        target,
      }));
    });
}

function getFastOpeningCandidateActions(state: GameState, kingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): AiMove[] {
  return getAllActions(state, kingdom)
    .filter((action) => {
      const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

      return Boolean(capturedPiece) || !wouldMoveGeneralQuietly(state, action);
    })
    .sort((left, right) => {
      return fastOpeningActionScore(state, right, kingdom, profile, style) - fastOpeningActionScore(state, left, kingdom, profile, style) || compareAction(left, right);
    });
}

function fastOpeningActionScore(
  state: GameState,
  action: AiMove,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

  if (!movingPiece) {
    return 0;
  }

  let score = style.preferredPieces[movingPiece.type] ?? 0;

  if (capturedPiece && !isNeutralBlocker(capturedPiece)) {
    score += pieceValue(capturedPiece, profile) * 4 - pieceValue(movingPiece, profile);
    score += capturedPiece.type === "general" ? profile.scoring.generalCaptureBonus : 0;
  }

  score += developmentScore(state, action, movingPiece, profile) * style.developmentMultiplier;
  score += movingPiece.type === "soldier" ? soldierAdvance({ ...movingPiece, position: action.target }) * profile.scoring.soldierAdvanceAction : 0;
  score += targetPressureScore(state, action.target, kingdom, profile, style);

  return score;
}

function wouldMoveGeneralQuietly(state: GameState, action: AiMove): boolean {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);

  return movingPiece?.type === "general" && !capturedPieceAt(state, action.pieceId, action.target);
}

function rootActionWindow(
  state: GameState,
  actions: AiMove[],
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
  limit: number,
): AiMove[] {
  const forced = actions.filter((action) => {
    return (
      isProfitableCapture(state, action, kingdom, profile) ||
      addressesHangingPiece(state, action, kingdom, profile) ||
      (gamePhaseFor(state) === "endgame" && isEndgameForcingAction(state, action, kingdom, profile))
    );
  });

  return uniqueActions([...forced, ...actions]).slice(0, Math.max(limit, Math.min(actions.length, forced.length + 4))).sort((left, right) => {
    return actionOrderingScore(state, right, kingdom, profile, style) - actionOrderingScore(state, left, kingdom, profile, style) || compareAction(left, right);
  });
}

function orderActions(
  state: GameState,
  actions: AiMove[],
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
  context: SearchContext | undefined,
  ply: number,
  preferredMove?: AiMove | null,
): AiMove[] {
  const killers = context?.killerMoves.get(ply) ?? [];

  return [...actions].sort((left, right) => {
    const scoreDiff =
      actionOrderingScore(state, right, kingdom, profile, style, context, ply, preferredMove, killers) -
      actionOrderingScore(state, left, kingdom, profile, style, context, ply, preferredMove, killers);

    return scoreDiff || compareAction(left, right);
  });
}

function orderRootActions(
  state: GameState,
  actions: AiMove[],
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
  context: SearchContext,
  preferredMove: AiMove | null | undefined,
  prevScores: Array<{ action: AiMove; score: number }>,
): AiMove[] {
  const prevScoreMap = new Map<string, number>();

  for (const item of prevScores) {
    prevScoreMap.set(actionKey(item.action), item.score);
  }

  const killers = context.killerMoves.get(0) ?? [];

  return [...actions].sort((left, right) => {
    const leftPrev = prevScoreMap.get(actionKey(left)) ?? Number.NEGATIVE_INFINITY;
    const rightPrev = prevScoreMap.get(actionKey(right)) ?? Number.NEGATIVE_INFINITY;
    const prevDiff = rightPrev - leftPrev;

    if (Math.abs(prevDiff) > 200) {
      return prevDiff > 0 ? -1 : 1;
    }

    const scoreDiff =
      actionOrderingScore(state, right, kingdom, profile, style, context, 0, preferredMove, killers) -
      actionOrderingScore(state, left, kingdom, profile, style, context, 0, preferredMove, killers);

    return scoreDiff || compareAction(left, right);
  });
}

function actionOrderingScore(
  state: GameState,
  action: AiMove,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
  context?: SearchContext,
  ply = 0,
  preferredMove?: AiMove | null,
  killers: AiMove[] = [],
): number {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);
  const deepMode = (context !== undefined && ply > 0);
  let score = cheapActionScore(state, action, kingdom, profile, style, deepMode);

  if (!movingPiece) {
    return score;
  }

  if (preferredMove && sameMove(action, preferredMove)) {
    score += 1_000_000;
  }

  if (killers.some((move) => sameMove(move, action))) {
    score += 36_000;
  }

  score += context?.history.get(actionKey(action)) ?? 0;

  if (capturedPiece && !isNeutralBlocker(capturedPiece)) {
    // MVV-LVA: prioritize capturing high-value pieces with low-value attackers
    score += pieceValue(capturedPiece, profile) * 11 - pieceValue(movingPiece, profile) * 2;
    score += staticExchangeScore(state, action, kingdom, profile) * 4;
    score += mvvLvaBonus(capturedPiece, movingPiece, profile);
  }

  if (state.checkedKingdoms.includes(kingdom)) {
    score += doesNotLeaveKingdomInCheck(state, action, kingdom) ? 45_000 : -90_000;
  }

  if (givesDirectCheck(state, action, kingdom)) {
    score += 18_000;
  }

  if (addressesHangingPiece(state, action, kingdom, profile)) {
    score += 14_000 + Math.max(0, threatenedPieceReliefScore(state, action, movingPiece, capturedPiece, kingdom, profile, style));
  }

  if (gamePhaseFor(state) === "endgame") {
    score += endgameActionScore(state, action, kingdom, profile, style);
  }

  score += Math.max(0, 16 - ply) * 5;

  return score;
}

function doesNotLeaveKingdomInCheck(state: GameState, action: AiMove, kingdom: Kingdom): boolean {
  const nextState = applySearchMove(state, action.pieceId, action.target);

  return !getCheckedKingdoms(nextState).includes(kingdom);
}

function cheapActionScore(state: GameState, action: AiMove, kingdom: Kingdom, profile: AiProfile, style: AiStyleProfile, deepMode = false): number {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);
  let score = 0;

  if (!movingPiece) {
    return score;
  }

  if (capturedPiece) {
    if (isNeutralBlocker(capturedPiece)) {
      score -= neutralBlockerCapturePenalty(movingPiece, profile);
      score += targetPressureScore(state, action.target, kingdom, profile, style);
      return score;
    }

    const capturedValue = pieceValue(capturedPiece, profile);

    if (movingPiece.type === "general") {
      score += kingDefenseCaptureScore(state, action, movingPiece, capturedPiece, kingdom, profile);
    } else {
      const movingValue = pieceValue(movingPiece, profile);

      score +=
        capturedValue * profile.scoring.capturedValueMultiplier * style.attackMultiplier +
        (capturedValue - movingValue) * profile.scoring.tradeDeltaMultiplier;
    }

    if (capturedPiece.type === "general") {
      score += profile.scoring.generalCaptureBonus;
    }

    const see = staticExchangeScore(state, action, kingdom, profile);

    score += Math.max(-pieceValue(movingPiece, profile), see) * 1.8;
    if (!deepMode) {
      score -= exchangeRiskPenalty(state, action, movingPiece, capturedPiece, kingdom, profile, style);
    }
    score -= openingRaidPenalty(state, action, movingPiece, capturedPiece, profile);
  }

  if (movingPiece.type === "general" && !capturedPiece) {
    score -= profile.scoring.generalQuietMovePenalty;
  }

  if (movingPiece.type === "soldier") {
    score += soldierAdvance({ ...movingPiece, position: action.target }) * profile.scoring.soldierAdvanceAction;
  }

  if (movingPiece.type === "horse" || movingPiece.type === "chariot" || movingPiece.type === "cannon") {
    score += profile.scoring.activePieceAction * style.mobilityMultiplier;

    if (kingdomOf(action.target) !== movingPiece.kingdom) {
      score += profile.pieceValues.soldier * 0.6 * style.attackMultiplier;
    }
  }

  score += developmentScore(state, action, movingPiece, profile) * style.developmentMultiplier;
  score += targetPressureScore(state, action.target, kingdom, profile, style);

  // Skip expensive state simulations in deep search ordering
  if (!deepMode) {
    score += tacticalActionScore(state, action, movingPiece, capturedPiece, kingdom, profile, style);
    score += threatenedPieceReliefScore(state, action, movingPiece, capturedPiece, kingdom, profile, style);
    score -= quietExposurePenalty(state, action, movingPiece, capturedPiece, kingdom, profile, style);
  }

  score += style.preferredPieces[movingPiece.type] ?? 0;
  score -= repetitiveQuietMovePenalty(state, action, movingPiece, capturedPiece);

  return score;
}

function evaluateAfterResponses(
  state: GameState,
  aiKingdom: Kingdom,
  depth: number,
  profile: AiProfile,
  aiStyle: AiStyleProfile,
  context: SearchContext,
): number {
  if (state.winner || depth <= 0 || state.currentKingdom === aiKingdom) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  let bestActorScore = Number.NEGATIVE_INFINITY;
  let selectedAiScore = Number.POSITIVE_INFINITY;
  const actorStyle = aiStyleForKingdom(state.currentKingdom);
  const responseActions = getCandidateActions(state, state.currentKingdom, profile, actorStyle).slice(0, profile.responseBeam);

  if (!responseActions.length) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  for (const response of responseActions) {
    if (!hasSearchTime(context)) {
      break;
    }

    const responseState = applySearchMove(state, response.pieceId, response.target);

    const aiScore =
      responseState.currentKingdom !== aiKingdom && !responseState.winner
        ? evaluateThirdPlayerResponse(responseState, aiKingdom, depth - 1, profile, aiStyle, context)
        : search(responseState, aiKingdom, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, profile, aiStyle, context);
    const actorScore =
      evaluateState(responseState, state.currentKingdom, profile, actorStyle) +
      tacticalStabilityScore(responseState, state.currentKingdom, profile, actorStyle) +
      coalitionPressureScore(responseState, state.currentKingdom, aiKingdom, profile, actorStyle);

    if (actorScore > bestActorScore || (actorScore === bestActorScore && aiScore < selectedAiScore)) {
      bestActorScore = actorScore;
      selectedAiScore = aiScore;
    }
  }

  return selectedAiScore;
}

function evaluateThirdPlayerResponse(
  state: GameState,
  aiKingdom: Kingdom,
  depth: number,
  profile: AiProfile,
  aiStyle: AiStyleProfile,
  context: SearchContext,
): number {
  const actorStyle = aiStyleForKingdom(state.currentKingdom);
  const actions = getCandidateActions(state, state.currentKingdom, profile, actorStyle).slice(0, profile.thirdPlayerBeam);

  if (!actions.length) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  let bestActorScore = Number.NEGATIVE_INFINITY;
  let selectedAiScore = Number.POSITIVE_INFINITY;

  for (const action of actions) {
    if (!hasSearchTime(context)) {
      break;
    }

    const nextState = applySearchMove(state, action.pieceId, action.target);

    const actorScore =
      evaluateState(nextState, state.currentKingdom, profile, actorStyle) +
      tacticalStabilityScore(nextState, state.currentKingdom, profile, actorStyle) +
      coalitionPressureScore(nextState, state.currentKingdom, aiKingdom, profile, actorStyle);
    const aiScore = search(
      nextState,
      aiKingdom,
      Math.max(0, depth - 1),
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      profile,
      aiStyle,
      context,
    );

    if (actorScore > bestActorScore || (actorScore === bestActorScore && aiScore < selectedAiScore)) {
      bestActorScore = actorScore;
      selectedAiScore = aiScore;
    }
  }

  return selectedAiScore;
}

function quiescenceSearch(
  state: GameState,
  aiKingdom: Kingdom,
  profile: AiProfile,
  aiStyle: AiStyleProfile,
  context: SearchContext,
  qDepth: number,
): number {
  context.stats.nodes += 1;

  const standPat =
    evaluateState(state, aiKingdom, profile, aiStyle) +
    tacticalStabilityScore(state, aiKingdom, profile, aiStyle) +
    forcingOpportunityScore(state, aiKingdom, profile, aiStyle);

  const currentKingdom = state.currentKingdom;

  // Check extension: extend quiescence when in check to find escape routes
  const inCheck = state.checkedKingdoms.includes(currentKingdom);
  const effectiveMaxDepth = inCheck ? context.maxQuiescenceDepth + 2 : context.maxQuiescenceDepth;

  if (!hasSearchTime(context) || state.winner || qDepth >= effectiveMaxDepth) {
    return standPat;
  }

  const currentStyle = currentKingdom === aiKingdom ? aiStyle : aiStyleForKingdom(currentKingdom);
  const phase = gamePhaseFor(state);
  // Reduce branching at deeper quiescence levels
  const qBeamLimit = qDepth >= 2
    ? (currentKingdom === aiKingdom ? 4 : 3)
    : phase === "endgame"
      ? (currentKingdom === aiKingdom ? 10 : 6)
      : currentKingdom === aiKingdom ? 8 : 5;
  const tacticalActions = getCandidateActions(state, currentKingdom, profile, currentStyle, context)
    .filter((action) => {
      const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

      return (
        Boolean(capturedPiece && !isNeutralBlocker(capturedPiece)) ||
        givesDirectCheck(state, action, currentKingdom) ||
        state.checkedKingdoms.includes(currentKingdom) ||
        addressesHangingPiece(state, action, currentKingdom, profile)
      );
    })
    .slice(0, qBeamLimit);

  if (!tacticalActions.length) {
    return standPat;
  }

  if (currentKingdom === aiKingdom) {
    let best = standPat;

    for (const action of tacticalActions) {
      const searchState = applySearchMove(state, action.pieceId, action.target);

      const score = quiescenceSearch(searchState, aiKingdom, profile, aiStyle, context, qDepth + 1);

      best = Math.max(best, score);

      // Prune: if we've already found a great move, no need to continue
      if (best > standPat + 2000) {
        break;
      }
    }

    return best;
  }

  let bestActorScore = Number.NEGATIVE_INFINITY;
  let selectedAiScore = standPat;

  for (const action of tacticalActions) {
    const nextState = applySearchMove(state, action.pieceId, action.target);

    const actorScore =
      evaluateState(nextState, currentKingdom, profile, currentStyle) +
      tacticalStabilityScore(nextState, currentKingdom, profile, currentStyle) +
      coalitionPressureScore(nextState, currentKingdom, aiKingdom, profile, currentStyle);
    const aiScore = quiescenceSearch(nextState, aiKingdom, profile, aiStyle, context, qDepth + 1);

    if (actorScore > bestActorScore || (actorScore === bestActorScore && aiScore < selectedAiScore)) {
      bestActorScore = actorScore;
      selectedAiScore = aiScore;
    }
  }

  return selectedAiScore;
}

export function evaluateAiState(
  state: GameState,
  aiKingdom: Kingdom,
  profile: AiProfile = defaultAiProfile,
  style: AiStyleProfile = aiStyleForKingdom(aiKingdom),
): number {
  return evaluateState(state, aiKingdom, profile, style);
}

function exchangeRiskPenalty(
  state: GameState,
  action: AiMove,
  movingPiece: Piece,
  capturedPiece: Piece,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  if (movingPiece.type === "general" || capturedPiece.type === "general") {
    return 0;
  }

  const movingValue = pieceValue(movingPiece, profile);
  const capturedValue = pieceValue(capturedPiece, profile);
  const nextState = applySearchMove(state, action.pieceId, action.target);
  const exposed = isPointControlledByOpponent(nextState, action.target, kingdom);

  if (!exposed) {
    return 0;
  }

  const equalOrBadTrade = capturedValue <= movingValue + 60;
  const risk = equalOrBadTrade
    ? movingValue * profile.scoring.badTradeMultiplier
    : movingValue * profile.scoring.exposedTradeMultiplier;

  return risk / style.riskTolerance;
}

function kingDefenseCaptureScore(
  state: GameState,
  action: AiMove,
  movingPiece: Piece,
  capturedPiece: Piece,
  kingdom: Kingdom,
  profile: AiProfile,
): number {
  let score = pieceValue(capturedPiece, profile) * 6;

  if (isInsideOwnPalace(kingdom, action.target)) {
    score += profile.scoring.kingDefensePalaceCapture;
  }

  if (pieceAttacksSquare(state, capturedPiece, movingPiece.position)) {
    score += profile.scoring.kingDefenseAttackerCapture;
  }

  if (capturedPiece.type === "cannon" || capturedPiece.type === "chariot" || capturedPiece.type === "horse") {
    score += profile.scoring.kingDefensePowerPieceCapture;
  }

  return score;
}

function openingRaidPenalty(
  state: GameState,
  action: AiMove,
  movingPiece: Piece,
  capturedPiece: Piece,
  profile: AiProfile,
): number {
  if (!isOpeningPhase(state) || capturedPiece.type === "general") {
    return 0;
  }

  const capturedValue = pieceValue(capturedPiece, profile);
  const movingValue = pieceValue(movingPiece, profile);
  const leavesOwnRegion = !isOwnKingdomPoint(movingPiece.kingdom, action.target);

  if (!leavesOwnRegion || capturedValue > movingValue + 180) {
    return 0;
  }

  if (movingPiece.type === "cannon" || movingPiece.type === "horse" || movingPiece.type === "chariot") {
    return profile.scoring.openingRaidPenalty;
  }

  return 0;
}

function computeAdaptiveBudget(baseBudget: number, state: GameState, kingdom: Kingdom, profile: AiProfile): number {
  const phase = gamePhaseFor(state);
  const inCheck = state.checkedKingdoms.includes(kingdom);
  let multiplier = 1;

  // Critical positions get more time
  if (inCheck) {
    multiplier *= 1.5;
  }

  // More active pieces = more complex position = more time needed
  const activePieces = state.pieces.filter(
    (piece) => piece.controller === kingdom && piece.blocksMovement && !isNeutralBlocker(piece),
  );
  const majorPieces = activePieces.filter(
    (piece) => piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse",
  );
  if (majorPieces.length >= 4) {
    multiplier *= 1.2;
  }

  // Multiple checked kingdoms = complex tactical situation
  if (state.checkedKingdoms.length >= 2) {
    multiplier *= 1.3;
  }

  // Endgame with few pieces: less time needed (simpler positions)
  if (phase === "endgame" && activePieces.length <= 4) {
    multiplier *= 0.6;
  }

  return Math.round(baseBudget * multiplier);
}

function createSearchContext(options: AiMoveOptions, state?: GameState, kingdom?: Kingdom, profile?: AiProfile): SearchContext {
  const rawBudget = options.timeBudgetMs ?? ((options.explorationRate ?? 0) > 0 ? 1_000 : defaultSearchBudgetMs);
  const budget = state && kingdom && profile ? computeAdaptiveBudget(rawBudget, state, kingdom, profile) : rawBudget;
  const stats = options.debugStats ?? createSearchStats();

  stats.completedDepth = 0;
  stats.nodes = 0;
  stats.ttHits = 0;
  stats.cutoffs = 0;
  stats.timedOut = false;
  stats.principalVariation = [];
  stats.topCandidates = [];
  stats.startTimeMs = 0;
  stats.endTimeMs = 0;
  stats.nodesPerSecond = 0;

  // Age out shallow entries and cap TT size before starting a new search
  if (persistentTT.size > TT_MAX_SIZE * 0.8) {
    for (const [key, entry] of persistentTT) {
      if (entry.depth <= 1) {
        persistentTT.delete(key);
      }

      if (persistentTT.size <= TT_MAX_SIZE * 0.6) {
        break;
      }
    }
  }

  return {
    deadline: Number.isFinite(budget) ? performance.now() + Math.max(minimumSearchBudgetMs, budget) : Number.POSITIVE_INFINITY,
    timedOut: false,
    stats,
    tt: persistentTT,
    killerMoves: new Map(),
    history: new Map(),
    maxQuiescenceDepth: options.maxQuiescenceDepth ?? (options.skillProfile === "fast" ? 2 : options.skillProfile === "tactical" ? 5 : 4),
    principalVariation: [],
  };
}

function hasSearchTime(context: SearchContext): boolean {
  if (context.timedOut) {
    return false;
  }

  if (performance.now() <= context.deadline) {
    return true;
  }

  context.timedOut = true;
  return false;
}

function recordCutoff(context: SearchContext, ply: number, action: AiMove): void {
  context.stats.cutoffs += 1;
  const killers = context.killerMoves.get(ply) ?? [];

  context.killerMoves.set(ply, uniqueActions([action, ...killers]).slice(0, 2));
  context.history.set(actionKey(action), (context.history.get(actionKey(action)) ?? 0) + Math.max(1, ply * ply));
}

function storeTransposition(
  context: SearchContext,
  key: string,
  depth: number,
  score: number,
  alpha: number,
  beta: number,
  bestMove: AiMove | null,
): void {
  const flag = score <= alpha ? "upper" : score >= beta ? "lower" : "exact";
  const existing = context.tt.get(key);

  // Replace only if deeper or same depth with more precise flag
  if (existing && existing.depth > depth) {
    return;
  }

  context.tt.set(key, { depth, score, flag, bestMove });

  // Evict oldest shallow entries if over capacity
  if (context.tt.size > TT_MAX_SIZE) {
    const keysToDelete: string[] = [];
    let count = 0;

    for (const [k, entry] of context.tt) {
      if (entry.depth <= 1) {
        keysToDelete.push(k);
        count++;

        if (count >= TT_MAX_SIZE * 0.2) {
          break;
        }
      }
    }

    for (const k of keysToDelete) {
      context.tt.delete(k);
    }
  }
}

function principalVariationFor(state: GameState, aiKingdom: Kingdom, context: SearchContext): AiMove[] {
  const variation: AiMove[] = [];
  let current = state;

  for (let index = 0; index < 6; index += 1) {
    const entry = context.tt.get(`${aiKingdom}|${searchStateKey(current)}`);

    if (!entry?.bestMove) {
      break;
    }

    variation.push(entry.bestMove);

    try {
      current = applySearchMove(current, entry.bestMove.pieceId, entry.bestMove.target);
    } catch {
      break;
    }
  }

  return variation;
}

function styleRootPolicyScore(
  state: GameState,
  action: AiMove,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
  options: AiMoveOptions,
): number {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);
  let score = 0;

  if (!movingPiece) {
    return score;
  }

  if (style.id === "aggressive") {
    score += targetPressureScore(state, action.target, kingdom, profile, style) * 3;
    score += givesDirectCheck(state, action, kingdom) ? 1_400 : 0;
    score += capturedPiece && !isNeutralBlocker(capturedPiece) ? pieceValue(capturedPiece, profile) * 0.45 : 0;
  }

  if (style.id === "solid") {
    score += threatenedPieceReliefScore(state, action, movingPiece, capturedPiece, kingdom, profile, style) * 0.65;
    score += kingSafetyScore(applySearchMove(state, action.pieceId, action.target), kingdom, profile) * 0.08;
  }

  if (style.id === "mobile") {
    score += movingPiece.type === "horse" || movingPiece.type === "cannon" ? 520 : 0;
    score += mobilityDeltaScore(state, action, movingPiece, profile) * 18;
  }

  return score + diversityJitter(action, options.styleDiversitySeed ?? options.seed ?? 0, style.id);
}

function compareRootAction(left: AiMove, right: AiMove, style: AiStyleProfile, options: AiMoveOptions): number {
  const diff =
    diversityJitter(left, options.styleDiversitySeed ?? options.seed ?? 0, style.id) -
    diversityJitter(right, options.styleDiversitySeed ?? options.seed ?? 0, style.id);

  return diff || compareAction(left, right);
}

function diversityJitter(action: AiMove, seed: number, styleId: string): number {
  const key = `${styleId}:${seed}:${action.pieceId}:${action.target}`;
  let hash = 2166136261;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % 401;
}

function tacticalActionScore(
  state: GameState,
  action: AiMove,
  movingPiece: Piece,
  capturedPiece: Piece | null,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  const nextState = applySearchMove(state, action.pieceId, action.target);
  let score = 0;

  if (state.checkedKingdoms.includes(kingdom) && !nextState.checkedKingdoms.includes(kingdom)) {
    score += 5_500 * style.safetyMultiplier;
  }

  const newlyCheckedOpponents = nextState.checkedKingdoms.filter((checkedKingdom) => {
    return checkedKingdom !== kingdom && !state.checkedKingdoms.includes(checkedKingdom);
  });
  score += newlyCheckedOpponents.length * 2_100 * style.attackMultiplier;

  if (capturedPiece?.type === "general") {
    score += profile.scoring.generalCaptureBonus;
  }

  if (!capturedPiece && movingPiece.type !== "general" && isPointControlledByOpponent(nextState, action.target, kingdom)) {
    score -= pieceValue(movingPiece, profile) * 0.34 / style.riskTolerance;
  }

  return score;
}

function quietExposurePenalty(
  state: GameState,
  action: AiMove,
  movingPiece: Piece,
  capturedPiece: Piece | null,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  if (capturedPiece || movingPiece.type === "general") {
    return 0;
  }

  const nextState = applySearchMove(state, action.pieceId, action.target);

  if (!isPointControlledByOpponent(nextState, action.target, kingdom)) {
    return 0;
  }

  return pieceValue(movingPiece, profile) * 0.42 / style.riskTolerance;
}

function threatenedPieceReliefScore(
  state: GameState,
  action: AiMove,
  movingPiece: Piece,
  capturedPiece: Piece | null,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  let score = 0;
  const wasHanging = isPieceHanging(state, movingPiece, profile);

  if (wasHanging) {
    const nextState = applySearchMove(state, action.pieceId, action.target);
    const movedPiece = nextState.pieces.find((piece) => piece.id === action.pieceId);

    if (movedPiece && !isPieceHanging(nextState, movedPiece, profile)) {
      score += pieceValue(movingPiece, profile) * 1.2 * style.safetyMultiplier;
    }
  }

  if (capturedPiece && !isNeutralBlocker(capturedPiece)) {
    const ownVictims = state.pieces.filter((piece) => {
      return piece.controller === kingdom && piece.blocksMovement && pieceAttacksSquare(state, capturedPiece, piece.position);
    });
    const bestVictimValue = Math.max(0, ...ownVictims.map((piece) => pieceValue(piece, profile)));

    score += bestVictimValue * 0.45 * style.safetyMultiplier;
  }

  const protectedOwnPieces = state.pieces.filter((piece) => {
    return piece.controller === kingdom && piece.blocksMovement && piece.id !== action.pieceId && isPieceHanging(state, piece, profile);
  });

  for (const ownPiece of protectedOwnPieces) {
    const attackers = attackersOf(state, ownPiece.position, kingdom);

    if (attackers.some((attacker) => capturedPiece?.id === attacker.id)) {
      score += pieceValue(ownPiece, profile) * 0.9;
    }
  }

  return score;
}

function endgameActionScore(state: GameState, action: AiMove, kingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): number {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);
  const material = materialByController(state, profile);
  const opponents = (Object.keys(kingdomRows) as Kingdom[]).filter((item) => item !== kingdom && !state.defeatedKingdoms.includes(item));
  const strongest = opponents.sort((left, right) => material[right] - material[left])[0];
  let score = 0;

  if (!movingPiece) {
    return score;
  }

  if (capturedPiece && !isNeutralBlocker(capturedPiece)) {
    score += pieceValue(capturedPiece, profile) * (capturedPiece.controller === strongest ? 1.1 : 0.75);
  }

  if (givesDirectCheck(state, action, kingdom)) {
    score += 5_500 * style.attackMultiplier;
  }

  const nextState = applySearchMove(state, action.pieceId, action.target);
  const currentDistance = nearestOpponentGeneralDistance(state, movingPiece.position, kingdom);
  const nextDistance = nearestOpponentGeneralDistance(nextState, action.target, kingdom);

  if (nextDistance < currentDistance) {
    score += (currentDistance - nextDistance) * 420 * style.attackMultiplier;
  }

  if (movingPiece.type === "soldier") {
    score += soldierAdvance({ ...movingPiece, position: action.target }) * 160;
  }

  if (addressesHangingPiece(state, action, kingdom, profile)) {
    score += pieceValue(movingPiece, profile) * 0.8 * style.safetyMultiplier;
  }

  return score;
}

function forcingOpportunityScore(state: GameState, aiKingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): number {
  if (state.currentKingdom !== aiKingdom) {
    return 0;
  }

  const actions = getAllActions(state, aiKingdom);
  let best = 0;

  for (const action of actions) {
    const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

    if (!capturedPiece && !givesDirectCheck(state, action, aiKingdom) && !state.checkedKingdoms.includes(aiKingdom)) {
      continue;
    }

    const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);

    if (!movingPiece || !doesNotLeaveKingdomInCheck(state, action, aiKingdom)) {
      continue;
    }

    const score = cheapActionScore(state, action, aiKingdom, profile, style);

    best = Math.max(best, score);
  }

  return best * 0.18;
}

function coalitionPressureScore(
  state: GameState,
  actorKingdom: Kingdom,
  aiKingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  const material = materialByController(state, profile);
  const strongest = strongestOpponent(material, actorKingdom);
  const actorScore = evaluateState(state, actorKingdom, profile, style);
  const aiScore = evaluateState(state, aiKingdom, profile, aiStyleForKingdom(aiKingdom));

  if (strongest === aiKingdom) {
    return Math.max(0, aiScore - actorScore) * 0.12 * style.targetStrongestBonus;
  }

  return Math.max(0, material[strongest] - material[actorKingdom] - 700) * 0.04 * style.balanceMultiplier;
}

function targetPressureScore(
  state: GameState,
  target: PointId,
  kingdom: Kingdom,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  const targetRow = parsePointId(target).row;
  const targetKingdom = (Object.keys(kingdomRows) as Kingdom[]).find((item) => {
    return (kingdomRows[item] as readonly string[]).includes(targetRow);
  });

  if (!targetKingdom || targetKingdom === kingdom) {
    return 0;
  }

  const material = materialByController(state, profile);
  const strongest = strongestOpponent(material, kingdom);

  return (targetKingdom === strongest ? 85 * style.targetStrongestBonus : 35) * style.attackMultiplier;
}

function neutralBlockerCapturePenalty(movingPiece: Piece, profile: AiProfile): number {
  const movingValue = pieceValue(movingPiece, profile);

  return 260 + movingValue * 0.35;
}

function mobilityDeltaScore(state: GameState, action: AiMove, movingPiece: Piece, profile: AiProfile): number {
  if (movingPiece.type !== "horse" && movingPiece.type !== "cannon" && movingPiece.type !== "chariot") {
    return 0;
  }

  const before = getPseudoLegalMoves(state, movingPiece).length;
  const nextState = applySearchMove(state, action.pieceId, action.target);
  const movedPiece = nextState.pieces.find((piece) => piece.id === action.pieceId);

  return movedPiece ? getPseudoLegalMoves(nextState, movedPiece).length - before : 0;
}

function uniqueActions(actions: AiMove[]): AiMove[] {
  const seen = new Set<string>();

  return actions.filter((action) => {
    const key = actionKey(action);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sameMove(left: AiMove, right: AiMove): boolean {
  return left.pieceId === right.pieceId && left.target === right.target;
}

function actionKey(action: AiMove): string {
  return `${action.pieceId}:${action.target}`;
}

function searchStateKey(state: GameState): string {
  // Use a simpler key format that avoids sorting overhead
  // Only include pieces that affect the game (block movement)
  const parts: string[] = [state.currentKingdom, state.winner ?? "-", state.defeatedKingdoms.join("")];

  for (const piece of state.pieces) {
    if (!piece.blocksMovement) continue;
    parts.push(piece.id, piece.position, piece.controller[0], piece.defeated ? "1" : "0");
  }

  return parts.join("|");
}

function compareAction(left: AiMove, right: AiMove): number {
  return `${left.pieceId}:${left.target}`.localeCompare(`${right.pieceId}:${right.target}`);
}

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed;

  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function mvvLvaBonus(capturedPiece: Piece, movingPiece: Piece, profile: AiProfile): number {
  const capturedValue = pieceValue(capturedPiece, profile);
  const movingValue = pieceValue(movingPiece, profile);

  if (movingValue >= capturedValue) {
    return 0;
  }

  return Math.floor((capturedValue - movingValue) * 0.15);
}

function skipTurn(state: GameState): GameState | null {
  const defeatedKingdoms = state.defeatedKingdoms;
  const activeKingdoms = turnOrder.filter((kingdom) => !defeatedKingdoms.includes(kingdom));

  if (activeKingdoms.length <= 1) {
    return null;
  }

  const nextKingdom = nextActiveKingdom(state.currentKingdom, defeatedKingdoms);
  const nextNextKingdom = nextActiveKingdom(nextKingdom, defeatedKingdoms);

  return {
    ...state,
    currentKingdom: nextNextKingdom,
    _positionMap: undefined,
  };
}

function hasEnoughMaterialForNullMove(state: GameState, kingdom: Kingdom, profile: AiProfile): boolean {
  // Don't null move if we only have pawns and a general — no pieces to "waste" a move
  const ownPieces = state.pieces.filter(
    (piece) => piece.controller === kingdom && piece.blocksMovement && !isNeutralBlocker(piece),
  );
  const majorPieces = ownPieces.filter(
    (piece) => piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse",
  );

  return majorPieces.length >= 2;
}
