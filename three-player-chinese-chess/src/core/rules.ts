import type { Kingdom, PointId } from "./board";
import {
  capturedPieceAt,
  nextActiveKingdom,
  turnOrder,
  updatePiecePosition,
  type GameState,
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
  const movedState = updatePiecePosition(state, pieceId, target);
  const captureDefeatedKingdom = capturedPiece?.type === "general" ? capturedPiece.kingdom : null;
  const captureResolved = resolveDefeatedKingdom(movedState, state.defeatedKingdoms, captureDefeatedKingdom, movingPiece.controller);
  const checkmateDefeatedKingdoms =
    state.options.defeatCondition === "checkmate"
      ? getCheckmatedKingdoms(captureResolved.state, captureResolved.defeatedKingdoms)
      : [];
  const defeatResolved = checkmateDefeatedKingdoms.reduce((current, kingdom) => {
    return resolveDefeatedKingdom(current.state, current.defeatedKingdoms, kingdom, movingPiece.controller);
  }, captureResolved);
  const defeatedKingdoms = defeatResolved.defeatedKingdoms;
  const activeKingdoms = turnOrder.filter((kingdom) => !defeatedKingdoms.includes(kingdom));
  const winner = activeKingdoms.length === 1 ? activeKingdoms[0] : null;
  const nextState: GameState = {
    ...defeatResolved.state,
    selectedPieceId: null,
    legalMoves: [],
    currentKingdom: winner ? state.currentKingdom : nextActiveKingdom(state.currentKingdom, defeatedKingdoms),
    winner,
    defeatedKingdoms,
    lastMoveMessage: checkmateDefeatedKingdoms.length
      ? `${checkmateDefeatedKingdoms.map(kingdomName).join("、")}出局`
      : capturedPiece
      ? `${kingdomName(movingPiece.controller)}吃掉${kingdomName(capturedPiece.kingdom)}${capturedPiece.label}`
      : null,
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
