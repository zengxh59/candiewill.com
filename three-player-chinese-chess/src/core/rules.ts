import type { Kingdom, PointId } from "./board";
import {
  capturedPieceAt,
  nextActiveKingdom,
  turnOrder,
  updatePiecePosition,
  type GameState,
  type MoveRecord,
} from "./game-state";
import { getCheckedKingdoms, getLegalMoves } from "./moves";

export function applyMove(state: GameState, pieceId: string, target: PointId): GameState {
  if (state.winner) {
    return state;
  }

  const movingPiece = state.pieces.find((piece) => piece.id === pieceId);

  if (!movingPiece) {
    throw new Error(`Unknown piece: ${pieceId}`);
  }

  if (movingPiece.controller !== state.currentKingdom) {
    throw new Error(`It is not ${movingPiece.controller}'s turn.`);
  }

  const legalMoves = getLegalMoves(state, movingPiece);

  if (!legalMoves.includes(target)) {
    throw new Error(`Illegal move: ${pieceId} to ${target}`);
  }

  const capturedPiece = capturedPieceAt(state, pieceId, target);
  const moveRecord: MoveRecord = {
    pieceId,
    kingdom: movingPiece.controller,
    from: movingPiece.position,
    target,
    capturedPieceId: capturedPiece?.id ?? null,
  };
  const movedState = updatePiecePosition(state, pieceId, target);
  const captureDefeatedKingdom = capturedPiece?.type === "general" ? capturedPiece.kingdom : null;
  const captureResolved = resolveDefeatedKingdom(movedState, state.defeatedKingdoms, captureDefeatedKingdom, movingPiece.controller);
  const checkmateDefeatedKingdoms = getCheckmatedKingdoms(captureResolved.state, captureResolved.defeatedKingdoms);
  const defeatResolved = checkmateDefeatedKingdoms.reduce((current, kingdom) => {
    return resolveDefeatedKingdom(current.state, current.defeatedKingdoms, kingdom, movingPiece.controller);
  }, captureResolved);
  const defeatedKingdoms = defeatResolved.defeatedKingdoms;
  const activeKingdoms = turnOrder.filter((kingdom) => !defeatedKingdoms.includes(kingdom));
  const winner = activeKingdoms.length === 1 ? activeKingdoms[0] : null;
  let nextKingdom = winner ? state.currentKingdom : nextActiveKingdom(state.currentKingdom, defeatedKingdoms);
  let stalemateSkipped = "";
  if (!winner) {
    const skipped = skipStalemateTurns(defeatResolved.state, nextKingdom, defeatedKingdoms);
    nextKingdom = skipped.nextKingdom;
    stalemateSkipped = skipped.message;
  }
  const nextState: GameState = {
    ...defeatResolved.state,
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom: nextKingdom,
    winner,
    defeatedKingdoms,
    lastMoveMessage: checkmateDefeatedKingdoms.length
      ? `${checkmateDefeatedKingdoms.map(kingdomName).join("、")}出局`
      : stalemateSkipped
      ? stalemateSkipped
      : capturedPiece
      ? `${kingdomName(movingPiece.controller)}吃掉${kingdomName(capturedPiece.kingdom)}${capturedPiece.label}`
      : null,
    moveHistory: [...(state.moveHistory ?? []), moveRecord].slice(-24),
  };

  return {
    ...nextState,
    checkedKingdoms: winner ? [] : getCheckedKingdoms(nextState),
  };
}

export function getCheckmatedKingdoms(state: GameState, defeatedKingdoms = state.defeatedKingdoms): Kingdom[] {
  return getCheckedKingdoms(state).filter((kingdom) => {
    if (defeatedKingdoms.includes(kingdom)) {
      return false;
    }

    const controlledPieces = state.pieces.filter((piece) => {
      return piece.controller === kingdom && piece.blocksMovement;
    });

    return controlledPieces.every((piece) => {
      return getLegalMoves(state, piece).every((target) => {
        const nextState = updatePiecePosition(state, piece.id, target);
        return getCheckedKingdoms(nextState).includes(kingdom);
      });
    });
  });
}

