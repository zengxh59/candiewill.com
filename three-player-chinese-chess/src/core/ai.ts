import type { Kingdom, PointId } from "./board";
import { kingdomRows, parsePointId } from "./board";
import { capturedPieceAt, type GameState } from "./game-state";
import { getCheckedKingdoms, getLegalMoves } from "./moves";
import type { Piece, PieceType } from "./pieces";
import { applyMove } from "./rules";

export interface AiMove {
  pieceId: string;
  from: PointId;
  target: PointId;
}

const searchDepth = 2;
const winScore = 1_000_000;
const rootBeam = 12;
const responseBeam = 5;
const thirdPlayerBeam = 3;
const safetyScanLimit = 18;

const pieceValues: Record<PieceType, number> = {
  general: 12_000,
  chariot: 900,
  cannon: 400,
  horse: 400,
  elephant: 200,
  advisor: 200,
  soldier: 100,
};

export function chooseAiMove(state: GameState, kingdom: Kingdom): AiMove | null {
  const actions = getCandidateActions(state, kingdom);

  if (!actions.length) {
    return null;
  }

  const urgentKingDefense = actions.find((action) => isKingDefenseCapture(state, action, kingdom));

  if (urgentKingDefense) {
    return urgentKingDefense;
  }

  const generalCapture = actions.find((action) => capturedPieceAt(state, action.pieceId, action.target)?.type === "general");

  if (generalCapture) {
    return generalCapture;
  }

  const rootActions = actions.slice(0, rootBeam);
  let bestAction = rootActions[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  const depth = isOpeningPhase(state) ? 0 : searchDepth;

  for (const action of rootActions) {
    const nextState = applyMove(state, action.pieceId, action.target);
    const score =
      (depth > 0 ? evaluateAfterResponses(nextState, kingdom, depth) : evaluateState(nextState, kingdom)) +
      cheapActionScore(state, action, kingdom) * 0.35;

    if (score > bestScore || (score === bestScore && compareAction(action, bestAction) < 0)) {
      bestAction = action;
      bestScore = score;
    }
  }

  return bestAction;
}

export function getAiActions(state: GameState, kingdom: Kingdom): AiMove[] {
  return getCandidateActions(state, kingdom);
}

function search(state: GameState, aiKingdom: Kingdom, depth: number, alpha: number, beta: number): number {
  if (state.winner) {
    return evaluateState(state, aiKingdom);
  }

  if (depth === 0) {
    return evaluateState(state, aiKingdom) + tacticalStabilityScore(state, aiKingdom);
  }

  const currentKingdom = state.currentKingdom;
  const actions = getCandidateActions(state, currentKingdom).slice(0, currentKingdom === aiKingdom ? responseBeam : thirdPlayerBeam);

  if (!actions.length) {
    return evaluateState(state, aiKingdom);
  }

  if (currentKingdom === aiKingdom) {
    let value = Number.NEGATIVE_INFINITY;

    for (const action of actions) {
      value = Math.max(value, search(applyMove(state, action.pieceId, action.target), aiKingdom, depth - 1, alpha, beta));
      alpha = Math.max(alpha, value);

      if (beta <= alpha) {
        break;
      }
    }

    return value;
  }

  let value = Number.POSITIVE_INFINITY;

  for (const action of actions) {
    value = Math.min(value, search(applyMove(state, action.pieceId, action.target), aiKingdom, depth - 1, alpha, beta));
    beta = Math.min(beta, value);

    if (beta <= alpha) {
      break;
    }
  }

  return value;
}

function getCandidateActions(state: GameState, kingdom: Kingdom): AiMove[] {
  const actions = getAllActions(state, kingdom).sort((left, right) => {
    const scoreDiff = cheapActionScore(state, right, kingdom) - cheapActionScore(state, left, kingdom);

    return scoreDiff || compareAction(left, right);
  });
  const highPriorityActions = actions.filter((action) => {
    return capturedPieceAt(state, action.pieceId, action.target)?.type === "general" || isKingDefenseCapture(state, action, kingdom);
  });
  const scanActions = uniqueActions([...highPriorityActions, ...actions.slice(0, safetyScanLimit)]);
  const safeActions = scanActions.filter((action) => doesNotLeaveKingdomInCheck(state, action, kingdom));
  const candidates = safeActions.length ? safeActions : scanActions;

  return candidates.sort((left, right) => {
    const scoreDiff = cheapActionScore(state, right, kingdom) - cheapActionScore(state, left, kingdom);

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

function doesNotLeaveKingdomInCheck(state: GameState, action: AiMove, kingdom: Kingdom): boolean {
  const nextState = applyMove(state, action.pieceId, action.target);

  return !getCheckedKingdoms(nextState).includes(kingdom);
}

function cheapActionScore(state: GameState, action: AiMove, kingdom: Kingdom): number {
  const movingPiece = state.pieces.find((piece) => piece.id === action.pieceId);
  const capturedPiece = capturedPieceAt(state, action.pieceId, action.target);
  let score = 0;

  if (!movingPiece) {
    return score;
  }

  if (capturedPiece) {
    const capturedValue = pieceValue(capturedPiece);

    if (movingPiece.type === "general") {
      score += kingDefenseCaptureScore(state, action, movingPiece, capturedPiece, kingdom);
    } else {
      const movingValue = pieceValue(movingPiece);

      score += capturedValue * 3 + (capturedValue - movingValue) * 5;
    }

    if (capturedPiece.type === "general") {
      score += 90_000;
    }

    score -= exchangeRiskPenalty(state, action, movingPiece, capturedPiece, kingdom);
    score -= openingRaidPenalty(state, action, movingPiece, capturedPiece);
  }

  if (movingPiece.type === "general" && !capturedPiece) {
    score -= 220;
  }

  if (movingPiece.type === "soldier") {
    score += soldierAdvance({ ...movingPiece, position: action.target }) * 28;
  }

  if (movingPiece.type === "horse" || movingPiece.type === "chariot" || movingPiece.type === "cannon") {
    score += 90;
  }

  score += developmentScore(state, action, movingPiece);
  score += targetPressureScore(state, action.target, kingdom);

  return score;
}

function evaluateAfterResponses(state: GameState, aiKingdom: Kingdom, depth: number): number {
  if (state.winner || depth <= 0 || state.currentKingdom === aiKingdom) {
    return evaluateState(state, aiKingdom);
  }

  let worstScore = Number.POSITIVE_INFINITY;
  const responseActions = getCandidateActions(state, state.currentKingdom).slice(0, responseBeam);

  if (!responseActions.length) {
    return evaluateState(state, aiKingdom);
  }

  for (const response of responseActions) {
    const responseState = applyMove(state, response.pieceId, response.target);
    const responseScore =
      responseState.currentKingdom !== aiKingdom && !responseState.winner
        ? evaluateThirdPlayerResponse(responseState, aiKingdom, depth - 1)
        : search(responseState, aiKingdom, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);

    worstScore = Math.min(worstScore, responseScore);
  }

  return worstScore;
}

function evaluateThirdPlayerResponse(state: GameState, aiKingdom: Kingdom, depth: number): number {
  const actions = getCandidateActions(state, state.currentKingdom).slice(0, thirdPlayerBeam);

  if (!actions.length) {
    return evaluateState(state, aiKingdom);
  }

  let worstScore = Number.POSITIVE_INFINITY;

  for (const action of actions) {
    worstScore = Math.min(
      worstScore,
      search(applyMove(state, action.pieceId, action.target), aiKingdom, Math.max(0, depth - 1), Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
    );
  }

  return worstScore;
}

function evaluateState(state: GameState, aiKingdom: Kingdom): number {
  if (state.winner === aiKingdom) {
    return winScore;
  }

  if (state.winner) {
    return -winScore;
  }

  if (state.defeatedKingdoms.includes(aiKingdom)) {
    return -winScore / 2;
  }

  const material = materialByController(state);
  const opponentScores = (Object.keys(material) as Kingdom[]).filter((kingdom) => kingdom !== aiKingdom).map((kingdom) => material[kingdom]);
  let score = material[aiKingdom] - Math.max(...opponentScores) * 0.9 - Math.min(...opponentScores) * 0.45;

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    const value = pieceValue(piece);

    if (piece.controller === aiKingdom) {
      score += activityBonus(state, piece) + formationBonus(state, piece);
    } else {
      score -= piece.controller === strongestOpponent(material, aiKingdom) ? value * 0.25 : value * 0.08;
    }
  }

  for (const defeatedKingdom of state.defeatedKingdoms) {
    score += defeatedKingdom === aiKingdom ? -35_000 : 8_000;
  }

  if (state.checkedKingdoms.includes(aiKingdom)) {
    score -= 4_000;
  }

  score += state.checkedKingdoms.filter((kingdom) => kingdom !== aiKingdom).length * 1_800;
  score += kingSafetyScore(state, aiKingdom);
  score += threePlayerBalanceScore(material, aiKingdom);

  return score;
}

function activityBonus(state: GameState, piece: Piece): number {
  if (piece.type === "soldier") {
    return soldierAdvance(piece) * 18;
  }

  if (piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse") {
    return getLegalMoves(state, piece).length * 8;
  }

  return 0;
}

function formationBonus(state: GameState, piece: Piece): number {
  const opening = isOpeningPhase(state);

  if (opening && piece.type === "cannon" && !isOwnKingdomPoint(piece.kingdom, piece.position)) {
    return -130;
  }

  if (opening && (piece.type === "horse" || piece.type === "chariot") && !isOriginalBackRank(piece)) {
    return 110;
  }

  if (piece.type === "advisor" || piece.type === "elephant") {
    return isOwnKingdomPoint(piece.kingdom, piece.position) ? 40 : -160;
  }

  return 0;
}

function pieceValue(piece: Piece): number {
  return pieceValues[piece.type] + (piece.type === "soldier" ? soldierAdvance(piece) * 25 : 0);
}

function materialByController(state: GameState): Record<Kingdom, number> {
  const material: Record<Kingdom, number> = {
    wei: 0,
    shu: 0,
    wu: 0,
  };

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    material[piece.controller] += pieceValue(piece);
  }

  return material;
}

function developmentScore(state: GameState, action: AiMove, piece: Piece): number {
  if (!isOpeningPhase(state) || capturedPieceAt(state, action.pieceId, action.target)) {
    return 0;
  }

  if ((piece.type === "horse" || piece.type === "chariot") && isOriginalBackRank(piece)) {
    return 260;
  }

  if (piece.type === "cannon" && isOwnKingdomPoint(piece.kingdom, action.target)) {
    return 120;
  }

  if (piece.type === "soldier" && [3, 5, 7].includes(parsePointId(piece.position).col)) {
    return 80;
  }

  return 0;
}

function exchangeRiskPenalty(
  state: GameState,
  action: AiMove,
  movingPiece: Piece,
  capturedPiece: Piece,
  kingdom: Kingdom,
): number {
  if (movingPiece.type === "general" || capturedPiece.type === "general") {
    return 0;
  }

  const movingValue = pieceValue(movingPiece);
  const capturedValue = pieceValue(capturedPiece);
  const nextState = applyMove(state, action.pieceId, action.target);
  const exposed = isPointControlledByOpponent(nextState, action.target, kingdom);

  if (!exposed) {
    return 0;
  }

  const equalOrBadTrade = capturedValue <= movingValue + 60;
  const risk = equalOrBadTrade ? movingValue * 2.8 : movingValue * 1.05;

  return risk;
}

function kingDefenseCaptureScore(
  state: GameState,
  action: AiMove,
  movingPiece: Piece,
  capturedPiece: Piece,
  kingdom: Kingdom,
): number {
  let score = pieceValue(capturedPiece) * 6;

  if (isInsideOwnPalace(kingdom, action.target)) {
    score += 22_000;
  }

  if (getLegalMoves(state, capturedPiece).includes(movingPiece.position)) {
    score += 18_000;
  }

  if (capturedPiece.type === "cannon" || capturedPiece.type === "chariot" || capturedPiece.type === "horse") {
    score += 7_000;
  }

  return score;
}

function openingRaidPenalty(state: GameState, action: AiMove, movingPiece: Piece, capturedPiece: Piece): number {
  if (!isOpeningPhase(state) || capturedPiece.type === "general") {
    return 0;
  }

  const capturedValue = pieceValue(capturedPiece);
  const movingValue = pieceValue(movingPiece);
  const leavesOwnRegion = !isOwnKingdomPoint(movingPiece.kingdom, action.target);

  if (!leavesOwnRegion || capturedValue > movingValue + 180) {
    return 0;
  }

  if (movingPiece.type === "cannon" || movingPiece.type === "horse" || movingPiece.type === "chariot") {
    return 1_350;
  }

  return 0;
}

function isPointControlledByOpponent(state: GameState, point: PointId, kingdom: Kingdom): boolean {
  return state.pieces.some((piece) => {
    return piece.controller !== kingdom && piece.blocksMovement && getLegalMoves(state, piece).includes(point);
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

  if (!movingPiece || movingPiece.type !== "general" || !capturedPiece) {
    return false;
  }

  return isInsideOwnPalace(kingdom, action.target) || getLegalMoves(state, capturedPiece).includes(movingPiece.position);
}

function tacticalStabilityScore(state: GameState, aiKingdom: Kingdom): number {
  let score = 0;

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    const attackedByOpponent = isPointControlledByOpponent(state, piece.position, piece.controller);

    if (!attackedByOpponent) {
      continue;
    }

    const penalty = pieceValue(piece) * (piece.type === "general" ? 3.5 : 0.6);

    score += piece.controller === aiKingdom ? -penalty : penalty * 0.35;
  }

  return score;
}

function kingSafetyScore(state: GameState, kingdom: Kingdom): number {
  const general = state.pieces.find((piece) => {
    return piece.kingdom === kingdom && piece.type === "general" && piece.blocksMovement;
  });

  if (!general) {
    return -80_000;
  }

  let score = 0;
  const ownPieces = state.pieces.filter((piece) => piece.controller === kingdom && piece.blocksMovement);
  const opponentPieces = state.pieces.filter((piece) => piece.controller !== kingdom && piece.blocksMovement);
  const palaceRows = kingdomRows[kingdom] as readonly string[];
  const palaceGuardRows = palaceRows.slice(2);

  if (state.checkedKingdoms.includes(kingdom)) {
    score -= 28_000;
  }

  const directAttackers = opponentPieces.filter((piece) => getLegalMoves(state, piece).includes(general.position));
  score -= directAttackers.length * 18_000;

  const palacePressure = opponentPieces.reduce((total, piece) => {
    return (
      total +
      getLegalMoves(state, piece).filter((target) => {
        const { row, col } = parsePointId(target);

        return palaceGuardRows.includes(row) && col >= 4 && col <= 6;
      }).length
    );
  }, 0);
  score -= palacePressure * 1_050;

  const defenders = ownPieces.filter((piece) => {
    if (piece.type !== "advisor" && piece.type !== "elephant") {
      return false;
    }

    const { row, col } = parsePointId(piece.position);

    return palaceRows.includes(row) && col >= 3 && col <= 7;
  });
  score += defenders.length * 950;

  const generalHome = `${palaceRows[palaceRows.length - 1]}5`;

  if (general.position === generalHome) {
    score += 1_200;
  } else {
    score -= 1_800;
  }

  return score;
}

function threePlayerBalanceScore(material: Record<Kingdom, number>, aiKingdom: Kingdom): number {
  const opponents = (Object.keys(material) as Kingdom[]).filter((kingdom) => kingdom !== aiKingdom);
  const [stronger, weaker] = opponents.sort((left, right) => material[right] - material[left]);
  const gap = material[stronger] - material[weaker];

  return gap > 900 ? -Math.min(2_400, gap * 0.3) : 350;
}

function strongestOpponent(material: Record<Kingdom, number>, aiKingdom: Kingdom): Kingdom {
  return (Object.keys(material) as Kingdom[])
    .filter((kingdom) => kingdom !== aiKingdom)
    .sort((left, right) => material[right] - material[left])[0];
}

function targetPressureScore(state: GameState, target: PointId, kingdom: Kingdom): number {
  const targetRow = parsePointId(target).row;
  const targetKingdom = (Object.keys(kingdomRows) as Kingdom[]).find((item) => {
    return (kingdomRows[item] as readonly string[]).includes(targetRow);
  });

  if (!targetKingdom || targetKingdom === kingdom) {
    return 0;
  }

  const material = materialByController(state);
  const strongest = strongestOpponent(material, kingdom);

  return targetKingdom === strongest ? 85 : 35;
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
