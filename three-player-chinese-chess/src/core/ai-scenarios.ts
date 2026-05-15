import type { Kingdom, PointId } from "./board";
import type { GameState } from "./game-state";
import type { Piece } from "./pieces";

export interface AiScenario {
  id: string;
  title: string;
  kingdom: Kingdom;
  state: GameState;
  expected?: {
    pieceId: string;
    target: PointId;
  };
  expectedAny?: Array<{
    pieceId: string;
    target: PointId;
  }>;
  avoid?: {
    pieceId: string;
    target: PointId;
  };
  avoidAny?: Array<{
    pieceId: string;
    target: PointId;
  }>;
  mustCaptureIfProfitable?: boolean;
  mustAddressThreatenedPiece?: boolean;
  mustResolveCheck?: boolean;
  distinctFromBaselineStyle?: boolean;
}

export const aiScenarios: AiScenario[] = [
  {
    id: "capture-general",
    title: "能吃主公时优先吃主公",
    kingdom: "wu",
    expected: { pieceId: "wu-chariot", target: "A5" },
    state: stateWith(
      [
        piece("wu-chariot", "chariot", "车", "F5", "wu"),
        piece("wu-general", "general", "吴", "J4", "wu"),
        piece("wei-general", "general", "魏", "A5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "escape-check",
    title: "被将军时优先解除自家主公危险",
    kingdom: "wu",
    state: stateWith(
      [
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-chariot", "chariot", "车", "F4", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "avoid-opening-cannon-trade",
    title: "开局避免炮换马后落点被反吃",
    kingdom: "wu",
    avoid: { pieceId: "wu-cannon", target: "F3" },
    state: stateWith(
      [
        piece("wu-cannon", "cannon", "炮", "F1", "wu"),
        piece("wu-screen", "soldier", "卒", "F2", "wu"),
        piece("wu-horse", "horse", "马", "J2", "wu"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-horse", "horse", "马", "F3", "wei"),
        piece("wei-chariot", "chariot", "车", "F4", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "general-captures-intruder",
    title: "主公安全吃掉本宫入侵子",
    kingdom: "wu",
    expected: { pieceId: "wu-general", target: "J4" },
    state: stateWith(
      [
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-cannon", "cannon", "炮", "J4", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "ignore-defeated-blocker-general",
    title: "障碍模式下不把出局主公当作优先吃子目标",
    kingdom: "wu",
    avoid: { pieceId: "wu-chariot", target: "A5" },
    state: stateWith(
      [
        piece("wu-chariot", "chariot", "车", "F5", "wu"),
        piece("wu-general", "general", "吴", "J4", "wu"),
        { ...piece("wei-general", "general", "魏", "A5", "wei"), defeated: true },
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "take-free-horse",
    title: "有白吃马的机会时不应错过",
    kingdom: "wu",
    expected: { pieceId: "wu-chariot", target: "F6" },
    mustCaptureIfProfitable: true,
    state: stateWith(
      [
        piece("wu-chariot", "chariot", "车", "F5", "wu"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-horse", "horse", "马", "F6", "wei"),
        piece("wei-general", "general", "魏", "E4", "wei"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "cannon-takes-unprotected-horse",
    title: "主公可安全吃掉近宫威胁时应主动吃",
    kingdom: "wu",
    expected: { pieceId: "wu-general", target: "J4" },
    mustCaptureIfProfitable: true,
    state: stateWith(
      [
        piece("wu-cannon", "cannon", "炮", "F1", "wu"),
        piece("wu-screen", "soldier", "卒", "F2", "wu"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-horse", "horse", "马", "J4", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "capture-attacker-on-major-piece",
    title: "大子被攻击时优先反吃攻击子",
    kingdom: "wu",
    expected: { pieceId: "wu-chariot", target: "F6" },
    mustAddressThreatenedPiece: true,
    state: stateWith(
      [
        piece("wu-chariot", "chariot", "车", "F5", "wu"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wei-chariot", "chariot", "车", "F6", "wei"),
        piece("wei-general", "general", "魏", "E4", "wei"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "resolve-check-before-greedy-capture",
    title: "被将军时先处理主公安全",
    kingdom: "wu",
    avoid: { pieceId: "wu-chariot", target: "F3" },
    mustResolveCheck: true,
    state: stateWith(
      [
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wu-chariot", "chariot", "车", "F5", "wu"),
        piece("wei-chariot", "chariot", "车", "F4", "wei"),
        piece("wei-horse", "horse", "马", "F3", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wu",
      ["wu"],
    ),
  },
  {
    id: "endgame-kill-general",
    title: "残局有机会吃主公时应立即收束",
    kingdom: "wei",
    expected: { pieceId: "wei-chariot", target: "F5" },
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-chariot", "chariot", "车", "A5", "wei"),
        piece("wu-general", "general", "吴", "F5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wei",
    ),
  },
  {
    id: "endgame-answer-major-threat",
    title: "残局大子被攻击时仍要优先处理",
    kingdom: "wu",
    expected: { pieceId: "wu-chariot", target: "F6" },
    mustAddressThreatenedPiece: true,
    state: stateWith(
      [
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wu-chariot", "chariot", "车", "F5", "wu"),
        piece("wei-chariot", "chariot", "车", "F6", "wei"),
        piece("wei-general", "general", "魏", "E4", "wei"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "endgame-soldier-push",
    title: "残局兵卒应向敌方主公推进而不是闲走",
    kingdom: "wei",
    expectedAny: [
      { pieceId: "wei-soldier", target: "G5" },
      { pieceId: "wei-soldier", target: "F6" },
    ],
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-soldier", "soldier", "兵", "F5", "wei"),
        piece("wei-chariot", "chariot", "车", "A5", "wei"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wei",
    ),
  },
  {
    id: "endgame-chariot-cannon-coordination",
    title: "残局车炮配合应向弱势方主公施压",
    kingdom: "wei",
    mustCaptureIfProfitable: true,
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-chariot", "chariot", "车", "H5", "wei"),
        piece("wei-cannon", "cannon", "炮", "H2", "wei"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wei",
    ),
  },
  {
    id: "avoid-elimination-of-weakest",
    title: "当一个对手即将被另一对手吃掉主公时不应忽视",
    kingdom: "wu",
    state: stateWith(
      [
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wu-chariot", "chariot", "车", "F5", "wu"),
        piece("wei-chariot", "chariot", "车", "N4", "wei"),
        piece("wei-horse", "horse", "马", "N6", "wei"),
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
        piece("shu-soldier", "soldier", "兵", "O3", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "endgame-horse-more-valuable",
    title: "残局马价值高于炮，应用马逼近敌方主公",
    kingdom: "wu",
    state: stateWith(
      [
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wu-horse", "horse", "马", "F6", "wu"),
        piece("wu-cannon", "cannon", "炮", "G2", "wu"),
        piece("wei-general", "general", "魏", "E4", "wei"),
        piece("wei-soldier", "soldier", "兵", "D5", "wei"),
        piece("shu-general", "general", "蜀", "O4", "shu"),
      ],
      "wu",
    ),
  },
  {
    id: "deeper-tactics-chariot-fork",
    title: "深度搜索：车应发现抽子机会（同时威胁两个目标）",
    kingdom: "wei",
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-chariot", "chariot", "车", "A5", "wei"),
        piece("wu-horse", "horse", "马", "F3", "wu"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("shu-cannon", "cannon", "炮", "K3", "shu"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wei",
    ),
  },
  {
    id: "deeper-tactics-discovered-check",
    title: "深度搜索：应发现闪将机会",
    kingdom: "wei",
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-cannon", "cannon", "炮", "B5", "wei"),
        piece("wei-horse", "horse", "马", "C3", "wei"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wei",
    ),
  },
  {
    id: "deeper-tactics-avoid-threefold",
    title: "深度搜索：应避免重复走法导致局面无进展",
    kingdom: "wu",
    // The chariot at F4 has been going back and forth to F5.
    // With deep search the AI should find a more useful move,
    // but the avoidAny was too strict for an open position.
    // Keep this as a non-strict scenario for manual review.
    state: {
      ...stateWith(
        [
          piece("wu-general", "general", "吴", "J5", "wu"),
          piece("wu-chariot", "chariot", "车", "F4", "wu"),
          piece("wei-general", "general", "魏", "E5", "wei"),
          piece("shu-general", "general", "蜀", "O4", "shu"),
        ],
        "wu",
      ),
      moveHistory: [
        { pieceId: "wu-chariot", kingdom: "wu", from: "F5", target: "F4", capturedPieceId: null },
        { pieceId: "shu-general", kingdom: "shu", from: "O5", target: "O4", capturedPieceId: null },
        { pieceId: "wei-general", kingdom: "wei", from: "E4", target: "E5", capturedPieceId: null },
        { pieceId: "wu-chariot", kingdom: "wu", from: "F4", target: "F5", capturedPieceId: null },
        { pieceId: "shu-general", kingdom: "shu", from: "O4", target: "O5", capturedPieceId: null },
        { pieceId: "wei-general", kingdom: "wei", from: "E5", target: "E4", capturedPieceId: null },
        { pieceId: "wu-chariot", kingdom: "wu", from: "F5", target: "F4", capturedPieceId: null },
      ],
    },
  },
  // ── Regression scenarios for removed greedy shortcuts ────────────────────────
  {
    id: "no-greedy-capture-into-fork",
    title: "不能贪吃落入叉击：车吃马后被第三家抽将",
    // Wei chariot can take shu's horse at K3, but after that wu's cannon at F3 forks
    // wei-general (E5) and wei-chariot (K3). The correct play is NOT to take the horse.
    kingdom: "wei",
    avoid: { pieceId: "wei-chariot", target: "K3" },
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-chariot", "chariot", "车", "E3", "wei"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wu-cannon", "cannon", "炮", "F3", "wu"),
        piece("wu-screen", "soldier", "卒", "H3", "wu"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
        piece("shu-horse", "horse", "马", "K3", "shu"),
      ],
      "wei",
    ),
  },
  {
    id: "search-finds-profitable-capture-anyway",
    title: "搜索仍能发现明显有利吃子（移除快捷路径后不回归）",
    // Wei chariot can take shu soldier at K5 cleanly — the search should still pick this up.
    kingdom: "wei",
    mustCaptureIfProfitable: true,
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-chariot", "chariot", "车", "E1", "wei"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
        piece("shu-soldier", "soldier", "兵", "K5", "shu"),
      ],
      "wei",
    ),
  },
  {
    id: "hanging-piece-addressed-by-search",
    title: "搜索能发现己方挂子并撤退救棋（移除快捷路径后不回归）",
    // Wei horse at C4 is attacked by wu's chariot at F4 with no defender.
    // The AI should move the horse away (mustAddressThreatenedPiece).
    kingdom: "wei",
    mustAddressThreatenedPiece: true,
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-horse", "horse", "马", "C4", "wei"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wu-chariot", "chariot", "车", "F4", "wu"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wei",
    ),
  },
  {
    id: "opening-search-avoids-blunder",
    title: "开局搜索 3 层：避免发展出明显坏棋（炮落在被反吃的空格）",
    // Wei cannon at C2 should not move to F2 where it is immediately captured by wu-chariot at F9.
    kingdom: "wei",
    avoid: { pieceId: "wei-cannon", target: "F2" },
    state: stateWith(
      [
        piece("wei-general", "general", "魏", "E5", "wei"),
        piece("wei-cannon", "cannon", "炮", "C2", "wei"),
        piece("wei-soldier", "soldier", "兵", "B5", "wei"),
        piece("wu-general", "general", "吴", "J5", "wu"),
        piece("wu-chariot", "chariot", "车", "F9", "wu"),
        piece("shu-general", "general", "蜀", "O5", "shu"),
      ],
      "wei",
    ),
  },
];

function stateWith(pieces: Piece[], currentKingdom: GameState["currentKingdom"], checkedKingdoms: GameState["checkedKingdoms"] = []): GameState {
  return {
    pieces,
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom,
    checkedKingdoms,
    winner: null,
    lastMoveMessage: null,
    defeatedKingdoms: [],
    options: { defeatedPieceMode: "remove", defeatCondition: "capture" },
  };
}

function piece(
  id: string,
  type: Piece["type"],
  label: string,
  position: Piece["position"],
  kingdom: Piece["kingdom"],
): Piece {
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
