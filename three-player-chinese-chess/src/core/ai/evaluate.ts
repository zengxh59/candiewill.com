import type { Kingdom, PointId } from "../board";
import { kingdomOf, kingdomRows, parsePointId } from "../board";
import { capturedPieceAt, type GameState } from "../game-state";
import { getPseudoLegalMoves } from "../moves";
import type { AiProfile, AiStyleProfile, GamePhase } from "../ai-profile";
import type { Piece } from "../pieces";

import { isPointControlledByOpponent, attackersOf, defendersOf, cheapestPieceValue, generalFor, isInsideOwnPalace, hangingPieceMargin, pieceAttacksSquare } from "./tactical";
import { pieceSquareBonus } from "./pst";

const winScore = 1_000_000;

export function evaluateState(state: GameState, aiKingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): number {
  if (state.winner === aiKingdom) {
    return winScore;
  }

  if (state.winner) {
    return -winScore;
  }

  if (state.defeatedKingdoms.includes(aiKingdom)) {
    return -winScore / 2;
  }

  const phase = gamePhaseFor(state);
  const material = materialByController(state, profile, phase);
  const opponentScores = (Object.keys(material) as Kingdom[]).filter((kingdom) => kingdom !== aiKingdom).map((kingdom) => material[kingdom]);
  let score = material[aiKingdom] - Math.max(...opponentScores) * 0.9 - Math.min(...opponentScores) * 0.45;

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    const value = pieceValue(piece, profile, phase);

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
  score += pieceSafetyScore(state, aiKingdom, profile, style);
  score += threePlayerBalanceScore(material, aiKingdom, profile) * style.balanceMultiplier;
  score += pieceCoordinationScore(state, aiKingdom, profile) * style.attackMultiplier;
  score += centerControlScore(state, aiKingdom, profile) * style.mobilityMultiplier;
  score += allianceAwareScore(state, aiKingdom, material, profile, style);
  score += endgameGoalScore(state, aiKingdom, material, profile, style);
  score -= positionRepetitionScore(state, aiKingdom);

  return score;
}

export function pieceValue(piece: Piece, profile: AiProfile, phase?: GamePhase): number {
  const base = profile.pieceValues[piece.type];
  const phaseOverride = phase && profile.phasePieceValues?.[phase]?.[piece.type];
  const value = phaseOverride ?? base;
  const soldierBonus = piece.type === "soldier" ? soldierAdvance(piece) * 25 : 0;
  const crossedBonus = piece.type === "soldier" && hasCrossedBorder(piece)
    ? soldierAdvance(piece) * 25 * (profile.scoring.crossedSoldierMultiplier - 1)
    : 0;
  return value + soldierBonus + crossedBonus;
}

export function isNeutralBlocker(piece: Piece): boolean {
  return piece.defeated && piece.controller === piece.kingdom;
}

export function soldierAdvance(piece: Piece): number {
  const rows = kingdomRows[piece.kingdom];
  const row = parsePointId(piece.position).row;
  const index = rows.indexOf(row as never);

  return index >= 0 ? rows.length - 1 - index : rows.length;
}

export function hasCrossedBorder(piece: Piece): boolean {
  return !isOwnKingdomPoint(piece.kingdom, piece.position);
}

