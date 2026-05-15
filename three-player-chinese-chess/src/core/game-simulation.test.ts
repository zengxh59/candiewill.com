import { describe, expect, it } from "vitest";
import { createInitialGameState, pieceAt, type GameState } from "./game-state";
import type { PointId } from "./board";
import type { Kingdom } from "./board";
import { getLegalMoves, getCheckedKingdoms } from "./moves";
import { applyMove } from "./rules";

function playRandomGame(maxTurns = 200, seed = 42): { turn: number; kingdom: Kingdom; state: GameState } | null {
  let state = createInitialGameState();
  let rng = seed;

  function nextRandom(): number {
    rng = (rng * 1664525 + 1013904223) % 4294967296;
    return rng / 4294967296;
  }

  for (let turn = 0; turn < maxTurns; turn++) {
    const kingdom = state.currentKingdom;
    const pieces = state.pieces.filter((p) => p.controller === kingdom && p.blocksMovement);
    const allMoves: Array<{ pieceId: string; target: PointId }> = [];

    for (const piece of pieces) {
      for (const target of getLegalMoves(state, piece)) {
        allMoves.push({ pieceId: piece.id, target });
      }
    }

    if (allMoves.length === 0) {
      return { turn, kingdom, state };
    }

    const move = allMoves[Math.floor(nextRandom() * allMoves.length)];
    state = applyMove(state, move.pieceId, move.target);

    if (state.winner) {
      return null;
    }
  }

  return null;
}

describe("self-play simulation", () => {
  it("completes a random game without any player getting stuck", { timeout: 15_000 }, () => {
    for (let seed = 1; seed <= 50; seed++) {
      const stuck = playRandomGame(300, seed);

      if (stuck) {
        const kingdom = stuck.kingdom;
        const pieces = stuck.state.pieces.filter(
          (p) => p.controller === kingdom && p.blocksMovement,
        );
        const inCheck = stuck.state.checkedKingdoms.includes(kingdom);
        const pseudoLegalCounts = pieces.map((p) => getLegalMoves(stuck.state, p).length);

        expect(
          false,
          `Game got stuck at turn ${stuck.turn}: ${kingdom} has no legal moves. ` +
            `In check: ${inCheck}. Pieces: ${pieces.length}. ` +
            `Legal moves per piece: [${pseudoLegalCounts.join(", ")}]. ` +
            `Pieces: ${pieces.map((p) => `${p.label}@${p.position}`).join(", ")}`,
        ).toBe(true);
      }
    }
  });

  it("every player always has at least one legal move in the first 50 turns", () => {
    for (let seed = 1; seed <= 30; seed++) {
      let state = createInitialGameState();
      let rng = seed;

      function nextRandom(): number {
        rng = (rng * 1664525 + 1013904223) % 4294967296;
        return rng / 4294967296;
      }

      for (let turn = 0; turn < 50; turn++) {
        if (state.winner) break;

        const kingdom = state.currentKingdom;
        const pieces = state.pieces.filter((p) => p.controller === kingdom && p.blocksMovement);
        const allMoves: Array<{ pieceId: string; target: PointId }> = [];

        for (const piece of pieces) {
          for (const target of getLegalMoves(state, piece)) {
            allMoves.push({ pieceId: piece.id, target });
          }
        }

        if (allMoves.length === 0) {
          const inCheck = state.checkedKingdoms.includes(kingdom);
          expect(
            false,
            `Turn ${turn}, seed ${seed}: ${kingdom} has no legal moves. In check: ${inCheck}. ` +
              `Defeated: [${state.defeatedKingdoms.join(",")}]. ` +
              `Pieces: ${pieces.map((p) => `${p.label}@${p.position}`).join(", ")}`,
          ).toBe(true);
        }

        const move = allMoves[Math.floor(nextRandom() * allMoves.length)];
        state = applyMove(state, move.pieceId, move.target);
      }
    }
  });
});
