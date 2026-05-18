import type { Kingdom, PointId } from "../board";
import type { PieceType } from "../pieces";
import { turnOrder } from "../game-state";

// Zobrist hashing for O(1) state key computation in the search tree.
// Uses two 32-bit integers combined as a 64-bit hash to avoid BigInt overhead.

const KINGDOM_COUNT = 3;
const PIECE_TYPE_COUNT = 7;
const MAX_COL = 10; // 1-9 + padding
const MAX_ROWS = 15; // A-O (5+5+5 rows)

type HashPair = [number, number];

// pieceTable[pieceType][kingdom][rowIdx * MAX_COL + col] = [hi, lo]
const pieceTable: HashPair[][][] = [];
const sideTable: HashPair[] = []; // sideTable[kindomIdx] = [hi, lo]
const defeatedTable: HashPair[] = []; // defeatedTable[kingdomIdx] = [hi, lo]
const checkedTable: HashPair[] = []; // checkedTable[kingdomIdx] = [hi, lo]

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initTables(): void {
  const rng = mulberry32(0x12345678);
  const rand32 = () => (rng() * 4294967296) >>> 0;

  const pieceTypes: PieceType[] = ["general", "chariot", "cannon", "horse", "elephant", "advisor", "soldier"];
  const kingdoms: Kingdom[] = ["wei", "wu", "shu"];

  for (let pt = 0; pt < PIECE_TYPE_COUNT; pt++) {
    pieceTable[pt] = [];
    for (let k = 0; k < KINGDOM_COUNT; k++) {
      pieceTable[pt][k] = [];
      for (let r = 0; r < MAX_ROWS; r++) {
        for (let c = 0; c < MAX_COL; c++) {
          pieceTable[pt][k][r * MAX_COL + c] = [rand32(), rand32()];
        }
      }
    }
  }

  for (let k = 0; k < KINGDOM_COUNT; k++) {
    sideTable[k] = [rand32(), rand32()];
    defeatedTable[k] = [rand32(), rand32()];
    checkedTable[k] = [rand32(), rand32()];
  }
}

initTables();

const kingdomIndex: Record<Kingdom, number> = { wei: 0, wu: 1, shu: 2 };
const pieceTypeIndex: Record<PieceType, number> = {
  general: 0, chariot: 1, cannon: 2, horse: 3, elephant: 4, advisor: 5, soldier: 6,
};

// Map row label to index: A=0, B=1, ..., O=14
const rowLabelIndex: Record<string, number> = {
  A: 0, B: 1, C: 2, D: 3, E: 4,
  F: 5, G: 6, H: 7, I: 8, J: 9,
  K: 10, L: 11, M: 12, N: 13, O: 14,
};

function positionIndex(pos: PointId): number {
  const row = rowLabelIndex[pos[0]];
  const col = Number(pos.slice(1));
  return row * MAX_COL + col;
}

export interface ZobristHash {
  hi: number;
  lo: number;
}

export function xorHash(hash: ZobristHash, pair: HashPair): ZobristHash {
  return {
    hi: hash.hi ^ pair[0],
    lo: hash.lo ^ pair[1],
  };
}

export function pieceHash(pieceType: PieceType, kingdom: Kingdom, position: PointId): HashPair {
  return pieceTable[pieceTypeIndex[pieceType]][kingdomIndex[kingdom]][positionIndex(position)];
}

export function sideHash(kingdom: Kingdom): HashPair {
  return sideTable[kingdomIndex[kingdom]];
}

export function defeatedHash(kingdom: Kingdom): HashPair {
  return defeatedTable[kingdomIndex[kingdom]];
}

export function checkedKingdomHash(kingdom: Kingdom): HashPair {
  return checkedTable[kingdomIndex[kingdom]];
}

export function computeFullHash(
  pieces: Array<{ type: PieceType; kingdom: Kingdom; position: PointId; blocksMovement: boolean; controller: Kingdom }>,
  currentKingdom: Kingdom,
  defeatedKingdoms: readonly Kingdom[],
  checkedKingdoms: readonly Kingdom[] = [],
): ZobristHash {
  let hash: ZobristHash = { hi: 0, lo: 0 };

  for (const piece of pieces) {
    if (!piece.blocksMovement) continue;
    const table = pieceTable[pieceTypeIndex[piece.type]][kingdomIndex[piece.kingdom]][positionIndex(piece.position)];
    hash = xorHash(hash, table);
  }

  hash = xorHash(hash, sideHash(currentKingdom));

  for (const kingdom of defeatedKingdoms) {
    hash = xorHash(hash, defeatedHash(kingdom));
  }

  for (const kingdom of checkedKingdoms) {
    hash = xorHash(hash, checkedKingdomHash(kingdom));
  }

  return hash;
}

export function hashToKey(hash: ZobristHash): string {
  return `${hash.hi >>> 0}_${hash.lo >>> 0}`;
}