export function gamePhaseFor(state: GameState): GamePhase {
  const activePieces = state.pieces.filter((piece) => piece.blocksMovement && !isNeutralBlocker(piece));
  const activeMajorPieces = activePieces.filter((piece) => piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse");
  const activeKingdoms = (Object.keys(kingdomRows) as Kingdom[]).filter((kingdom) => !state.defeatedKingdoms.includes(kingdom));

  if (state.defeatedKingdoms.length > 0 || activeKingdoms.length <= 2 || activePieces.length <= 24 || activeMajorPieces.length <= 9) {
    return "endgame";
  }

  if (activePieces.length >= 42) {
    return "opening";
  }

  return "middlegame";
}

export function isOpeningPhase(state: GameState): boolean {
  return gamePhaseFor(state) === "opening";
}

export function isOriginalBackRank(piece: Piece): boolean {
  const rows = kingdomRows[piece.kingdom];

  return piece.position[0] === rows[rows.length - 1];
}

export function isOwnKingdomPoint(kingdom: Kingdom, point: PointId): boolean {
  return (kingdomRows[kingdom] as readonly string[]).includes(parsePointId(point).row);
}

function activityBonus(state: GameState, piece: Piece, profile: AiProfile): number {
  if (piece.type === "soldier") {
    return soldierAdvance(piece) * profile.scoring.soldierAdvanceEval;
  }

  if (piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse") {
    const isEndgame = gamePhaseFor(state) === "endgame";
    // PST acts as a fast proxy for mobility: well-placed pieces have higher activity
    let bonus = pieceSquareBonus(piece.type, piece.position, piece.kingdom, isEndgame);

    if (kingdomOf(piece.position) !== piece.kingdom) {
      bonus += profile.pieceValues.soldier * 0.4;
    }

    return bonus;
  }

  return 0;
}

function formationBonus(state: GameState, piece: Piece, profile: AiProfile): number {
  const opening = isOpeningPhase(state);
  const isEndgame = gamePhaseFor(state) === "endgame";

  if (opening && piece.type === "cannon" && !isOwnKingdomPoint(piece.kingdom, piece.position)) {
    return profile.scoring.openingCannonOutPenalty;
  }

  if (opening && (piece.type === "horse" || piece.type === "chariot") && !isOriginalBackRank(piece)) {
    return profile.scoring.openingMajorDeveloped;
  }

  if (piece.type === "advisor" || piece.type === "elephant") {
    const pstValue = pieceSquareBonus(piece.type, piece.position, piece.kingdom, isEndgame);
    const isHome = isOwnKingdomPoint(piece.kingdom, piece.position);

    return isHome ? profile.scoring.advisorElephantHome + pstValue : profile.scoring.advisorElephantAwayPenalty + pstValue;
  }

  return 0;
}

export function materialByController(state: GameState, profile: AiProfile, phase?: GamePhase): Record<Kingdom, number> {
  const material: Record<Kingdom, number> = {
    wei: 0,
    shu: 0,
    wu: 0,
  };

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    material[piece.controller] += pieceValue(piece, profile, phase);
  }

  return material;
}

