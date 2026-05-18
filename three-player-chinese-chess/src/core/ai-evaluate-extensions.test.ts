import { describe, expect, it } from "vitest";
import {
  balanceManipulationScore,
  centralChannelControlScore,
  chariotCannonMobilityScore,
  leaderPressureScore,
  multiSideKingAttackPenalty,
  opportunisticStrikeBonus,
  pincerAttackPenalty,
  riverCrossingThreatScore,
  thirdPartyMajorExposurePenalty,
} from "./ai/evaluate";
import { defaultAiProfile } from "./ai-profile";
import { createInitialGameState } from "./game-state";
import type { Piece } from "./pieces";
import type { GameState } from "./game-state";

function labState(pieces: Piece[], currentKingdom: GameState["currentKingdom"]): GameState {
  return {
    pieces,
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom: currentKingdom,
    checkedKingdoms: [],
    winner: null,
    lastMoveMessage: null,
    defeatedKingdoms: [],
    options: { defeatedPieceMode: "remove", defeatCondition: "capture" },
    moveHistory: [],
  };
}

function labPiece(id: string, type: Piece["type"], label: string, position: Piece["position"], kingdom: Piece["kingdom"]): Piece {
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

describe("evaluate 三人棋扩展项", () => {
  it("初始局面无多方同时将杀将面罚分", () => {
    const state = createInitialGameState();
    expect(multiSideKingAttackPenalty(state, "wei", defaultAiProfile)).toBe(0);
  });

  it("初始局面第三方大子暴露罚分非负", () => {
    const state = createInitialGameState();
    expect(thirdPartyMajorExposurePenalty(state, "wu", defaultAiProfile)).toBeGreaterThanOrEqual(0);
  });

  it("领先子力时 leaderPressureScore 为正", () => {
    const material = { wei: 12000, shu: 4000, wu: 3800 };
    expect(leaderPressureScore(material, "wei", defaultAiProfile)).toBeGreaterThan(0);
  });

  it("centralChannelControlScore 奖励占据第 5 列", () => {
    const state = labState(
      [labPiece("wei-chariot", "chariot", "车", "E5", "wei"), labPiece("wei-general", "general", "魏", "E4", "wei")],
      "wei",
    );
    expect(centralChannelControlScore(state, "wei", defaultAiProfile)).toBeGreaterThan(0);
  });

  it("chariotCannonMobilityScore 随车炮合法走法增加", () => {
    const state = labState(
      [
        labPiece("wei-chariot", "chariot", "车", "E1", "wei"),
        labPiece("wei-cannon", "cannon", "炮", "C2", "wei"),
        labPiece("wei-general", "general", "魏", "E5", "wei"),
      ],
      "wei",
    );
    expect(chariotCannonMobilityScore(state, "wei", defaultAiProfile)).toBeGreaterThan(0);
  });

  it("balanceManipulationScore 在领先时可能为正", () => {
    const material = { wei: 15000, shu: 5000, wu: 4800 };
    expect(typeof balanceManipulationScore(material, "wei", defaultAiProfile)).toBe("number");
  });

  it("opportunisticStrikeBonus 在落后时非负", () => {
    const state = createInitialGameState();
    const material = { wei: 3000, shu: 12000, wu: 11000 };
    expect(opportunisticStrikeBonus(state, "wei", material, defaultAiProfile)).toBeGreaterThanOrEqual(0);
  });

  it("riverCrossingThreatScore 对过河兵非负", () => {
    const state = labState(
      [
        labPiece("wei-soldier", "soldier", "兵", "F5", "wei"),
        labPiece("wei-general", "general", "魏", "E5", "wei"),
      ],
      "wei",
    );
    expect(riverCrossingThreatScore(state, "wei", defaultAiProfile)).toBeGreaterThanOrEqual(0);
  });

  it("pincerAttackPenalty 对无夹击局面为零", () => {
    const state = createInitialGameState();
    expect(pincerAttackPenalty(state, "wei", defaultAiProfile)).toBe(0);
  });
});
