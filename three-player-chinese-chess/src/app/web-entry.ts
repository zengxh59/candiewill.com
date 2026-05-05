import "../styles.css";
import type { Kingdom, PointId } from "../core/board";
import { chooseAiMove, type AiMove } from "../core/ai";
import {
  capturedPieceAt,
  createInitialGameState,
  pieceAt,
  type DefeatedPieceMode,
  type GameOptions,
} from "../core/game-state";
import { getCheckedKingdoms, getLegalMoves } from "../core/moves";
import type { Piece } from "../core/pieces";
import { applyMove, kingdomName } from "../core/rules";
import { drawBoard, type BoardAnimation } from "../renderer/canvas-board";
import { defaultGeometry, hitTestBoardPoint, pointIdPosition } from "../renderer/geometry";

const canvas = document.querySelector<HTMLCanvasElement>("#board");
const status = document.querySelector<HTMLDivElement>("#status");
const startScreen = document.querySelector<HTMLElement>("#start-screen");
const startButton = document.querySelector<HTMLButtonElement>("#start-game");
const settingsButton = document.querySelector<HTMLButtonElement>("#show-settings");

if (!canvas || !status || !startScreen || !startButton || !settingsButton) {
  throw new Error("Board canvas was not found.");
}

type GameMode = "ai" | "online";

const humanKingdom: Kingdom = "wei";
let currentGameMode: GameMode = "ai";
let aiTimer: number | null = null;
let isAiThinking = false;
let isAnimating = false;
let thinkingPhase = 0;
let thinkingFrame: number | null = null;
let currentAnimation: BoardAnimation | null = null;
let state = createInitialGameState(readStartSettings().options);
state = {
  ...state,
  checkedKingdoms: getCheckedKingdoms(state),
};

function render(): void {
  drawBoard(canvas!, defaultGeometry, state, {
    currentKingdom: state.currentKingdom,
    thinkingKingdom: isAiThinking ? state.currentKingdom : null,
    thinkingPhase,
    humanKingdom,
    mode: currentGameMode,
  }, currentAnimation);
  renderStatus();
}

function renderStatus(): void {
  status!.replaceChildren();
  status!.append(createMessage(state.winner ? `胜者：${kingdomName(state.winner)}` : state.lastMoveMessage ?? "对局开始", "last-move"));
}

function createMessage(text: string, modifier: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = `status-message ${modifier}`;
  element.textContent = text;

  return element;
}

function selectPiece(point: PointId): void {
  const piece = pieceAt(state, point);

  if (!piece || piece.controller !== state.currentKingdom || isAiTurn()) {
    state = {
      ...state,
      selectedPieceId: null,
      legalMoves: [],
    };
    return;
  }

  state = {
    ...state,
    selectedPieceId: piece.id,
    legalMoves: getLegalMoves(state, piece),
  };
}

