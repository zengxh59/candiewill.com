import type { Kingdom, PointId } from "../board";
import type { AiMove } from "./engine";

interface OpeningEntry {
  moveSequence: string;
  moves: Array<{
    pieceId: string;
    target: PointId;
    weight: number;
  }>;
}

// Opening book for three-player chess
// moveSequence format: "pieceId:target|pieceId:target|..."
// Covers the first 1-3 moves per player (plies 1-9)
// All move targets verified against legal moves from initial position
const openingBook: OpeningEntry[] = [
  // ===== WEI FIRST MOVE → SHU RESPONSE (Ply 1-2) =====

  // Wei: center soldier push
  {
    moveSequence: "wei-soldier-5:A5",
    moves: [
      { pieceId: "shu-soldier-5", target: "K5", weight: 4 },
      { pieceId: "shu-horse-left", target: "M1", weight: 3 },
      { pieceId: "shu-horse-right", target: "M9", weight: 3 },
    ],
  },
  // Wei: left horse
  {
    moveSequence: "wei-horse-left:C1",
    moves: [
      { pieceId: "shu-horse-left", target: "M1", weight: 4 },
      { pieceId: "shu-horse-right", target: "M9", weight: 3 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 2 },
    ],
  },
  {
    moveSequence: "wei-horse-left:C3",
    moves: [
      { pieceId: "shu-horse-left", target: "M1", weight: 4 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  // Wei: right horse
  {
    moveSequence: "wei-horse-right:C9",
    moves: [
      { pieceId: "shu-horse-right", target: "M9", weight: 4 },
      { pieceId: "shu-horse-left", target: "M1", weight: 3 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 2 },
    ],
  },
  {
    moveSequence: "wei-horse-right:C7",
    moves: [
      { pieceId: "shu-horse-right", target: "M9", weight: 4 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  // Wei: left chariot development
  {
    moveSequence: "wei-chariot-left:D1",
    moves: [
      { pieceId: "shu-horse-left", target: "M1", weight: 4 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-chariot-left:C1",
    moves: [
      { pieceId: "shu-horse-right", target: "M9", weight: 4 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  // Wei: right chariot development
  {
    moveSequence: "wei-chariot-right:D9",
    moves: [
      { pieceId: "shu-horse-right", target: "M9", weight: 4 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-chariot-right:C9",
    moves: [
      { pieceId: "shu-horse-left", target: "M1", weight: 4 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  // Wei: side soldier pushes
  {
    moveSequence: "wei-soldier-3:A3",
    moves: [
      { pieceId: "shu-soldier-5", target: "K5", weight: 4 },
      { pieceId: "shu-horse-left", target: "M1", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-soldier-7:A7",
    moves: [
      { pieceId: "shu-soldier-5", target: "K5", weight: 4 },
      { pieceId: "shu-horse-right", target: "M9", weight: 3 },
    ],
  },
  // Wei: cannon development
  {
    moveSequence: "wei-cannon-left:D2",
    moves: [
      { pieceId: "shu-horse-left", target: "M1", weight: 4 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-cannon-right:D8",
    moves: [
      { pieceId: "shu-horse-right", target: "M9", weight: 4 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  // Wei: elephant development
  {
    moveSequence: "wei-elephant-left:C1",
    moves: [
      { pieceId: "shu-horse-left", target: "M1", weight: 3 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-elephant-right:C9",
    moves: [
      { pieceId: "shu-horse-right", target: "M9", weight: 3 },
      { pieceId: "shu-soldier-5", target: "K5", weight: 3 },
    ],
  },

  // ===== WEI + SHU FIRST MOVE → WU RESPONSE (Ply 3) =====

  // Both push center soldiers
  {
    moveSequence: "wei-soldier-5:A5|shu-soldier-5:K5",
    moves: [
      { pieceId: "wu-soldier-5", target: "F5", weight: 4 },
      { pieceId: "wu-horse-left", target: "H1", weight: 3 },
      { pieceId: "wu-horse-right", target: "H9", weight: 3 },
    ],
  },
  // Wei soldier + Shu horse left
  {
    moveSequence: "wei-soldier-5:A5|shu-horse-left:M1",
    moves: [
      { pieceId: "wu-horse-right", target: "H9", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
      { pieceId: "wu-horse-left", target: "H1", weight: 2 },
    ],
  },
  // Wei soldier + Shu horse right
  {
    moveSequence: "wei-soldier-5:A5|shu-horse-right:M9",
    moves: [
      { pieceId: "wu-horse-left", target: "H1", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
      { pieceId: "wu-horse-right", target: "H9", weight: 2 },
    ],
  },
  // Wei horse + Shu soldier
  {
    moveSequence: "wei-horse-left:C1|shu-soldier-5:K5",
    moves: [
      { pieceId: "wu-horse-right", target: "H9", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
      { pieceId: "wu-horse-left", target: "H1", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-horse-right:C9|shu-soldier-5:K5",
    moves: [
      { pieceId: "wu-horse-left", target: "H1", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
      { pieceId: "wu-horse-right", target: "H9", weight: 3 },
    ],
  },
  // Both horses
  {
    moveSequence: "wei-horse-left:C1|shu-horse-left:M1",
    moves: [
      { pieceId: "wu-horse-right", target: "H9", weight: 4 },
      { pieceId: "wu-horse-left", target: "H1", weight: 3 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-horse-left:C1|shu-horse-right:M9",
    moves: [
      { pieceId: "wu-horse-left", target: "H1", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-horse-right:C9|shu-horse-left:M1",
    moves: [
      { pieceId: "wu-horse-right", target: "H9", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-horse-right:C9|shu-horse-right:M9",
    moves: [
      { pieceId: "wu-horse-left", target: "H1", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
    ],
  },
  // Chariot developments
  {
    moveSequence: "wei-chariot-left:D1|shu-soldier-5:K5",
    moves: [
      { pieceId: "wu-soldier-5", target: "F5", weight: 4 },
      { pieceId: "wu-horse-right", target: "H9", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-chariot-right:D9|shu-soldier-5:K5",
    moves: [
      { pieceId: "wu-soldier-5", target: "F5", weight: 4 },
      { pieceId: "wu-horse-left", target: "H1", weight: 3 },
    ],
  },
  // Wei cannon + Shu horse
  {
    moveSequence: "wei-cannon-left:D2|shu-horse-left:M1",
    moves: [
      { pieceId: "wu-horse-right", target: "H9", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-cannon-right:D8|shu-horse-right:M9",
    moves: [
      { pieceId: "wu-horse-left", target: "H1", weight: 4 },
      { pieceId: "wu-soldier-5", target: "F5", weight: 3 },
    ],
  },
  // Side soldier openings
  {
    moveSequence: "wei-soldier-3:A3|shu-soldier-5:K5",
    moves: [
      { pieceId: "wu-soldier-5", target: "F5", weight: 4 },
      { pieceId: "wu-horse-left", target: "H1", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-soldier-7:A7|shu-soldier-5:K5",
    moves: [
      { pieceId: "wu-soldier-5", target: "F5", weight: 4 },
      { pieceId: "wu-horse-right", target: "H9", weight: 3 },
    ],
  },

  // ===== THREE-PLY SEQUENCES (Wei first move complete round) =====

  // Center soldier opening: Wei push, Shu push, Wu push → Wei responds
  {
    moveSequence: "wei-soldier-5:A5|shu-soldier-5:K5|wu-soldier-5:F5",
    moves: [
      { pieceId: "wei-horse-left", target: "C1", weight: 4 },
      { pieceId: "wei-horse-right", target: "C9", weight: 4 },
      { pieceId: "wei-cannon-left", target: "D2", weight: 3 },
    ],
  },
  // Center push + horse responses
  {
    moveSequence: "wei-soldier-5:A5|shu-horse-left:M1|wu-horse-right:H9",
    moves: [
      { pieceId: "wei-horse-right", target: "C9", weight: 4 },
      { pieceId: "wei-horse-left", target: "C1", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-soldier-5:A5|shu-horse-right:M9|wu-horse-left:H1",
    moves: [
      { pieceId: "wei-horse-left", target: "C1", weight: 4 },
      { pieceId: "wei-horse-right", target: "C9", weight: 3 },
    ],
  },
  // Horse opening continuations
  {
    moveSequence: "wei-horse-left:C1|shu-horse-left:M1|wu-horse-right:H9",
    moves: [
      { pieceId: "wei-soldier-5", target: "A5", weight: 4 },
      { pieceId: "wei-horse-right", target: "C9", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-horse-right:C9|shu-horse-right:M9|wu-horse-left:H1",
    moves: [
      { pieceId: "wei-soldier-5", target: "A5", weight: 4 },
      { pieceId: "wei-horse-left", target: "C1", weight: 3 },
    ],
  },
  // Symmetric horse openings
  {
    moveSequence: "wei-horse-left:C1|shu-horse-right:M9|wu-horse-right:H9",
    moves: [
      { pieceId: "wei-soldier-5", target: "A5", weight: 4 },
      { pieceId: "wei-horse-right", target: "C9", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-horse-right:C9|shu-horse-left:M1|wu-horse-left:H1",
    moves: [
      { pieceId: "wei-soldier-5", target: "A5", weight: 4 },
      { pieceId: "wei-horse-left", target: "C1", weight: 3 },
    ],
  },

  // ===== FOUR-PLY SEQUENCES (Shu second move) =====
  {
    moveSequence: "wei-soldier-5:A5|shu-soldier-5:K5|wu-soldier-5:F5|wei-horse-left:C1",
    moves: [
      { pieceId: "shu-horse-left", target: "M1", weight: 4 },
      { pieceId: "shu-horse-right", target: "M9", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-soldier-5:A5|shu-soldier-5:K5|wu-soldier-5:F5|wei-horse-right:C9",
    moves: [
      { pieceId: "shu-horse-right", target: "M9", weight: 4 },
      { pieceId: "shu-horse-left", target: "M1", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-horse-left:C1|shu-soldier-5:K5|wu-horse-right:H9|wei-soldier-5:A5",
    moves: [
      { pieceId: "shu-horse-left", target: "M1", weight: 4 },
      { pieceId: "shu-horse-right", target: "M9", weight: 3 },
    ],
  },
  {
    moveSequence: "wei-horse-right:C9|shu-soldier-5:K5|wu-horse-left:H1|wei-soldier-5:A5",
    moves: [
      { pieceId: "shu-horse-right", target: "M9", weight: 4 },
      { pieceId: "shu-horse-left", target: "M1", weight: 3 },
    ],
  },
];

export function lookupOpeningBook(
  moveHistory: Array<{ pieceId: string; from: PointId; target: PointId }> | undefined,
  kingdom: Kingdom,
  random?: () => number,
): AiMove | null {
  if (!moveHistory || moveHistory.length === 0 || moveHistory.length > 6) {
    return null;
  }

  const sequence = moveHistory.map((move) => `${move.pieceId}:${move.target}`).join("|");

  let bestMatch: OpeningEntry | null = null;
  let bestMatchLength = 0;

  // Find the longest matching prefix
  for (const entry of openingBook) {
    const entryMoves = entry.moveSequence.split("|");
    const prefixToMatch = entryMoves.slice(0, moveHistory.length).join("|");

    if (sequence.startsWith(prefixToMatch) && entryMoves.length > bestMatchLength) {
      bestMatch = entry;
      bestMatchLength = entryMoves.length;
    }
  }

  if (!bestMatch) {
    return null;
  }

  const candidates = bestMatch.moves.filter((move) => move.pieceId.startsWith(kingdom));

  if (!candidates.length) {
    return null;
  }

  if (random) {
    const totalWeight = candidates.reduce((sum, move) => sum + move.weight, 0);
    let roll = random() * totalWeight;

    for (const candidate of candidates) {
      roll -= candidate.weight;

      if (roll <= 0) {
        return {
          pieceId: candidate.pieceId,
          from: "" as PointId,
          target: candidate.target,
        };
      }
    }
  }

  const best = candidates.sort((left, right) => right.weight - left.weight)[0];

  return {
    pieceId: best.pieceId,
    from: "" as PointId,
    target: best.target,
  };
}
