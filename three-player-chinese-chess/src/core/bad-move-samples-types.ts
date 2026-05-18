import type { Kingdom, PointId } from "./board";
import type { GameState } from "./game-state";

export type BadMoveCategory =
  | "greedy_capture_trap"
  | "ignore_king_safety"
  | "expose_to_third_player"
  | "meaningless_retreat"
  | "miss_forced_win"
  | "miss_urgent_defense"
  | "over_defensive"
  | "leader_overexposure";

export type BadMoveSeverity = "low" | "medium" | "high";

export interface BadMoveSample {
  id: string;
  title: string;
  position: GameState;
  sideToMove: Kingdom;
  actualMove: { pieceId: string; target: PointId };
  expectedMove?: { pieceId: string; target: PointId };
  expectedAny?: Array<{ pieceId: string; target: PointId }>;
  mustNotMatch?: { pieceId: string; target: PointId };
  reason: string;
  category: BadMoveCategory;
  severity: BadMoveSeverity;
  suspectedCause?: "search" | "evaluation" | "opponent_model" | "move_ordering";
  tags?: string[];
  createdAt?: string;
}
