import type { Kingdom, PointId } from "./board";
import { kingdomRows, parsePointId } from "./board";
import { capturedPieceAt, type GameState } from "./game-state";
import { getCheckedKingdoms, getLegalMoves } from "./moves";
import { aiStyleForKingdom, defaultAiProfile, type AiProfile, type AiStyleProfile } from "./ai-profile";
import type { Piece } from "./pieces";
import { applyMove } from "./rules";

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
}

const winScore = 1_000_000;
const minimumSearchBudgetMs = 12;
const defaultSearchBudgetMs = 80;

interface SearchContext {
  deadline: number;
  timedOut: boolean;
}

export function chooseAiMove(
  state: GameState,
  kingdom: Kingdom,
  profile: AiProfile = defaultAiProfile,
  options: AiMoveOptions = {},
): AiMove | null {
  const moveOptions = options.random || options.seed === undefined ? options : { ...options, random: seededRandom(options.seed) };
  const style = options.style ?? aiStyleForKingdom(kingdom);
  const context = createSearchContext(moveOptions);
  const actions = getCandidateActions(state, kingdom, profile, style);

  if (!actions.length) {
    return null;
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

  const depth = searchDepthForState(state, profile, moveOptions);
  const rootActions = actions.slice(0, rootBeamForState(state, profile, moveOptions, depth));
  let bestAction = rootActions[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  const scoredActions: Array<{ action: AiMove; score: number }> = [];

  const searchProfile = searchProfileForState(state, profile, moveOptions, depth);

  for (const action of rootActions) {
    if (!hasSearchTime(context) && scoredActions.length > 0) {
      break;
    }

    const nextState = applySearchMove(state, action.pieceId, action.target);
    const score =
      (depth > 0
        ? evaluateAfterResponses(nextState, kingdom, depth, searchProfile, style, context)
        : evaluateState(nextState, kingdom, searchProfile, style) + forcingOpportunityScore(nextState, kingdom, searchProfile, style)) +
      cheapActionScore(state, action, kingdom, profile, style) * profile.scoring.rootActionWeight;

    scoredActions.push({ action, score });

    if (score > bestScore || (score === bestScore && compareAction(action, bestAction) < 0)) {
      bestAction = action;
      bestScore = score;
    }
  }

  const exploratoryAction = pickExploratoryAction(scoredActions, bestScore, moveOptions);

  if (exploratoryAction) {
    return exploratoryAction;
  }

  return bestAction;
}

function searchDepthForState(state: GameState, profile: AiProfile, options: AiMoveOptions): number {
  const profileDepth = Math.min(profile.searchDepth, options.maxDepth ?? profile.searchDepth);

  if (!isOpeningPhase(state)) {
    return profileDepth;
  }

  return Math.max(0, Math.min(profileDepth, options.openingSearchDepth ?? 0));
}

function rootBeamForState(state: GameState, profile: AiProfile, options: AiMoveOptions, depth: number): number {
  if (!isOpeningPhase(state) || depth <= 0) {
    return profile.rootBeam;
  }

  return Math.min(profile.rootBeam, options.openingRootBeam ?? 5 + Math.max(0, depth - 1) * 4);
}

function searchProfileForState(state: GameState, profile: AiProfile, options: AiMoveOptions, depth: number): AiProfile {
  if (!isOpeningPhase(state) || depth <= 0) {
    return profile;
  }

  return {
    ...profile,
    responseBeam: Math.min(profile.responseBeam, options.openingResponseBeam ?? Math.max(2, Math.min(4, depth + 1))),
    thirdPlayerBeam: Math.min(profile.thirdPlayerBeam, options.openingThirdPlayerBeam ?? Math.max(1, Math.min(3, depth))),
  };
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
  if (!hasSearchTime(context)) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  if (state.winner) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  if (depth === 0) {
    return (
      evaluateState(state, aiKingdom, profile, aiStyle) +
      tacticalStabilityScore(state, aiKingdom, profile, aiStyle) +
      forcingOpportunityScore(state, aiKingdom, profile, aiStyle)
    );
  }

  const currentKingdom = state.currentKingdom;
  const currentStyle = currentKingdom === aiKingdom ? aiStyle : aiStyleForKingdom(currentKingdom);
  const actions = getCandidateActions(state, currentKingdom, profile, currentStyle).slice(
    0,
    currentKingdom === aiKingdom ? profile.responseBeam : profile.thirdPlayerBeam,
  );

  if (!actions.length) {
    return evaluateState(state, aiKingdom, profile, aiStyle);
  }

  if (currentKingdom === aiKingdom) {
    let value = Number.NEGATIVE_INFINITY;

    for (const action of actions) {
      value = Math.max(
        value,
        search(applySearchMove(state, action.pieceId, action.target), aiKingdom, depth - 1, alpha, beta, profile, aiStyle, context),
      );
      alpha = Math.max(alpha, value);

      if (beta <= alpha) {
        break;
      }
    }

    return value;
  }

  let bestActorScore = Number.NEGATIVE_INFINITY;
  let selectedAiScore = Number.POSITIVE_INFINITY;

  for (const action of actions) {
    const nextState = applySearchMove(state, action.pieceId, action.target);
    const actorScore = search(
      nextState,
      currentKingdom,
      depth - 1,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      profile,
      currentStyle,
      context,
    );
    const aiScore = search(nextState, aiKingdom, depth - 1, alpha, beta, profile, aiStyle, context);
    const pressureBonus = coalitionPressureScore(nextState, currentKingdom, aiKingdom, profile, currentStyle);
    const actorDecisionScore = actorScore + pressureBonus;

    if (
      actorDecisionScore > bestActorScore ||
      (actorDecisionScore === bestActorScore && aiScore < selectedAiScore) ||
      (actorDecisionScore === bestActorScore && aiScore === selectedAiScore && compareAction(action, actions[0]) < 0)
    ) {
      bestActorScore = actorDecisionScore;
      selectedAiScore = aiScore;
    }

    beta = Math.min(beta, selectedAiScore);

    if (beta <= alpha) {
      break;
    }
  }

  return selectedAiScore;
}

function getCandidateActions(state: GameState, kingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): AiMove[] {
  const actions = getAllActions(state, kingdom).sort((left, right) => {
    const scoreDiff = cheapActionScore(state, right, kingdom, profile, style) - cheapActionScore(state, left, kingdom, profile, style);

    return scoreDiff || compareAction(left, right);
  });
  const inCheck = state.checkedKingdoms.includes(kingdom);
  const highPriorityActions = actions.filter((action) => {
    const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

    return (
      (capturedPiece?.type === "general" && !isNeutralBlocker(capturedPiece)) ||
      isKingDefenseCapture(state, action, kingdom) ||
      givesDirectCheck(state, action, kingdom)
    );
  });
  const scanActions = inCheck ? actions : uniqueActions([...highPriorityActions, ...actions.slice(0, profile.safetyScanLimit)]);
  const safeActions = scanActions.filter((action) => doesNotLeaveKingdomInCheck(state, action, kingdom));
  const candidates = safeActions.length ? safeActions : scanActions;

  return candidates.sort((left, right) => {
    const scoreDiff = cheapActionScore(state, right, kingdom, profile, style) - cheapActionScore(state, left, kingdom, profile, style);

    return scoreDiff || compareAction(left, right);
  });
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

function applySearchMove(state: GameState, pieceId: string, target: PointId): GameState {
  const nextState = applyMove(state, pieceId, target);

  return {
    ...nextState,
    moveHistory: state.moveHistory,
  };
}

function doesNotLeaveKingdomInCheck(state: GameState, action: AiMove, kingdom: Kingdom): boolean {
  const nextState = applySearchMove(state, action.pieceId, action.target);

  return !getCheckedKingdoms(nextState).includes(kingdom);
}

function cheapActionScore(state: GameState, action: AiMove, kingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): number {
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

    score -= exchangeRiskPenalty(state, action, movingPiece, capturedPiece, kingdom, profile, style);
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
  }

  score += developmentScore(state, action, movingPiece, profile) * style.developmentMultiplier;
  score += targetPressureScore(state, action.target, kingdom, profile, style);
  score += tacticalActionScore(state, action, movingPiece, capturedPiece, kingdom, profile, style);
  score += style.preferredPieces[movingPiece.type] ?? 0;
  score -= quietExposurePenalty(state, action, movingPiece, capturedPiece, kingdom, profile, style);
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

export function evaluateAiState(
  state: GameState,
  aiKingdom: Kingdom,
  profile: AiProfile = defaultAiProfile,
  style: AiStyleProfile = aiStyleForKingdom(aiKingdom),
): number {
  return evaluateState(state, aiKingdom, profile, style);
}

function evaluateState(state: GameState, aiKingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): number {
  if (state.winner === aiKingdom) {
    return winScore;
  }

  if (state.winner) {
    return -winScore;
  }

  if (state.defeatedKingdoms.includes(aiKingdom)) {
    return -winScore / 2;
  }

  const material = materialByController(state, profile);
  const opponentScores = (Object.keys(material) as Kingdom[]).filter((kingdom) => kingdom !== aiKingdom).map((kingdom) => material[kingdom]);
  let score = material[aiKingdom] - Math.max(...opponentScores) * 0.9 - Math.min(...opponentScores) * 0.45;

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    const value = pieceValue(piece, profile);

    if (piece.controller === aiKingdom) {
      score += activityBonus(state, piece, profile) * style.mobilityMultiplier + formationBonus(state, piece, profile) * style.developmentMultiplier;
    } else {
      score -= piece.controller === strongestOpponent(material, aiKingdom) ? value * 0.25 : value * 0.08;
    }
  }

  for (const defeatedKingdom of state.defeatedKingdoms) {
    score += defeatedKingdom === aiKingdom ? profile.scoring.defeatedSelfPenalty : profile.scoring.defeatedOpponentReward;
  }

  if (state.checkedKingdoms.includes(aiKingdom)) {
    score -= profile.scoring.checkedSelfPenalty * style.safetyMultiplier;
  }

  score += state.checkedKingdoms.filter((kingdom) => kingdom !== aiKingdom).length * profile.scoring.checkedOpponentReward * style.attackMultiplier;
  score += kingSafetyScore(state, aiKingdom, profile) * style.safetyMultiplier;
  score += threePlayerBalanceScore(material, aiKingdom, profile) * style.balanceMultiplier;

  return score;
}

function activityBonus(state: GameState, piece: Piece, profile: AiProfile): number {
  if (piece.type === "soldier") {
    return soldierAdvance(piece) * profile.scoring.soldierAdvanceEval;
  }

  if (piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse") {
    return getLegalMoves(state, piece).length * profile.scoring.mobilityEval;
  }

  return 0;
}

function formationBonus(state: GameState, piece: Piece, profile: AiProfile): number {
  const opening = isOpeningPhase(state);

  if (opening && piece.type === "cannon" && !isOwnKingdomPoint(piece.kingdom, piece.position)) {
    return profile.scoring.openingCannonOutPenalty;
  }

  if (opening && (piece.type === "horse" || piece.type === "chariot") && !isOriginalBackRank(piece)) {
    return profile.scoring.openingMajorDeveloped;
  }

  if (piece.type === "advisor" || piece.type === "elephant") {
    return isOwnKingdomPoint(piece.kingdom, piece.position)
      ? profile.scoring.advisorElephantHome
      : profile.scoring.advisorElephantAwayPenalty;
  }

  return 0;
}

function pieceValue(piece: Piece, profile: AiProfile): number {
  return profile.pieceValues[piece.type] + (piece.type === "soldier" ? soldierAdvance(piece) * 25 : 0);
}

function materialByController(state: GameState, profile: AiProfile): Record<Kingdom, number> {
  const material: Record<Kingdom, number> = {
    wei: 0,
    shu: 0,
    wu: 0,
  };

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    material[piece.controller] += pieceValue(piece, profile);
  }

  return material;
}

function developmentScore(state: GameState, action: AiMove, piece: Piece, profile: AiProfile): number {
  if (!isOpeningPhase(state) || capturedPieceAt(state, action.pieceId, action.target)) {
    return 0;
  }

  if ((piece.type === "horse" || piece.type === "chariot") && isOriginalBackRank(piece)) {
    return profile.scoring.developmentMajor;
  }

  if (piece.type === "cannon" && isOwnKingdomPoint(piece.kingdom, action.target)) {
    return profile.scoring.developmentCannon;
  }

  if (piece.type === "soldier" && [3, 5, 7].includes(parsePointId(piece.position).col)) {
    return profile.scoring.developmentSoldier;
  }

  return 0;
}

function repetitiveQuietMovePenalty(state: GameState, action: AiMove, movingPiece: Piece, capturedPiece: Piece | null): number {
  if (capturedPiece) {
    return 0;
  }

  const ownHistory = (state.moveHistory ?? []).filter((move) => move.kingdom === movingPiece.controller);

  if (!ownHistory.length) {
    return 0;
  }

  const recentOwnMoves = ownHistory.slice(-8);
  const recentPieceMoves = recentOwnMoves.filter((move) => move.pieceId === action.pieceId);
  const lastPieceMove = recentPieceMoves.at(-1);
  let penalty = 0;

  if (lastPieceMove?.from === action.target && lastPieceMove.target === action.from) {
    penalty += 2_400;
  }

  if (recentPieceMoves.some((move) => move.from === action.target && move.target === action.from)) {
    penalty += 800;
  }

  if (recentPieceMoves.some((move) => move.from === action.target || move.target === action.target)) {
    penalty += 360;
  }

  const samePieceTempo = ownHistory.slice(-4).filter((move) => move.pieceId === action.pieceId).length;

  if (samePieceTempo >= 2) {
    penalty += samePieceTempo * 260;
  }

  if (movingPiece.type === "advisor" || movingPiece.type === "elephant") {
    penalty += isOwnKingdomPoint(movingPiece.kingdom, action.target) ? 80 : 420;
  }

  if (movingPiece.type === "general") {
    penalty += 620;
  }

  return penalty;
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

  if (getLegalMoves(state, capturedPiece).includes(movingPiece.position)) {
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

function isPointControlledByOpponent(state: GameState, point: PointId, kingdom: Kingdom): boolean {
  return state.pieces.some((piece) => {
    return piece.controller !== kingdom && piece.blocksMovement && !isNeutralBlocker(piece) && getLegalMoves(state, piece).includes(point);
  });
}

function isOpeningPhase(state: GameState): boolean {
  return state.pieces.filter((piece) => piece.blocksMovement && !piece.defeated).length >= 42;
}

function isOriginalBackRank(piece: Piece): boolean {
  const rows = kingdomRows[piece.kingdom];

  return piece.position[0] === rows[rows.length - 1];
}

function isOwnKingdomPoint(kingdom: Kingdom, point: PointId): boolean {
  return (kingdomRows[kingdom] as readonly string[]).includes(parsePointId(point).row);
}

function isInsideOwnPalace(kingdom: Kingdom, point: PointId): boolean {
  const rows = kingdomRows[kingdom] as readonly string[];
  const palaceRows = rows.slice(2);
  const { row, col } = parsePointId(point);

  return palaceRows.includes(row) && col >= 4 && col <= 6;
}

function isKingDefenseCapture(state: GameState, action: AiMove, kingdom: Kingdom): boolean {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);

  if (!movingPiece || movingPiece.type !== "general" || !capturedPiece || isNeutralBlocker(capturedPiece)) {
    return false;
  }

  return isInsideOwnPalace(kingdom, action.target) || getLegalMoves(state, capturedPiece).includes(movingPiece.position);
}

function tacticalStabilityScore(state: GameState, aiKingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): number {
  let score = 0;

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    const attackedByOpponent = isPointControlledByOpponent(state, piece.position, piece.controller);

    if (!attackedByOpponent) {
      continue;
    }

    const penalty =
      pieceValue(piece, profile) *
      (piece.type === "general"
        ? profile.scoring.tacticalGeneralRiskMultiplier * style.safetyMultiplier
        : profile.scoring.tacticalPieceRiskMultiplier / style.riskTolerance);

    score += piece.controller === aiKingdom ? -penalty : penalty * profile.scoring.tacticalOpponentRiskReward;
  }

  return score;
}

function kingSafetyScore(state: GameState, kingdom: Kingdom, profile: AiProfile): number {
  const general = state.pieces.find((piece) => {
    return piece.kingdom === kingdom && piece.type === "general" && piece.blocksMovement;
  });

  if (!general) {
    return -80_000;
  }

  let score = 0;
  const ownPieces = state.pieces.filter((piece) => piece.controller === kingdom && piece.blocksMovement && !isNeutralBlocker(piece));
  const opponentPieces = state.pieces.filter((piece) => piece.controller !== kingdom && piece.blocksMovement && !isNeutralBlocker(piece));
  const palaceRows = kingdomRows[kingdom] as readonly string[];
  const palaceGuardRows = palaceRows.slice(2);

  if (state.checkedKingdoms.includes(kingdom)) {
    score -= profile.scoring.directCheckPenalty;
  }

  const directAttackers = opponentPieces.filter((piece) => getLegalMoves(state, piece).includes(general.position));
  score -= directAttackers.length * profile.scoring.directAttackerPenalty;

  const palacePressure = opponentPieces.reduce((total, piece) => {
    return (
      total +
      getLegalMoves(state, piece).filter((target) => {
        const { row, col } = parsePointId(target);

        return palaceGuardRows.includes(row) && col >= 4 && col <= 6;
      }).length
    );
  }, 0);
  score -= palacePressure * profile.scoring.palacePressurePenalty;

  const defenders = ownPieces.filter((piece) => {
    if (piece.type !== "advisor" && piece.type !== "elephant") {
      return false;
    }

    const { row, col } = parsePointId(piece.position);

    return palaceRows.includes(row) && col >= 3 && col <= 7;
  });
  score += defenders.length * profile.scoring.defenderBonus;

  const generalHome = `${palaceRows[palaceRows.length - 1]}5`;

  if (general.position === generalHome) {
    score += profile.scoring.generalHomeBonus;
  } else {
    score -= profile.scoring.generalAwayPenalty;
  }

  return score;
}

function threePlayerBalanceScore(material: Record<Kingdom, number>, aiKingdom: Kingdom, profile: AiProfile): number {
  const opponents = (Object.keys(material) as Kingdom[]).filter((kingdom) => kingdom !== aiKingdom);
  const [stronger, weaker] = opponents.sort((left, right) => material[right] - material[left]);
  const gap = material[stronger] - material[weaker];

  return gap > 900
    ? -Math.min(profile.scoring.balanceGapPenaltyMax, gap * profile.scoring.balanceGapPenalty)
    : profile.scoring.balanceStableBonus;
}

function strongestOpponent(material: Record<Kingdom, number>, aiKingdom: Kingdom): Kingdom {
  return (Object.keys(material) as Kingdom[])
    .filter((kingdom) => kingdom !== aiKingdom)
    .sort((left, right) => material[right] - material[left])[0];
}

function createSearchContext(options: AiMoveOptions): SearchContext {
  const budget = options.timeBudgetMs ?? ((options.explorationRate ?? 0) > 0 ? 1_000 : defaultSearchBudgetMs);

  return {
    deadline: Number.isFinite(budget) ? performance.now() + Math.max(minimumSearchBudgetMs, budget) : Number.POSITIVE_INFINITY,
    timedOut: false,
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

function givesDirectCheck(state: GameState, action: AiMove, kingdom: Kingdom): boolean {
  const nextState = applySearchMove(state, action.pieceId, action.target);

  return nextState.checkedKingdoms.some((checkedKingdom) => checkedKingdom !== kingdom);
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

function soldierAdvance(piece: Piece): number {
  const rows = kingdomRows[piece.kingdom];
  const row = parsePointId(piece.position).row;
  const index = rows.indexOf(row as never);

  return index >= 0 ? rows.length - 1 - index : rows.length;
}

function isNeutralBlocker(piece: Piece): boolean {
  return piece.defeated && piece.controller === piece.kingdom;
}

function neutralBlockerCapturePenalty(movingPiece: Piece, profile: AiProfile): number {
  const movingValue = pieceValue(movingPiece, profile);

  return 260 + movingValue * 0.35;
}

function uniqueActions(actions: AiMove[]): AiMove[] {
  const seen = new Set<string>();

  return actions.filter((action) => {
    const key = `${action.pieceId}:${action.target}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
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
