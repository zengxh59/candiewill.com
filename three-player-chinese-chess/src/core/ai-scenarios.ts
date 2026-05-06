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
  avoid?: {
    pieceId: string;
    target: PointId;
  };
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
        piece("shu-general", "general", "蜀", "O5", "shu"),
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
];

function stateWith(pieces: Piece[], currentKingdom: GameState["currentKingdom"]): GameState {
  return {
    pieces,
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom,
    checkedKingdoms: [],
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