export function resignKingdom(state: GameState, kingdom: Kingdom): GameState {
  if (state.winner || state.defeatedKingdoms.includes(kingdom)) {
    return state;
  }

  const defeatedKingdoms = [...state.defeatedKingdoms, kingdom];
  const activeKingdoms = turnOrder.filter((activeKingdom) => !defeatedKingdoms.includes(activeKingdom));
  const winner = activeKingdoms.length === 1 ? activeKingdoms[0] : null;
  const defeatedState: GameState = {
    ...applyResignedPieceMode(state, kingdom),
    selectedPieceId: null,
    legalMoves: [],
    defeatedKingdoms,
    winner,
    currentKingdom: winner
      ? state.currentKingdom
      : kingdom === state.currentKingdom
      ? nextActiveKingdom(state.currentKingdom, defeatedKingdoms)
      : state.currentKingdom,
    lastMoveMessage: `${kingdomName(kingdom)}认输出局`,
  };

  return {
    ...defeatedState,
    checkedKingdoms: winner ? [] : getCheckedKingdoms(defeatedState),
  };
}

function applyResignedPieceMode(state: GameState, kingdom: Kingdom): GameState {
  if (state.options.defeatedPieceMode === "remove") {
    return {
      ...state,
      pieces: state.pieces.filter((piece) => piece.kingdom !== kingdom),
    };
  }

  return {
    ...state,
    pieces: state.pieces.map((piece) => {
      if (piece.kingdom !== kingdom) {
        return piece;
      }

      return {
        ...piece,
        defeated: true,
        blocksMovement: true,
      };
    }),
  };
}

function resolveDefeatedKingdom(
  state: GameState,
  defeatedKingdoms: readonly Kingdom[],
  defeatedKingdom: Kingdom | null,
  conqueror: Kingdom,
): { state: GameState; defeatedKingdoms: Kingdom[] } {
  if (!defeatedKingdom || defeatedKingdoms.includes(defeatedKingdom)) {
    return {
      state,
      defeatedKingdoms: [...defeatedKingdoms],
    };
  }

  return {
    state: applyDefeatedPieceMode(state, defeatedKingdom, conqueror),
    defeatedKingdoms: [...defeatedKingdoms, defeatedKingdom],
  };
}

function applyDefeatedPieceMode(state: GameState, defeatedKingdom: Kingdom, conqueror: Kingdom): GameState {
  switch (state.options.defeatedPieceMode) {
    case "remove":
      return {
        ...state,
        pieces: state.pieces.filter((piece) => piece.kingdom !== defeatedKingdom),
        _positionMap: undefined,
      };
    case "block":
      return {
        ...state,
        pieces: state.pieces.map((piece) => {
          if (piece.kingdom !== defeatedKingdom) {
            return piece;
          }

          return {
            ...piece,
            defeated: true,
            blocksMovement: true,
          };
        }),
        _positionMap: undefined,
      };
    case "takeover":
      return {
        ...state,
        pieces: state.pieces.map((piece) => {
          if (piece.kingdom !== defeatedKingdom) {
            return piece;
          }

          return {
            ...piece,
            controller: conqueror,
            defeated: true,
            blocksMovement: true,
          };
        }),
        _positionMap: undefined,
      };
  }
}

export function kingdomName(kingdom: Kingdom): string {
  return {
    wei: "魏",
    wu: "吴",
    shu: "蜀",
  }[kingdom];
}

function skipStalemateTurns(
  state: GameState,
  startKingdom: Kingdom,
  defeatedKingdoms: readonly Kingdom[],
): { nextKingdom: Kingdom; message: string } {
  const visited = new Set<Kingdom>();
  let current = startKingdom;
  const skipped: Kingdom[] = [];

  while (!visited.has(current)) {
    visited.add(current);
    const pieces = state.pieces.filter(
      (p) => p.controller === current && p.blocksMovement,
    );
    const hasLegalMoves = pieces.some((p) => getLegalMoves(state, p).length > 0);

    if (hasLegalMoves) {
      break;
    }

    skipped.push(current);
    current = nextActiveKingdom(current, defeatedKingdoms);
  }

  return {
    nextKingdom: current,
    message: skipped.length
      ? `${skipped.map(kingdomName).join("、")}无子可动，跳过`
      : "",
  };
}