export function developmentScore(state: GameState, action: { pieceId: string; target: PointId }, piece: Piece, profile: AiProfile): number {
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

export function repetitiveQuietMovePenalty(state: GameState, action: { pieceId: string; from: PointId; target: PointId }, movingPiece: Piece, capturedPiece: Piece | null): number {
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

export function kingSafetyScore(state: GameState, kingdom: Kingdom, profile: AiProfile): number {
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

  const directAttackers = opponentPieces.filter((piece) => pieceAttacksSquare(state, piece, general.position));
  score -= directAttackers.length * profile.scoring.directAttackerPenalty;

  const palacePressure = opponentPieces.reduce((total, piece) => {
    return (
      total +
      getPseudoLegalMoves(state, piece).filter((target) => {
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

function pieceSafetyScore(state: GameState, aiKingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): number {
  let score = 0;
  const phase = gamePhaseFor(state);

  for (const piece of state.pieces) {
    if (!piece.blocksMovement || isNeutralBlocker(piece)) {
      continue;
    }

    const attackers = attackersOf(state, piece.position, piece.controller);

    if (!attackers.length) {
      continue;
    }

    const value = pieceValue(piece, profile);
    const defenders = defendersOf(state, piece.position, piece.controller, piece.id);
    const hanging = defenders.length === 0 || cheapestPieceValue(attackers, profile) < value - hangingPieceMargin;
    const pressure = (hanging ? value * 0.78 : value * 0.22) * (phase === "endgame" ? 1.45 : 1);

    if (piece.controller === aiKingdom) {
      score -= pressure / style.riskTolerance;
    } else {
      score += pressure * 0.36 * style.attackMultiplier;
    }
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

export function strongestOpponent(material: Record<Kingdom, number>, aiKingdom: Kingdom): Kingdom {
  return (Object.keys(material) as Kingdom[])
    .filter((kingdom) => kingdom !== aiKingdom)
    .sort((left, right) => material[right] - material[left])[0];
}

export function tacticalStabilityScore(state: GameState, aiKingdom: Kingdom, profile: AiProfile, style: AiStyleProfile): number {
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

function positionRepetitionScore(state: GameState, kingdom: Kingdom): number {
  const ownHistory = (state.moveHistory ?? []).filter((move) => move.kingdom === kingdom).slice(-10);

  if (ownHistory.length < 4) {
    return 0;
  }

  let penalty = 0;

  for (let index = 1; index < ownHistory.length; index += 1) {
    const previous = ownHistory[index - 1];
    const current = ownHistory[index];

    if (previous.pieceId === current.pieceId && previous.from === current.target && previous.target === current.from) {
      penalty += 420;
    }
  }

  return penalty;
}

function endgameGoalScore(
  state: GameState,
  aiKingdom: Kingdom,
  material: Record<Kingdom, number>,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  if (gamePhaseFor(state) !== "endgame") {
    return 0;
  }

  const ownGeneral = generalFor(state, aiKingdom);
  const opponents = (Object.keys(kingdomRows) as Kingdom[]).filter((kingdom) => kingdom !== aiKingdom && !state.defeatedKingdoms.includes(kingdom));
  const strongest = opponents.sort((left, right) => material[right] - material[left])[0];
  const materialLead = material[aiKingdom] - Math.max(0, ...opponents.map((kingdom) => material[kingdom]));
  let score = materialLead * 0.18;

  if (ownGeneral) {
    score += kingSafetyScore(state, aiKingdom, profile) * 0.18 * style.safetyMultiplier;
  }

  for (const opponent of opponents) {
    const general = generalFor(state, opponent);

    if (!general) {
      score += 18_000;
      continue;
    }

    const directAttackers = state.pieces.filter((piece) => {
      return piece.controller === aiKingdom && piece.blocksMovement && !isNeutralBlocker(piece) && pieceAttacksSquare(state, piece, general.position);
    });
    const pressureTargets = state.pieces.reduce((total, piece) => {
      return piece.controller === aiKingdom && piece.blocksMovement && !isNeutralBlocker(piece)
        ? total + getPseudoLegalMoves(state, piece).filter((target) => isInsideOwnPalace(opponent, target)).length
        : total;
    }, 0);

    score += directAttackers.length * 9_000 * style.attackMultiplier;
    score += pressureTargets * 520 * style.attackMultiplier;

    if (strongest === opponent) {
      score += pressureTargets * 260 * style.targetStrongestBonus;
    }
  }

  const ownSoldierPush = state.pieces
    .filter((piece) => piece.controller === aiKingdom && piece.type === "soldier" && piece.blocksMovement && !isNeutralBlocker(piece))
    .reduce((total, piece) => total + soldierAdvance(piece), 0);
  score += ownSoldierPush * 95;

  if (materialLead > 900) {
    score += simplifiedEndgameBonus(state, aiKingdom, profile) * 0.18;
  } else if (materialLead < -700) {
    score += state.checkedKingdoms.filter((kingdom) => kingdom !== aiKingdom).length * 4_800;
  }

  return score;
}

function simplifiedEndgameBonus(state: GameState, aiKingdom: Kingdom, profile: AiProfile): number {
  return state.pieces.reduce((total, piece) => {
    if (!piece.blocksMovement || isNeutralBlocker(piece) || piece.type === "general") {
      return total;
    }

    const value = pieceValue(piece, profile);

    return total + (piece.controller === aiKingdom ? value * 0.12 : -value * 0.28);
  }, 0);
}

function pieceCoordinationScore(state: GameState, aiKingdom: Kingdom, profile: AiProfile): number {
  const ownPieces = state.pieces.filter(
    (piece) => piece.controller === aiKingdom && piece.blocksMovement && !isNeutralBlocker(piece),
  );
  let score = 0;
  const bonus = profile.scoring.coordinationBonus;

  const chariots = ownPieces.filter((piece) => piece.type === "chariot");
  const cannons = ownPieces.filter((piece) => piece.type === "cannon");
  const horses = ownPieces.filter((piece) => piece.type === "horse");

  // Chariot-Cannon coordination: same file or rank → double attack pressure (coordinate check only)
  for (const chariot of chariots) {
    for (const cannon of cannons) {
      const chariotPos = parsePointId(chariot.position);
      const cannonPos = parsePointId(cannon.position);

      if (chariotPos.col === cannonPos.col) {
        const sameFile = areOnSameMovementLine(state, chariot.position, cannon.position);
        if (sameFile) {
          score += bonus * 1.2;
        }
      }

      if (chariotPos.row === cannonPos.row) {
        score += bonus * 0.8;
      }
    }
  }

  // Horse-Chariot coordination: estimate complementary control via PST proximity (no move gen)
  for (const chariot of chariots) {
    for (const horse of horses) {
      const horsePos = parsePointId(horse.position);
      const chariotPos = parsePointId(chariot.position);

      // Horses off the chariot's row and column provide complementary control
      const offLine = horsePos.row !== chariotPos.row && horsePos.col !== chariotPos.col;
      const dist = Math.abs(horsePos.col - chariotPos.col);

      if (offLine && dist <= 3) {
        score += bonus * 0.9;
      } else if (offLine) {
        score += bonus * 0.3;
      }
    }
  }

  // Cannon activity: count nearby enemy pieces as potential capture targets (no move gen)
  for (const cannon of cannons) {
    const cannonPos = parsePointId(cannon.position);
    let nearbyEnemies = 0;

    for (const piece of state.pieces) {
      if (piece.controller !== aiKingdom && piece.blocksMovement && !isNeutralBlocker(piece)) {
        const piecePos = parsePointId(piece.position);
        const rowDist = Math.abs(piecePos.row.charCodeAt(0) - cannonPos.row.charCodeAt(0));
        const colDist = Math.abs(piecePos.col - cannonPos.col);
        if (rowDist + colDist <= 5) {
          nearbyEnemies++;
        }
      }
    }

    if (nearbyEnemies >= 3) {
      score += bonus * 0.6;
    }
  }

  return score;
}

function areOnSameMovementLine(state: GameState, pointA: PointId, pointB: PointId): boolean {
  const posA = parsePointId(pointA);
  const posB = parsePointId(pointB);

  // Same column within same kingdom
  if (posA.col === posB.col) {
    const kingdomA = kingdomOf(pointA);
    const kingdomB = kingdomOf(pointB);

    if (kingdomA === kingdomB) {
      return true;
    }

    // Cross-kingdom same-file connection (columns 1-5 connect to 9-5 in adjacent kingdoms)
    const rowsA = kingdomRows[kingdomA] as readonly string[];
    const rowsB = kingdomRows[kingdomB] as readonly string[];
    const rowIndexA = rowsA.indexOf(posA.row);
    const rowIndexB = rowsB.indexOf(posB.row);

    // One piece at boundary edge, other at corresponding entry of adjacent kingdom
    if (rowIndexA === 0 && rowIndexB === rowsB.length - 1) {
      return true;
    }
    if (rowIndexA === rowsA.length - 1 && rowIndexB === 0) {
      return true;
    }
  }

  // Same row
  if (posA.row === posB.row) {
    return true;
  }

  return false;
}

function centerControlScore(state: GameState, aiKingdom: Kingdom, profile: AiProfile): number {
  const opponents = (Object.keys(kingdomRows) as Kingdom[]).filter(
    (kingdom) => kingdom !== aiKingdom && !state.defeatedKingdoms.includes(kingdom),
  );

  if (opponents.length === 0) {
    return 0;
  }

  let score = 0;
  const bonus = profile.scoring.centerControlBonus;
  const isEndgame = gamePhaseFor(state) === "endgame";

  const ownActivePieces = state.pieces.filter(
    (piece) => piece.controller === aiKingdom && piece.blocksMovement && !isNeutralBlocker(piece) &&
      (piece.type === "chariot" || piece.type === "cannon" || piece.type === "horse"),
  );

  for (const piece of ownActivePieces) {
    const pos = parsePointId(piece.position);
    const centerDist = Math.abs(pos.col - 5);

    // Center proximity bonus + PST positional quality
    if (centerDist <= 1) {
      score += bonus;
    } else if (centerDist <= 2) {
      score += bonus * 0.4;
    }
  }

  return score;
}

function allianceAwareScore(
  state: GameState,
  aiKingdom: Kingdom,
  material: Record<Kingdom, number>,
  profile: AiProfile,
  style: AiStyleProfile,
): number {
  const activeOpponents = (Object.keys(material) as Kingdom[]).filter(
    (kingdom) => kingdom !== aiKingdom && !state.defeatedKingdoms.includes(kingdom),
  );

  if (activeOpponents.length < 2) {
    return 0;
  }

  const aiMaterial = material[aiKingdom];
  const sorted = activeOpponents.sort((left, right) => material[right] - material[left]);
  const strongestMaterial = material[sorted[0]];
  const weakestMaterial = material[sorted[1]];
  let score = 0;

  // === Coalition Threat: AI is leading, opponents may gang up ===
  if (aiMaterial > strongestMaterial * 1.2) {
    const coalitionThreat = (strongestMaterial + weakestMaterial) * 0.35;
    score -= coalitionThreat * style.safetyMultiplier * 0.08;
    score -= profile.scoring.balanceGapPenaltyMax * 0.5;
  }

  // === Under Siege Detection: both opponents attacking AI territory ===
  const aiGeneral = generalFor(state, aiKingdom);
  if (aiGeneral) {
    const attackerCounts = activeOpponents.map((opponent) =>
      state.pieces.filter(
        (piece) =>
          piece.controller === opponent &&
          piece.blocksMovement &&
          !isNeutralBlocker(piece) &&
          pieceAttacksSquare(state, piece, aiGeneral.position),
      ).length,
    );

    const totalAttackers = attackerCounts.reduce((sum, count) => sum + count, 0);
    const bothAttacking = attackerCounts.every((count) => count >= 1);

    if (bothAttacking) {
      // Both opponents have pieces threatening AI general — severe danger
      score -= totalAttackers * 2200 * style.safetyMultiplier;
    } else if (totalAttackers >= 3) {
      // Heavy attack from one side
      score -= totalAttackers * 800 * style.safetyMultiplier;
    }

    // Detect coordinated pressure: opponents pieces near AI palace
    const aiRows = kingdomRows[aiKingdom] as readonly string[];
    const palaceRows = aiRows.slice(2);
    const opponentPressureInPalace = state.pieces.filter(
      (piece) =>
        piece.controller !== aiKingdom &&
        piece.blocksMovement &&
        !isNeutralBlocker(piece) &&
        palaceRows.some((row) => parsePointId(piece.position).row === row),
    );

    const uniqueAttackers = new Set(opponentPressureInPalace.map((p) => p.controller));
    if (uniqueAttackers.size >= 2) {
      score -= opponentPressureInPalace.length * 350 * style.safetyMultiplier;
    }
  }

  // === Elimination Risk: one opponent far stronger, weak about to die ===
  if (strongestMaterial > weakestMaterial * 1.5) {
    const eliminationRisk = (strongestMaterial - weakestMaterial) * 0.04;
    score -= eliminationRisk * style.balanceMultiplier;
  }

  // === Save the Weak: strongest opponent about to eliminate weakest ===
  const weakestGeneral = generalFor(state, sorted[1]);
  if (weakestGeneral) {
    const attackersOnWeakGeneral = state.pieces.filter(
      (piece) =>
        piece.controller === sorted[0] &&
        piece.blocksMovement &&
        !isNeutralBlocker(piece) &&
        pieceAttacksSquare(state, piece, weakestGeneral.position),
    );

    if (attackersOnWeakGeneral.length >= 2 && sorted[0] !== aiKingdom) {
      // Strongest opponent is about to eliminate weakest — bad for us
      score -= 1800 * style.safetyMultiplier;

      // Bonus for having pieces that can interfere to save the weak kingdom
      const ourDefendersNear = state.pieces.filter(
        (piece) =>
          piece.controller === aiKingdom &&
          piece.blocksMovement &&
          !isNeutralBlocker(piece) &&
          piece.type !== "general" &&
          (pieceAttacksSquare(state, piece, weakestGeneral.position) ||
            attackersOnWeakGeneral.some((a) => pieceAttacksSquare(state, piece, a.position))),
      );
      score += ourDefendersNear.length * 400 * style.attackMultiplier;
    }
  }

  // === Sit-and-Watch: opponents attacking each other, AI benefits ===
  const opponentGenerals = activeOpponents
    .map((kingdom) => ({ kingdom, general: generalFor(state, kingdom) }))
    .filter((entry) => entry.general !== null);

  for (const { kingdom: attackKingdom, general: targetGeneral } of opponentGenerals) {
    const otherOpponent = activeOpponents.find((kingdom) => kingdom !== attackKingdom);
    if (!otherOpponent) continue;

    const piecesAttacking = state.pieces.filter(
      (piece) =>
        piece.controller === otherOpponent &&
        piece.blocksMovement &&
        !isNeutralBlocker(piece) &&
        pieceAttacksSquare(state, piece, targetGeneral!.position),
    );

    if (piecesAttacking.length >= 2) {
      // Opponents are fighting each other — "坐山观虎斗" bonus
      score += piecesAttacking.length * 280 * style.balanceMultiplier;
    }
  }

  return score;
}
