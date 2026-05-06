import type { PieceType } from "./pieces";

export interface AiProfile {
  searchDepth: number;
  rootBeam: number;
  responseBeam: number;
  thirdPlayerBeam: number;
  safetyScanLimit: number;
  pieceValues: Record<PieceType, number>;
  scoring: {
    rootActionWeight: number;
    generalCaptureBonus: number;
    capturedValueMultiplier: number;
    tradeDeltaMultiplier: number;
    generalQuietMovePenalty: number;
    soldierAdvanceAction: number;
    activePieceAction: number;
    developmentMajor: number;
    developmentCannon: number;
    developmentSoldier: number;
    badTradeMultiplier: number;
    exposedTradeMultiplier: number;
    openingRaidPenalty: number;
    kingDefensePalaceCapture: number;
    kingDefenseAttackerCapture: number;
    kingDefensePowerPieceCapture: number;
    defeatedSelfPenalty: number;
    defeatedOpponentReward: number;
    checkedSelfPenalty: number;
    checkedOpponentReward: number;
    soldierAdvanceEval: number;
    mobilityEval: number;
    openingCannonOutPenalty: number;
    openingMajorDeveloped: number;
    advisorElephantHome: number;
    advisorElephantAwayPenalty: number;
    directCheckPenalty: number;
    directAttackerPenalty: number;
    palacePressurePenalty: number;
    defenderBonus: number;
    generalHomeBonus: number;
    generalAwayPenalty: number;
    balanceStableBonus: number;
    balanceGapPenalty: number;
    balanceGapPenaltyMax: number;
    tacticalGeneralRiskMultiplier: number;
    tacticalPieceRiskMultiplier: number;
    tacticalOpponentRiskReward: number;
  };
}

export const defaultAiProfile: AiProfile = {
  searchDepth: 2,
  rootBeam: 12,
  responseBeam: 5,
  thirdPlayerBeam: 3,
  safetyScanLimit: 18,
  pieceValues: {
    general: 12_000,
    chariot: 900,
    cannon: 400,
    horse: 400,
    elephant: 200,
    advisor: 200,
    soldier: 100,
  },
  scoring: {
    rootActionWeight: 0.35,
    generalCaptureBonus: 90_000,
    capturedValueMultiplier: 3,
    tradeDeltaMultiplier: 5,
    generalQuietMovePenalty: 220,
    soldierAdvanceAction: 28,
    activePieceAction: 90,
    developmentMajor: 260,
    developmentCannon: 120,
    developmentSoldier: 80,
    badTradeMultiplier: 2.8,
    exposedTradeMultiplier: 1.05,
    openingRaidPenalty: 1_350,
    kingDefensePalaceCapture: 22_000,
    kingDefenseAttackerCapture: 18_000,
    kingDefensePowerPieceCapture: 7_000,
    defeatedSelfPenalty: -35_000,
    defeatedOpponentReward: 8_000,
    checkedSelfPenalty: 4_000,
    checkedOpponentReward: 1_800,
    soldierAdvanceEval: 18,
    mobilityEval: 8,
    openingCannonOutPenalty: -130,
    openingMajorDeveloped: 110,
    advisorElephantHome: 40,
    advisorElephantAwayPenalty: -160,
    directCheckPenalty: 28_000,
    directAttackerPenalty: 18_000,
    palacePressurePenalty: 1_050,
    defenderBonus: 950,
    generalHomeBonus: 1_200,
    generalAwayPenalty: 1_800,
    balanceStableBonus: 350,
    balanceGapPenalty: 0.3,
    balanceGapPenaltyMax: 2_400,
    tacticalGeneralRiskMultiplier: 3.5,
    tacticalPieceRiskMultiplier: 0.6,
    tacticalOpponentRiskReward: 0.35,
  },
};