canvas.addEventListener("click", (event) => {
  if (isAiTurn() || isAnimating) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const point = hitTestBoardPoint((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);

  if (!point) {
    state = { ...state, selectedPieceId: null, legalMoves: [] };
    render();
    return;
  }

  const clickedPiece = pieceAt(state, point);

  if (state.winner) {
    return;
  }

  if (clickedPiece?.controller === state.currentKingdom) {
    selectPiece(point);
    render();
    return;
  }

  if (state.selectedPieceId && state.legalMoves.includes(point)) {
    const kingdom = state.currentKingdom;
    void commitMove(state.selectedPieceId, point, kingdom, "玩家").then(scheduleAiTurn);
    return;
  }

  state = { ...state, selectedPieceId: null, legalMoves: [] };
  render();
});

startButton.addEventListener("click", () => {
  clearAiTimer();
  stopThinkingLoop();
  const settings = readStartSettings();
  currentGameMode = settings.gameMode;
  isAnimating = false;
  currentAnimation = null;
  state = createInitialGameState(settings.options);
  state = {
    ...state,
    checkedKingdoms: getCheckedKingdoms(state),
  };
  startScreen.classList.add("is-hidden");
  render();
  scheduleAiTurn();
});

settingsButton.addEventListener("click", () => {
  clearAiTimer();
  stopThinkingLoop();
  isAiThinking = false;
  isAnimating = false;
  currentAnimation = null;
  startScreen.classList.remove("is-hidden");
  render();
});

render();

function readStartSettings(): { gameMode: GameMode; options: GameOptions } {
  const gameMode = document.querySelector<HTMLInputElement>("input[name='game-mode']:checked");
  const defeatedPieceMode = document.querySelector<HTMLInputElement>("input[name='defeated-piece-mode']:checked");
  const defeatCondition = document.querySelector<HTMLInputElement>("input[name='defeat-condition']:checked");

  return {
    gameMode: (gameMode?.value ?? "ai") as GameMode,
    options: {
      defeatedPieceMode: (defeatedPieceMode?.value ?? "block") as DefeatedPieceMode,
      defeatCondition: (defeatCondition?.value ?? "capture") as GameOptions["defeatCondition"],
    },
  };
}

function scheduleAiTurn(): void {
  clearAiTimer();

  if (!isAiTurn()) {
    isAiThinking = false;
    return;
  }

  isAiThinking = true;
  startThinkingLoop();
  render();
  aiTimer = window.setTimeout(runAiTurn, 650);
}

async function runAiTurn(): Promise<void> {
  if (!isAiTurn()) {
    isAiThinking = false;
    stopThinkingLoop();
    render();
    return;
  }

  const kingdom = state.currentKingdom;
  const move = chooseAiMove(state, kingdom);

  if (!move) {
    isAiThinking = false;
    stopThinkingLoop();
    state = {
      ...state,
      lastMoveMessage: `${kingdomName(kingdom)}暂无可行棋子`,
    };
    render();
    return;
  }

  isAiThinking = false;
  stopThinkingLoop();
  await commitMove(move.pieceId, move.target, kingdom, "AI");
  scheduleAiTurn();
}

async function commitMove(pieceId: string, target: PointId, kingdom: Kingdom, actor: "AI" | "玩家"): Promise<void> {
  const movingPiece = state.pieces.find((piece) => piece.id === pieceId);

  if (!movingPiece || isAnimating) {
    return;
  }

  const capturedPiece = capturedPieceAt(state, pieceId, target);
  const move = {
    pieceId,
    from: movingPiece.position,
    target,
  };
  const nextState = withMoveMessage(applyMove(state, pieceId, target), kingdom, move, actor);

  await playMoveAnimation(movingPiece, capturedPiece, target);
  state = nextState;
  currentAnimation = null;
  isAnimating = false;
  render();
}

function playMoveAnimation(movingPiece: Piece, capturedPiece: Piece | null, target: PointId): Promise<void> {
  isAnimating = true;
  state = {
    ...state,
    selectedPieceId: null,
    legalMoves: [],
  };

  const from = pointIdPosition(movingPiece.position, defaultGeometry);
  const to = pointIdPosition(target, defaultGeometry);
  const duration = capturedPiece ? 820 : 680;

  return new Promise((resolve) => {
    const startedAt = performance.now();

    function frame(now: number): void {
      const progress = Math.min(1, (now - startedAt) / duration);

      currentAnimation = {
        movingPiece,
        capturedPiece,
        from,
        to,
        progress,
      };
      render();

      if (progress < 1) {
        window.requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    window.requestAnimationFrame(frame);
  });
}

function withMoveMessage(nextState: typeof state, kingdom: Kingdom, move: AiMove, actor: "AI" | "玩家"): typeof state {
  if (nextState.lastMoveMessage) {
    return nextState;
  }

  const movedPiece = state.pieces.find((piece) => piece.id === move.pieceId);

  return {
    ...nextState,
    lastMoveMessage: `${kingdomName(kingdom)}${actor}：${movedPiece?.label ?? "棋"} ${move.from}-${move.target}`,
  };
}

function clearAiTimer(): void {
  if (aiTimer !== null) {
    window.clearTimeout(aiTimer);
    aiTimer = null;
  }
}

function startThinkingLoop(): void {
  if (thinkingFrame !== null) {
    return;
  }

  function tick(): void {
    if (!isAiThinking) {
      thinkingFrame = null;
      return;
    }

    thinkingPhase += 0.12;
    render();
    thinkingFrame = window.requestAnimationFrame(tick);
  }

  thinkingFrame = window.requestAnimationFrame(tick);
}

function stopThinkingLoop(): void {
  if (thinkingFrame !== null) {
    window.cancelAnimationFrame(thinkingFrame);
    thinkingFrame = null;
  }
}

function isAiTurn(): boolean {
  return currentGameMode === "ai" && state.currentKingdom !== humanKingdom && !state.winner && startScreen!.classList.contains("is-hidden");
}
