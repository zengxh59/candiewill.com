import type { Kingdom, PointId } from "./board";
import type { GameState } from "./game-state";
import { aiScenarios, type AiScenario } from "./ai-scenarios";
import type { BadMoveCategory, BadMoveSample, BadMoveSeverity } from "./bad-move-samples-types";

export type { BadMoveCategory, BadMoveSeverity, BadMoveSample } from "./bad-move-samples-types";

export const badMoveSamples: BadMoveSample[] = [];

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

const CATEGORY_BY_SCENARIO_ID: Partial<Record<string, BadMoveCategory>> = {
  "avoid-elimination-of-weakest": "leader_overexposure",
  "deeper-tactics-avoid-threefold": "meaningless_retreat",
  "ignore-defeated-blocker-general": "expose_to_third_player",
  "third-party-exposure-risk": "expose_to_third_player",
  "endgame-soldier-push": "over_defensive",
  "endgame-horse-more-valuable": "over_defensive",
  "deeper-tactics-chariot-fork": "greedy_capture_trap",
  "no-greedy-capture-into-fork": "greedy_capture_trap",
  "quiescence-greedy-recapture": "greedy_capture_trap",
  "avoid-opening-cannon-trade": "greedy_capture_trap",
  "opening-search-avoids-blunder": "greedy_capture_trap",
  "resolve-check-before-greedy-capture": "miss_urgent_defense",
  "miss-urgent-defense-chariot": "miss_urgent_defense",
  "capture-attacker-on-major-piece": "miss_urgent_defense",
  "endgame-answer-major-threat": "miss_urgent_defense",
  "hanging-piece-addressed-by-search": "miss_urgent_defense",
  "capture-general": "miss_forced_win",
  "endgame-kill-general": "miss_forced_win",
  "deeper-tactics-discovered-check": "miss_forced_win",
};

function categoryForScenario(scenario: AiScenario): BadMoveCategory {
  const mapped = CATEGORY_BY_SCENARIO_ID[scenario.id];
  if (mapped) {
    return mapped;
  }

  if (scenario.id.includes("third-party") || scenario.id.includes("exposure")) {
    return "expose_to_third_player";
  }

  if (scenario.id.includes("threefold") || scenario.id.includes("retreat")) {
    return "meaningless_retreat";
  }

  if (scenario.id.includes("elimination") || scenario.id.includes("balance")) {
    return "leader_overexposure";
  }

  if (scenario.id.includes("over-defensive")) {
    return "over_defensive";
  }

  if (scenario.mustCaptureIfProfitable || scenario.id.includes("capture-general") || scenario.id.includes("kill-general")) {
    return "miss_forced_win";
  }

  if (scenario.mustResolveCheck || scenario.mustAddressThreatenedPiece) {
    return "miss_urgent_defense";
  }

  if (scenario.id.includes("quiescence") || scenario.id.includes("greedy") || scenario.id.includes("fork")) {
    return "greedy_capture_trap";
  }

  if (scenario.id.includes("opening") && scenario.avoid) {
    return "greedy_capture_trap";
  }

  if (scenario.avoid && scenario.id.includes("blocker")) {
    return "expose_to_third_player";
  }

  return "ignore_king_safety";
}

function severityForCategory(category: BadMoveCategory): BadMoveSeverity {
  if (category === "miss_forced_win" || category === "miss_urgent_defense") {
    return "high";
  }

  if (category === "greedy_capture_trap" || category === "expose_to_third_player") {
    return "medium";
  }

  return "low";
}

