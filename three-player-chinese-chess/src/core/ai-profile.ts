import type { PieceType } from "./pieces";
import type { Kingdom } from "./board";

export type AiStyle = "aggressive" | "solid" | "mobile";

export interface AiStyleProfile {
  id: AiStyle;
  label: string;
  attackMultiplier: number;
  safetyMultiplier: number;
  mobilityMultiplier: number;
  developmentMultiplier: number;
  balanceMultiplier: number;
  targetStrongestBonus: number;
  riskTolerance: number;
  preferredPieces: Partial<Record<PieceType, number>>;
}

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

export const kingdomAiStyles: Record<Kingdom, AiStyleProfile> = {
  wei: {
    id: "aggressive",
    label: "魏：攻势压迫",
    attackMultiplier: 1.22,
    safetyMultiplier: 0.94,
    mobilityMultiplier: 1.04,
    developmentMultiplier: 1,
    balanceMultiplier: 0.92,
    targetStrongestBonus: 1.18,
    riskTolerance: 1.14,
    preferredPieces: {
      chariot: 220,
      cannon: 120,
      horse: 52,
    },
  },
  shu: {
    id: "solid",
    label: "蜀：稳健守成",
    attackMultiplier: 0.96,
    safetyMultiplier: 1.25,
    mobilityMultiplier: 0.96,
    developmentMultiplier: 0.98,
    balanceMultiplier: 1.08,
    targetStrongestBonus: 0.95,
    riskTolerance: 0.76,
    preferredPieces: {
      advisor: 140,
      elephant: 140,
      general: 48,
    },
  },
  wu: {
    id: "mobile",
    label: "吴：机动作战",
    attackMultiplier: 1.04,
    safetyMultiplier: 1,
    mobilityMultiplier: 1.24,
    developmentMultiplier: 1.18,
    balanceMultiplier: 1,
    targetStrongestBonus: 1.04,
    riskTolerance: 0.96,
    preferredPieces: {
      horse: 220,
      cannon: 110,
      soldier: 52,
    },
  },
};

export function aiStyleForKingdom(kingdom: Kingdom): AiStyleProfile {
  return kingdomAiStyles[kingdom];
}

export const defaultAiProfile: AiProfile = {
  "searchDepth": 3,
  "rootBeam": 12,
  "responseBeam": 5,
  "thirdPlayerBeam": 3,
  "safetyScanLimit": 18,
  "pieceValues": {
    "general": 12000,
    "chariot": 900,
    "cannon": 400,
    "horse": 400,
    "elephant": 200,
    "advisor": 200,
    "soldier": 100
  },
  "scoring": {
    "rootActionWeight": 0.35,
    "generalCaptureBonus": 90000,
    "capturedValueMultiplier": 3,
    "tradeDeltaMultiplier": 1.5,
    "generalQuietMovePenalty": 220,
    "soldierAdvanceAction": 28,
    "activePieceAction": 160,
    "developmentMajor": 350,
    "developmentCannon": 180,
    "developmentSoldier": 80,
    "badTradeMultiplier": 2.8,
    "exposedTradeMultiplier": 1.05,
    "openingRaidPenalty": 1350,
    "kingDefensePalaceCapture": 22000,
    "kingDefenseAttackerCapture": 18000,
    "kingDefensePowerPieceCapture": 7000,
    "defeatedSelfPenalty": -35000,
    "defeatedOpponentReward": 8000,
    "checkedSelfPenalty": 4000,
    "checkedOpponentReward": 1800,
    "soldierAdvanceEval": 18,
    "mobilityEval": 16,
    "openingCannonOutPenalty": -130,
    "openingMajorDeveloped": 110,
    "advisorElephantHome": 40,
    "advisorElephantAwayPenalty": -160,
    "directCheckPenalty": 28000,
    "directAttackerPenalty": 18000,
    "palacePressurePenalty": 1050,
    "defenderBonus": 1102.608,
    "generalHomeBonus": 1200,
    "generalAwayPenalty": 1800,
    "balanceStableBonus": 350,
    "balanceGapPenalty": 0.3,
    "balanceGapPenaltyMax": 2400,
    "tacticalGeneralRiskMultiplier": 3.5,
    "tacticalPieceRiskMultiplier": 0.6,
    "tacticalOpponentRiskReward": 0.35
  }
};