function registerFromScenario(scenario: AiScenario): void {
  const category = categoryForScenario(scenario);
  const sample: BadMoveSample = {
    id: `bad_from_${scenario.id}`,
    title: scenario.title,
    position: cloneGameState(scenario.state),
    sideToMove: scenario.kingdom,
    actualMove: scenario.avoid ?? scenario.expected ?? { pieceId: "", target: "A1" as PointId },
    reason: `从 ai-scenarios 归档：${scenario.title}`,
    category,
    severity: severityForCategory(category),
    suspectedCause: category === "miss_forced_win" ? "search" : "evaluation",
    tags: ["from-scenario", scenario.id],
    createdAt: "2026-05-16",
  };

  if (scenario.expected) {
    sample.expectedMove = scenario.expected;
  }

  if (scenario.expectedAny?.length) {
    sample.expectedAny = scenario.expectedAny;
  }

  if (scenario.avoid) {
    sample.mustNotMatch = scenario.avoid;
    sample.actualMove = scenario.avoid;
  }

  badMoveSamples.push(sample);
}

function registerScenarioBadMoves(): void {
  const seen = new Set<string>();

  for (const scenario of aiScenarios) {
    if (seen.has(scenario.id)) {
      continue;
    }

    seen.add(scenario.id);

    if (
      scenario.expected ||
      scenario.avoid ||
      scenario.expectedAny ||
      scenario.mustCaptureIfProfitable ||
      scenario.mustAddressThreatenedPiece ||
      scenario.mustResolveCheck
    ) {
      registerFromScenario(scenario);
    }
  }
}

registerScenarioBadMoves();

/** 补充仅用于分类覆盖、无固定 avoid/expected 的诊断局面（不参与 mustNot 回归） */
function registerArchiveOnlySamples(): void {
  const archiveOnly: Array<{ scenarioId: string; category: BadMoveCategory }> = [
    { scenarioId: "avoid-elimination-of-weakest", category: "leader_overexposure" },
    { scenarioId: "deeper-tactics-avoid-threefold", category: "meaningless_retreat" },
    { scenarioId: "endgame-horse-more-valuable", category: "over_defensive" },
  ];

  for (const entry of archiveOnly) {
    const scenario = aiScenarios.find((item) => item.id === entry.scenarioId);

    if (!scenario || badMoveSamples.some((sample) => sample.id === `bad_from_${entry.scenarioId}`)) {
      continue;
    }

    badMoveSamples.push({
      id: `bad_from_${entry.scenarioId}`,
      title: scenario.title,
      position: cloneGameState(scenario.state),
      sideToMove: scenario.kingdom,
      actualMove: { pieceId: "archive", target: "A1" },
      reason: `归档样本（${entry.category}），供坏棋库分类统计`,
      category: entry.category,
      severity: "low",
      tags: ["archive-only", entry.scenarioId],
      createdAt: "2026-05-16",
    });
  }
}

registerArchiveOnlySamples();

export function findBadMoveSample(id: string): BadMoveSample | undefined {
  return badMoveSamples.find((sample) => sample.id === id);
}

export function badMoveSamplesByCategory(category: BadMoveCategory): BadMoveSample[] {
  return badMoveSamples.filter((sample) => sample.category === category);
}

export function serializeBadMoveSample(sample: BadMoveSample): Record<string, unknown> {
  return {
    id: sample.id,
    title: sample.title,
    sideToMove: sample.sideToMove,
    actualMove: sample.actualMove,
    expectedMove: sample.expectedMove,
    expectedAny: sample.expectedAny,
    mustNotMatch: sample.mustNotMatch,
    reason: sample.reason,
    category: sample.category,
    severity: sample.severity,
    suspectedCause: sample.suspectedCause,
    tags: sample.tags,
    createdAt: sample.createdAt,
    position: {
      currentKingdom: sample.position.currentKingdom,
      defeatedKingdoms: sample.position.defeatedKingdoms,
      pieces: sample.position.pieces.map((piece) => ({
        id: piece.id,
        type: piece.type,
        label: piece.label,
        position: piece.position,
        kingdom: piece.kingdom,
        controller: piece.controller,
        defeated: piece.defeated,
        blocksMovement: piece.blocksMovement,
      })),
    },
  };
}
