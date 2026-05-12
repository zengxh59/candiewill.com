import "../styles.css";
import type { Kingdom, PointId } from "../core/board";
import { chooseAiMove, evaluateAiState, type AiMove, type AiMoveOptions } from "../core/ai";
import { aiStyleForKingdom, defaultAiProfile, type AiProfile } from "../core/ai-profile";
import { runAiBenchmark, tuneAiProfile } from "../core/ai-lab";
import {
  capturedPieceAt,
  createInitialGameState,
  pieceAt,
  type DefeatedPieceMode,
  type GameOptions,
  type GameState,
  type MoveRecord,
} from "../core/game-state";
import { getCheckedKingdoms, getLegalMoves } from "../core/moves";
import type { Piece } from "../core/pieces";
import { applyMove, kingdomName } from "../core/rules";
import type { ClientOnlineMessage, OnlineRoomSnapshot, ServerOnlineMessage } from "../online/protocol";
import { drawBoard, type BoardAnimation } from "../renderer/canvas-board";
import { defaultGeometry, hitTestBoardPoint, pointIdPosition } from "../renderer/geometry";

const canvas = document.querySelector<HTMLCanvasElement>("#board");
const status = document.querySelector<HTMLDivElement>("#status");
const startScreen = document.querySelector<HTMLElement>("#start-screen");
const startButton = document.querySelector<HTMLButtonElement>("#start-game");
const settingsButton = document.querySelector<HTMLButtonElement>("#show-settings");
const undoButton = document.querySelector<HTMLButtonElement>("#undo-move");
const aiStartLearningButton = document.querySelector<HTMLButtonElement>("#ai-start-learning");
const aiDownloadLearningButton = document.querySelector<HTMLButtonElement>("#ai-download-learning");
const aiLearningRoundsInput = document.querySelector<HTMLInputElement>("#ai-learning-rounds");
const aiLearningOutput = document.querySelector<HTMLOutputElement>("#ai-learning-output");
const onlineRoomCodeInput = document.querySelector<HTMLInputElement>("#online-room-code");
const onlineRoomOutput = document.querySelector<HTMLOutputElement>("#online-room-output");
const confirmDialog = document.querySelector<HTMLDivElement>("#confirm-dialog");
const confirmTitle = document.querySelector<HTMLHeadingElement>("#confirm-title");
const confirmMessage = document.querySelector<HTMLParagraphElement>("#confirm-message");
const confirmOkButton = document.querySelector<HTMLButtonElement>("#confirm-ok");
const confirmCancelButton = document.querySelector<HTMLButtonElement>("#confirm-cancel");

if (
  !canvas ||
  !status ||
  !startScreen ||
  !startButton ||
  !settingsButton ||
  !undoButton ||
  !aiStartLearningButton ||
  !aiDownloadLearningButton ||
  !aiLearningRoundsInput ||
  !aiLearningOutput ||
  !onlineRoomCodeInput ||
  !onlineRoomOutput ||
  !confirmDialog ||
  !confirmTitle ||
  !confirmMessage ||
  !confirmOkButton ||
  !confirmCancelButton
) {
  throw new Error("Board canvas was not found.");
}

type GameMode = "ai" | "online" | "ai-learning";
type AiDifficulty = "easy" | "medium" | "hard";
type LearningIntensity = "fast" | "normal" | "deep";
type LearningEndReason = "winner" | "timeout" | "repetition" | "ply-limit" | "no-move";

interface StartSettings {
  gameMode: GameMode;
  aiDifficulty: AiDifficulty;
  options: GameOptions;
}

interface LearningConfig {
  depth: number;
  openingDepth: number;
  timeBudgetMs: number;
  tuneIterations: number;
  timeLimitMs: number;
  moveDelayMs: number;
  maxPlies: number;
  explorationRate: number;
  explorationTop: number;
  explorationSlack: number;
  explorationTemperature: number;
}

interface LearningRoundRecord {
  round: number;
  winner: Kingdom;
  reason: LearningEndReason;
  plies: number;
  durationMs: number;
  baselineScore: number;
  candidateScore: number;
  gain: number;
  applied: boolean;
  scenario: string;
  styles: Record<Kingdom, string>;
  timeBudgetMs: number;
  repetitions: number;
  benchmarkSummary: string;
  rejectedCandidates: number;
  moves: string[];
}

interface LearningSession {
  totalRounds: number;
  intensity: LearningIntensity;
  config: LearningConfig;
  currentRound: number;
  startedAt: number;
  roundStartedAt: number;
  plies: number;
  records: LearningRoundRecord[];
  moves: string[];
  positions: Map<string, number>;
  maxRepetition: number;
  isTuning: boolean;
  random: () => number;
}

const humanKingdom: Kingdom = "wei";
const aiProfileStorageKey = "three-player-chinese-chess.ai-profile";
const aiLearningHistoryStorageKey = "three-player-chinese-chess.ai-learning-history";
let currentGameMode: GameMode = "ai";
let currentAiDifficulty: AiDifficulty = "medium";
let aiTimer: number | null = null;
let isAiThinking = false;
let isAnimating = false;
let thinkingPhase = 0;
let thinkingFrame: number | null = null;
let currentAnimation: BoardAnimation | null = null;
let activeAiProfile = readStoredAiProfile();
let learningSession: LearningSession | null = null;
let undoSnapshot: GameState | null = null;
let onlineSocket: WebSocket | null = null;
let onlineHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let onlineSnapshot: OnlineRoomSnapshot | null = null;
let onlineConnectionState: "idle" | "connecting" | "connected" | "disconnected" = "idle";
let onlinePendingMoveId: string | null = null;
let lastAnimatedOnlineMoveKey: string | null = null;
let pendingConfirmResolve: ((confirmed: boolean) => void) | null = null;
let state = createInitialGameState(readStartSettings().options);
state = {
  ...state,
  checkedKingdoms: getCheckedKingdoms(state),
};

function render(): void {
  undoButton!.disabled = !canUndoLastPlayerMove();
  drawBoard(canvas!, defaultGeometry, state, {
    currentKingdom: state.currentKingdom,
    thinkingKingdom: isAiThinking ? state.currentKingdom : null,
    thinkingPhase,
    humanKingdom,
    mode: currentGameMode,
    viewRotation: boardViewRotation(),
  }, currentAnimation);
  renderStatus();
}

function renderStatus(): void {
  status!.replaceChildren();
  if (learningSession) {
    const roundText = `自学习 ${learningSession.currentRound}/${learningSession.totalRounds}`;
    const stateText = learningSession.isTuning
      ? "回归调参中"
      : state.winner
      ? `胜者：${kingdomName(state.winner)}`
      : state.lastMoveMessage ?? "自动对弈开始";
    status!.append(createMessage(`${roundText} · ${stateText}`, "last-move"));
    return;
  }

  if (currentGameMode === "online" && onlineSnapshot) {
    const seatText = onlineSnapshot.role === "player" && onlineSnapshot.seat ? `你执${kingdomName(onlineSnapshot.seat)}` : "观战中";
    const phaseText =
      onlineSnapshot.phase === "waiting"
        ? `等待玩家中 ${onlineSnapshot.players.length}/3`
        : onlineSnapshot.phase === "finished" && state.winner
        ? `胜者：${kingdomName(state.winner)}`
        : `轮到${kingdomName(state.currentKingdom)}行棋`;
    const connectionText = onlineConnectionState === "connected" ? "已连接" : "连接中断";

    status!.append(createMessage(`房间码：${onlineSnapshot.roomCode} · ${seatText} · ${phaseText} · ${connectionText}`, "last-move"));
    return;
  }

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

  if (!piece || piece.controller !== state.currentKingdom || !canInteractWithBoard()) {
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
  if (!canInteractWithBoard() || isAnimating) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const point = hitTestBoardPoint((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY, {
    viewRotation: boardViewRotation(),
  });

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

    if (currentGameMode === "online") {
      submitOnlineMove(state.selectedPieceId, point);
      return;
    }

    void commitMove(state.selectedPieceId, point, kingdom, "玩家").then(scheduleAiTurn);
    return;
  }

  state = { ...state, selectedPieceId: null, legalMoves: [] };
  render();
});

startButton.addEventListener("click", () => {
  clearAiTimer();
  stopThinkingLoop();
  stopLearningSession();
  const settings = readStartSettings();
  currentGameMode = settings.gameMode;

  if (currentGameMode === "online") {
    startOnlineRoom(settings);
    return;
  }

  currentAiDifficulty = settings.aiDifficulty;
  activeAiProfile = profileForIntensity(intensityForDifficulty(settings.aiDifficulty));
  isAnimating = false;
  currentAnimation = null;
  undoSnapshot = null;
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
  if (currentGameMode === "online" && onlineSnapshot) {
    handleOnlineExitRequest();
    return;
  }

  leaveOnlineRoom();
  clearAiTimer();
  stopThinkingLoop();
  stopLearningSession();
  isAiThinking = false;
  isAnimating = false;
  currentAnimation = null;
  undoSnapshot = null;
  startScreen.classList.remove("is-hidden");
  render();
});

undoButton.addEventListener("click", () => {
  undoLastPlayerMove();
});

aiStartLearningButton.addEventListener("click", () => {
  startLearningSession();
});

aiDownloadLearningButton.addEventListener("click", () => {
  downloadLearningData();
});

onlineRoomCodeInput.addEventListener("input", () => {
  onlineRoomCodeInput!.value = onlineRoomCodeInput!.value.replace(/\D/g, "").slice(0, 5);
});

confirmOkButton.addEventListener("click", () => {
  resolveConfirmDialog(true);
});

confirmCancelButton.addEventListener("click", () => {
  resolveConfirmDialog(false);
});

confirmDialog.addEventListener("click", (event) => {
  if (event.target === confirmDialog) {
    resolveConfirmDialog(false);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !confirmDialog!.hidden) {
    resolveConfirmDialog(false);
  }
});

syncLearningDownloadButton();
render();

function readStartSettings(): StartSettings {
  const gameMode = document.querySelector<HTMLInputElement>("input[name='game-mode']:checked");
  const aiDifficulty = document.querySelector<HTMLInputElement>("input[name='ai-difficulty']:checked");
  const defeatedPieceMode = document.querySelector<HTMLInputElement>("input[name='defeated-piece-mode']:checked");
  const defeatCondition = document.querySelector<HTMLInputElement>("input[name='defeat-condition']:checked");

  return {
    gameMode: (gameMode?.value ?? "ai") as GameMode,
    aiDifficulty: (aiDifficulty?.value ?? "medium") as AiDifficulty,
    options: {
      defeatedPieceMode: (defeatedPieceMode?.value ?? "block") as DefeatedPieceMode,
      defeatCondition: (defeatCondition?.value ?? "capture") as GameOptions["defeatCondition"],
    },
  };
}

function startOnlineRoom(settings: StartSettings): void {
  const roomCode = onlineRoomCodeInput!.value.trim();

  if (roomCode && !/^\d{5}$/.test(roomCode)) {
    onlineRoomOutput!.textContent = "房间码需为 5 位数字。";
    return;
  }

  currentGameMode = "online";
  onlineRoomOutput!.textContent = roomCode ? `正在进入房间 ${roomCode}...` : "正在创建房间...";
  connectOnlineSocket(roomCode ? `/join/${roomCode}` : "/create");

  if (roomCode) {
    sendOnlineMessage({
      type: "joinRoom",
      roomCode,
      playerId: getOnlinePlayerId(),
    });
    return;
  }

  sendOnlineMessage({
    type: "createRoom",
    playerId: getOnlinePlayerId(),
    options: settings.options,
  });
}

function scheduleAiTurn(): void {
  clearAiTimer();

  if (currentGameMode === "online" || !isAiTurn()) {
    isAiThinking = false;
    return;
  }

  isAiThinking = true;
  startThinkingLoop();
  render();
  aiTimer = window.setTimeout(runAiTurn, learningSession?.config.moveDelayMs ?? 650);
}

async function runAiTurn(): Promise<void> {
  if (!isAiTurn()) {
    isAiThinking = false;
    stopThinkingLoop();
    render();
    return;
  }

  const kingdom = state.currentKingdom;
  const moveOptions = learningSession
    ? aiLearningMoveOptions(kingdom, learningSession)
    : aiMoveOptionsForDifficulty(currentAiDifficulty, kingdom);
  const move = await requestAiMove(state, kingdom, activeAiProfile, moveOptions);

  if (!move) {
    isAiThinking = false;
    stopThinkingLoop();
    if (learningSession) {
      await finishLearningRound("no-move");
      return;
    }

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

  if (learningSession) {
    learningSession.plies += 1;
    learningSession.moves.push(formatMoveLog(kingdom, move));
    await handleLearningMoveCompleted();
    return;
  }

  scheduleAiTurn();
}

function requestAiMove(sourceState: GameState, kingdom: Kingdom, profile: AiProfile, options: AiMoveOptions): Promise<AiMove | null> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(chooseAiMove(sourceState, kingdom, profile, options));
  }

  const requestId = Date.now() + Math.floor(Math.random() * 100_000);
  const timeoutMs = Math.max(500, (options.timeBudgetMs ?? 1_000) + 650);

  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | null = null;
    let timeout = 0;

    const finish = (move: AiMove | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      worker?.terminate();
      resolve(move);
    };
    timeout = window.setTimeout(() => {
      finish(chooseAiMove(sourceState, kingdom, profile, { ...options, timeBudgetMs: Math.min(120, options.timeBudgetMs ?? 120) }));
    }, timeoutMs);

    try {
      worker = new Worker(new URL("./ai-worker.ts", import.meta.url), { type: "module" });
    } catch {
      window.clearTimeout(timeout);
      resolve(chooseAiMove(sourceState, kingdom, profile, options));
      return;
    }

    if (!worker) {
      window.clearTimeout(timeout);
      resolve(chooseAiMove(sourceState, kingdom, profile, options));
      return;
    }

    worker.addEventListener("message", (event: MessageEvent<{ id: number; move: AiMove | null; error?: string }>) => {
      if (event.data.id !== requestId) {
        return;
      }

      finish(event.data.error ? chooseAiMove(sourceState, kingdom, profile, { ...options, timeBudgetMs: 180 }) : event.data.move);
    });
    worker.addEventListener("error", () => {
      finish(chooseAiMove(sourceState, kingdom, profile, { ...options, timeBudgetMs: 180 }));
    });
    worker.postMessage({
      id: requestId,
      state: sourceState,
      kingdom,
      profile,
      options,
    });
  });
}

async function commitMove(pieceId: string, target: PointId, kingdom: Kingdom, actor: "AI" | "玩家"): Promise<void> {
  const movingPiece = state.pieces.find((piece) => piece.id === pieceId);

  if (!movingPiece || isAnimating) {
    return;
  }

  if (actor === "玩家" && currentGameMode === "ai" && kingdom === humanKingdom) {
    undoSnapshot = cloneGameState(state);
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

function undoLastPlayerMove(): void {
  if (!canUndoLastPlayerMove() || !undoSnapshot) {
    return;
  }

  clearAiTimer();
  stopThinkingLoop();
  isAiThinking = false;
  isAnimating = false;
  currentAnimation = null;
  state = {
    ...cloneGameState(undoSnapshot),
    selectedPieceId: null,
    legalMoves: [],
    winner: null,
    lastMoveMessage: `已悔棋，轮到${kingdomName(humanKingdom)}行棋`,
  };
  undoSnapshot = null;
  render();
}

function canUndoLastPlayerMove(): boolean {
  return (
    currentGameMode === "ai" &&
    undoSnapshot !== null &&
    !state.winner &&
    !isAnimating &&
    !isAiThinking &&
    state.currentKingdom === humanKingdom &&
    startScreen!.classList.contains("is-hidden")
  );
}

function boardViewRotation(): number {
  if (currentGameMode !== "online" || onlineSnapshot?.role !== "player") {
    return 0;
  }

  return {
    wei: 0,
    shu: 120,
    wu: 240,
  }[onlineSnapshot.seat ?? "wei"];
}

function canInteractWithBoard(): boolean {
  if (state.winner || !startScreen!.classList.contains("is-hidden")) {
    return false;
  }

  if (currentGameMode !== "online") {
    return !isAiTurn();
  }

  return (
    onlineConnectionState === "connected" &&
    onlinePendingMoveId === null &&
    onlineSnapshot?.phase === "playing" &&
    onlineSnapshot.role === "player" &&
    onlineSnapshot.seat === state.currentKingdom
  );
}

function cloneGameState(source: GameState): GameState {
  return {
    ...source,
    pieces: source.pieces.map((piece) => ({ ...piece })),
    legalMoves: [...source.legalMoves],
    checkedKingdoms: [...source.checkedKingdoms],
    defeatedKingdoms: [...source.defeatedKingdoms],
    options: { ...source.options },
    moveHistory: source.moveHistory?.map((move) => ({ ...move })) ?? [],
  };
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
  const duration = learningSession ? (capturedPiece ? 80 : 56) : capturedPiece ? 820 : 680;

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

async function playOnlineMoveAnimation(previousState: GameState, nextState: GameState): Promise<boolean> {
  const move = latestMoveRecord(nextState);

  if (!move) {
    return false;
  }

  const moveKey = onlineMoveKey(move);

  if (moveKey === lastAnimatedOnlineMoveKey || sameMoveRecord(latestMoveRecord(previousState), move)) {
    return false;
  }

  lastAnimatedOnlineMoveKey = moveKey;

  const movingPiece = previousState.pieces.find((piece) => piece.id === move.pieceId);

  if (!movingPiece || movingPiece.position !== move.from) {
    lastAnimatedOnlineMoveKey = moveKey;
    return false;
  }

  const capturedPiece = move.capturedPieceId
    ? previousState.pieces.find((piece) => piece.id === move.capturedPieceId) ?? null
    : previousState.pieces.find((piece) => piece.id !== move.pieceId && piece.position === move.target && piece.blocksMovement) ?? null;

  state = {
    ...previousState,
    selectedPieceId: null,
    legalMoves: [],
  };
  await playMoveAnimation(movingPiece, capturedPiece, move.target);
  currentAnimation = null;
  isAnimating = false;

  return true;
}

function latestMoveRecord(source: GameState): MoveRecord | null {
  return source.moveHistory?.at(-1) ?? null;
}

function onlineMoveKey(move: MoveRecord): string {
  return `${move.kingdom}:${move.pieceId}:${move.from}:${move.target}:${move.capturedPieceId ?? "-"}`;
}

function sameMoveRecord(left: MoveRecord | null, right: MoveRecord): boolean {
  return (
    left?.kingdom === right.kingdom &&
    left.pieceId === right.pieceId &&
    left.from === right.from &&
    left.target === right.target &&
    left.capturedPieceId === right.capturedPieceId
  );
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
  if (state.winner || !startScreen!.classList.contains("is-hidden")) {
    return false;
  }

  if (currentGameMode === "ai-learning") {
    return learningSession !== null && !learningSession.isTuning;
  }

  return currentGameMode === "ai" && state.currentKingdom !== humanKingdom;
}

function connectOnlineSocket(pathSuffix = ""): void {
  if (onlineSocket && (onlineSocket.readyState === WebSocket.OPEN || onlineSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  onlineConnectionState = "connecting";
  syncOnlineControls();
  onlineSocket = new WebSocket(onlineWebSocketUrl(pathSuffix));

  onlineSocket.addEventListener("open", () => {
    onlineConnectionState = "connected";
    onlineHeartbeatTimer = setInterval(() => sendOnlineMessage({ type: "ping" }), 30_000);
    syncOnlineControls();
  });

  onlineSocket.addEventListener("message", (event) => {
    handleOnlineMessage(event.data);
  });

  onlineSocket.addEventListener("close", () => {
    clearInterval(onlineHeartbeatTimer!);
    onlineHeartbeatTimer = null;
    onlineConnectionState = "disconnected";
    onlinePendingMoveId = null;
    syncOnlineControls();
    render();
  });

  onlineSocket.addEventListener("error", () => {
    onlineConnectionState = "disconnected";
    onlineRoomOutput!.textContent = "联机服务连接失败，请确认服务已启动。";
    syncOnlineControls();
  });
}

function sendOnlineMessage(message: ClientOnlineMessage): void {
  if (!onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) {
    onlineSocket?.addEventListener(
      "open",
      () => {
        onlineSocket?.send(JSON.stringify(message));
      },
      { once: true },
    );
    return;
  }

  onlineSocket.send(JSON.stringify(message));
}

function handleOnlineMessage(raw: unknown): void {
  let message: ServerOnlineMessage;

  try {
    message = JSON.parse(String(raw)) as ServerOnlineMessage;
  } catch {
    onlineRoomOutput!.textContent = "收到无法解析的联机消息。";
    return;
  }

  switch (message.type) {
    case "roomJoined":
    case "roomState":
      void applyOnlineSnapshot(message.snapshot);
      return;
    case "moveAccepted":
      onlinePendingMoveId = null;
      void applyOnlineSnapshot(message.snapshot);
      return;
    case "moveRejected":
      if (onlinePendingMoveId === message.clientMoveId) {
        onlinePendingMoveId = null;
      }

      state = { ...state, selectedPieceId: null, legalMoves: [], lastMoveMessage: message.reason };
      onlineRoomOutput!.textContent = message.reason;
      render();
      return;
    case "playerList":
      if (onlineSnapshot) {
        onlineSnapshot = { ...onlineSnapshot, players: message.players, spectators: message.spectators };
        syncOnlineControls();
        render();
      }
      return;
    case "error":
      onlineRoomOutput!.textContent = message.message;
      return;
    case "pong":
      return;
  }
}

async function applyOnlineSnapshot(snapshot: OnlineRoomSnapshot): Promise<void> {
  const previousState = state;
  const nextState = {
    ...snapshot.gameState,
    selectedPieceId: null,
    legalMoves: [],
  };
  const animated = await playOnlineMoveAnimation(previousState, nextState);

  onlineSnapshot = snapshot;
  state = nextState;
  currentGameMode = "online";
  if (!animated) {
    currentAnimation = null;
    isAnimating = false;
  }
  clearAiTimer();
  stopThinkingLoop();
  isAiThinking = false;
  startScreen!.classList.add("is-hidden");
  onlineRoomCodeInput!.value = snapshot.roomCode;
  syncOnlineControls();
  render();
}

function submitOnlineMove(pieceId: string, target: PointId): void {
  if (!onlineSnapshot || onlinePendingMoveId !== null) {
    return;
  }

  onlinePendingMoveId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  state = {
    ...state,
    selectedPieceId: null,
    legalMoves: [],
    lastMoveMessage: "已提交走子，等待服务器确认。",
  };
  render();
  sendOnlineMessage({
    type: "submitMove",
    roomCode: onlineSnapshot.roomCode,
    playerId: getOnlinePlayerId(),
    pieceId,
    target,
    clientMoveId: onlinePendingMoveId,
  });
}

async function handleOnlineExitRequest(): Promise<void> {
  if (!onlineSnapshot) {
    leaveOnlineRoom();
    return;
  }

  const shouldForfeit = onlineSnapshot.role === "player" && onlineSnapshot.phase === "playing" && !onlineSnapshot.gameState.winner;
  const confirmed = await showConfirmDialog({
    title: shouldForfeit ? "退出将判负" : "退出房间",
    message: shouldForfeit ? "主动退出联机对局会判为认输，确认退出吗？" : "确认退出当前联机房间吗？",
    okText: shouldForfeit ? "退出并认输" : "退出房间",
  });

  if (!confirmed) {
    return;
  }

  if (shouldForfeit) {
    forfeitOnlineRoom();
    return;
  }

  leaveOnlineRoom();
  resetToStartScreen();
}

function showConfirmDialog(options: { title: string; message: string; okText: string }): Promise<boolean> {
  if (pendingConfirmResolve) {
    resolveConfirmDialog(false);
  }

  confirmTitle!.textContent = options.title;
  confirmMessage!.textContent = options.message;
  confirmOkButton!.textContent = options.okText;
  confirmDialog!.hidden = false;
  confirmCancelButton!.focus();

  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
  });
}

function resolveConfirmDialog(confirmed: boolean): void {
  if (!pendingConfirmResolve) {
    return;
  }

  const resolve = pendingConfirmResolve;

  pendingConfirmResolve = null;
  confirmDialog!.hidden = true;
  resolve(confirmed);
}

function forfeitOnlineRoom(): void {
  if (!onlineSnapshot) {
    return;
  }

  sendOnlineMessage({
    type: "forfeitRoom",
    roomCode: onlineSnapshot.roomCode,
    playerId: getOnlinePlayerId(),
  });
  onlineRoomOutput!.textContent = "已退出联机对局，本方判负。";
  window.setTimeout(() => {
    onlineSocket?.close();
    resetOnlineSession();
    resetToStartScreen();
  }, 80);
}

function leaveOnlineRoom(): void {
  if (onlineSnapshot) {
    sendOnlineMessage({
      type: "leaveRoom",
      roomCode: onlineSnapshot.roomCode,
      playerId: getOnlinePlayerId(),
    });
  }

  onlineSocket?.close();
  resetOnlineSession();
}

function resetOnlineSession(): void {
  clearInterval(onlineHeartbeatTimer!);
  onlineHeartbeatTimer = null;
  onlineSocket = null;
  onlineSnapshot = null;
  onlinePendingMoveId = null;
  onlineConnectionState = "idle";
  onlineRoomOutput!.textContent = "";
  syncOnlineControls();
}

function resetToStartScreen(): void {
  clearAiTimer();
  stopThinkingLoop();
  stopLearningSession();
  isAiThinking = false;
  isAnimating = false;
  currentAnimation = null;
  undoSnapshot = null;
  startScreen!.classList.remove("is-hidden");
  render();
}

function syncOnlineControls(): void {
  if (!onlineSnapshot) {
    return;
  }

  const players = onlineSnapshot.players
    .map((player) => `${player.seat ? kingdomName(player.seat) : "?"}:${player.connected ? player.name : `${player.name}(离线)`}`)
    .join(" / ");
  const seatText = onlineSnapshot.role === "player" && onlineSnapshot.seat ? `你执${kingdomName(onlineSnapshot.seat)}` : "你正在观战";
  const phaseText =
    onlineSnapshot.phase === "waiting"
      ? `等待玩家中 ${onlineSnapshot.players.length}/3`
      : onlineSnapshot.phase === "finished" && onlineSnapshot.gameState.winner
      ? `对局结束，${kingdomName(onlineSnapshot.gameState.winner)}获胜`
      : `轮到${kingdomName(onlineSnapshot.gameState.currentKingdom)}`;

  onlineRoomOutput!.textContent = `房间码：${onlineSnapshot.roomCode} · ${seatText} · ${phaseText}\n玩家：${players || "暂无"} · 观战：${onlineSnapshot.spectators.length}`;
}

function getOnlinePlayerId(): string {
  const storageKey = "three-player-chinese-chess.online-player-id";
  const stored = window.localStorage.getItem(storageKey);

  if (stored) {
    return stored;
  }

  const playerId = crypto.randomUUID();
  window.localStorage.setItem(storageKey, playerId);

  return playerId;
}

function onlineWebSocketUrl(pathSuffix = ""): string {
  const configuredUrl = import.meta.env.VITE_ONLINE_WS_URL as string | undefined;

  if (configuredUrl) {
    return configuredUrl + pathSuffix;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const devPort = window.location.port === "5173" ? "4173" : window.location.port;

  return `${protocol}//${window.location.hostname}${devPort ? `:${devPort}` : ""}/ws${pathSuffix}`;
}

function startLearningSession(): void {
  clearAiTimer();
  stopThinkingLoop();

  const totalRounds = clampNumber(Number(aiLearningRoundsInput!.value || 10), 1, 200);
  const intensity = readLearningIntensity();

  currentGameMode = "ai-learning";
  isAiThinking = false;
  isAnimating = false;
  currentAnimation = null;
  aiStartLearningButton!.disabled = true;
  learningSession = {
    totalRounds,
    intensity,
    config: learningConfig(intensity),
    currentRound: 0,
    startedAt: performance.now(),
    roundStartedAt: performance.now(),
    plies: 0,
    records: [],
    moves: [],
    positions: new Map(),
    maxRepetition: 0,
    isTuning: false,
    random: seededRandom(Date.now() % 4294967296),
  };
  aiLearningOutput!.textContent = `AI自动对弈自我提升已启动：${totalRounds}轮，${learningIntensityName(intensity)}。`;
  startScreen!.classList.add("is-hidden");
  startLearningRound();
}

function stopLearningSession(): void {
  if (!learningSession) {
    aiStartLearningButton!.disabled = false;
    return;
  }

  persistLearningHistory(learningSession);
  learningSession = null;
  aiStartLearningButton!.disabled = false;
}

function startLearningRound(): void {
  const session = learningSession;

  if (!session) {
    return;
  }

  if (session.currentRound >= session.totalRounds) {
    finishLearningSession();
    return;
  }

  session.currentRound += 1;
  session.roundStartedAt = performance.now();
  session.plies = 0;
  session.moves = [];
  session.positions = new Map();
  session.maxRepetition = 0;
  session.isTuning = false;
  state = createInitialGameState({ defeatCondition: "capture", defeatedPieceMode: "block" });
  state = {
    ...state,
    checkedKingdoms: getCheckedKingdoms(state),
    lastMoveMessage: `第${session.currentRound}轮自动对弈开始`,
  };
  render();
  scheduleAiTurn();
}

async function handleLearningMoveCompleted(): Promise<void> {
  const session = learningSession;

  if (!session) {
    return;
  }

  const elapsed = performance.now() - session.roundStartedAt;
  const key = boardStateKey();
  const repetition = (session.positions.get(key) ?? 0) + 1;

  session.positions.set(key, repetition);
  session.maxRepetition = Math.max(session.maxRepetition, repetition);

  if (state.winner) {
    await finishLearningRound("winner");
    return;
  }

  if (elapsed >= session.config.timeLimitMs) {
    await finishLearningRound("timeout");
    return;
  }

  if (repetition >= 3) {
    await finishLearningRound("repetition");
    return;
  }

  if (session.plies >= session.config.maxPlies) {
    await finishLearningRound("ply-limit");
    return;
  }

  scheduleAiTurn();
}

async function finishLearningRound(reason: LearningEndReason): Promise<void> {
  const session = learningSession;

  if (!session) {
    return;
  }

  clearAiTimer();
  isAiThinking = false;
  stopThinkingLoop();

  const winner = state.winner ?? adjudicateLearningWinner();
  state = {
    ...state,
    winner,
    selectedPieceId: null,
    legalMoves: [],
    lastMoveMessage:
      reason === "winner"
        ? `第${session.currentRound}轮结束：${kingdomName(winner)}获胜`
        : `第${session.currentRound}轮${learningEndReasonName(reason)}，裁定${kingdomName(winner)}获胜`,
  };
  session.isTuning = true;
  render();
  await nextFrame();

  const baseline = runAiBenchmark(activeAiProfile);
  const result = tuneAiProfile(activeAiProfile, {
    iterations: session.config.tuneIterations,
    seed: Math.floor((Date.now() + session.currentRound * 9973) % 4294967296),
    benchmark: {
      selfPlayGames: session.intensity === "deep" ? 12 : session.intensity === "normal" ? 9 : 6,
      maxPlies: session.config.maxPlies,
    },
  });
  const gain = result.report.score - baseline.score;
  const applied = gain >= 0 && result.report.scenario.failures.length === 0;

  if (applied) {
    activeAiProfile = result.profile;
    window.localStorage.setItem(aiProfileStorageKey, JSON.stringify(activeAiProfile));
  }

  session.records.push({
    round: session.currentRound,
    winner,
    reason,
    plies: session.plies,
    durationMs: Math.round(performance.now() - session.roundStartedAt),
    baselineScore: baseline.score,
    candidateScore: result.report.score,
    gain,
    applied,
    scenario: `${result.report.scenario.passed}/${result.report.scenario.total}`,
    styles: learningStyleLabels(),
    timeBudgetMs: session.config.timeBudgetMs,
    repetitions: session.maxRepetition,
    benchmarkSummary: benchmarkSummary(result.report),
    rejectedCandidates: result.rejected.length,
    moves: [...session.moves],
  });
  persistLearningHistory(session);
  aiLearningOutput!.textContent = formatLearningProgress(session);
  session.isTuning = false;
  render();
  window.setTimeout(startLearningRound, 160);
}

function finishLearningSession(): void {
  const session = learningSession;

  if (!session) {
    return;
  }

  persistLearningHistory(session);
  aiLearningOutput!.textContent = formatLearningProgress(session, true);
  learningSession = null;
  aiStartLearningButton!.disabled = false;
  currentGameMode = "ai";
  startScreen!.classList.remove("is-hidden");
  render();
}

function readLearningIntensity(): LearningIntensity {
  const selected = document.querySelector<HTMLInputElement>("input[name='ai-learning-intensity']:checked");

  return (selected?.value ?? "normal") as LearningIntensity;
}

function learningConfig(intensity: LearningIntensity): LearningConfig {
  activeAiProfile = profileForIntensity(intensity);

  switch (intensity) {
    case "fast":
      return {
        depth: 1,
        openingDepth: 1,
        timeBudgetMs: 500,
        tuneIterations: 6,
        timeLimitMs: 2 * 60 * 1000,
        moveDelayMs: 10,
        maxPlies: 180,
        explorationRate: 0.48,
        explorationTop: 8,
        explorationSlack: 1_300,
        explorationTemperature: 820,
      };
    case "deep":
      return {
        depth: 3,
        openingDepth: 2,
        timeBudgetMs: 1_800,
        tuneIterations: 18,
        timeLimitMs: 5 * 60 * 1000,
        moveDelayMs: 24,
        maxPlies: 300,
        explorationRate: 0.3,
        explorationTop: 5,
        explorationSlack: 850,
        explorationTemperature: 520,
      };
    case "normal":
      return {
        depth: 2,
        openingDepth: 1,
        timeBudgetMs: 1_000,
        tuneIterations: 10,
        timeLimitMs: 3 * 60 * 1000,
        moveDelayMs: 16,
        maxPlies: 240,
        explorationRate: 0.38,
        explorationTop: 6,
        explorationSlack: 1_050,
        explorationTemperature: 660,
      };
  }
}

function profileForIntensity(intensity: LearningIntensity): AiProfile {
  const base = cloneAiProfile(readStoredAiProfile());

  switch (intensity) {
    case "fast":
      return {
        ...base,
        searchDepth: 1,
        rootBeam: 8,
        responseBeam: 3,
        thirdPlayerBeam: 2,
        safetyScanLimit: 14,
      };
    case "deep":
      return {
        ...base,
        searchDepth: 3,
        rootBeam: 16,
        responseBeam: 6,
        thirdPlayerBeam: 4,
        safetyScanLimit: 24,
      };
    case "normal":
      return {
        ...base,
        searchDepth: 2,
        rootBeam: 12,
        responseBeam: 5,
        thirdPlayerBeam: 3,
        safetyScanLimit: 18,
      };
  }
}

function intensityForDifficulty(difficulty: AiDifficulty): LearningIntensity {
  switch (difficulty) {
    case "easy":
      return "fast";
    case "hard":
      return "deep";
    case "medium":
      return "normal";
  }
}

function aiMoveOptionsForDifficulty(difficulty: AiDifficulty, kingdom: Kingdom): AiMoveOptions {
  switch (difficulty) {
    case "easy":
      return {
        style: aiStyleForKingdom(kingdom),
        timeBudgetMs: 2_000,
        maxDepth: 1,
        openingSearchDepth: 1,
        openingRootBeam: 5,
        openingResponseBeam: 2,
        openingThirdPlayerBeam: 1,
      };
    case "hard":
      return {
        style: aiStyleForKingdom(kingdom),
        timeBudgetMs: 10_000,
        maxDepth: 3,
        openingSearchDepth: 2,
        openingRootBeam: 12,
        openingResponseBeam: 4,
        openingThirdPlayerBeam: 2,
      };
    case "medium":
      return {
        style: aiStyleForKingdom(kingdom),
        timeBudgetMs: 5_000,
        maxDepth: 2,
        openingSearchDepth: 1,
        openingRootBeam: 8,
        openingResponseBeam: 3,
        openingThirdPlayerBeam: 1,
      };
  }
}

function aiLearningMoveOptions(kingdom: Kingdom, session: LearningSession): AiMoveOptions {
  return {
    style: aiStyleForKingdom(kingdom),
    seed: Math.floor(session.random() * 4294967296),
    timeBudgetMs: session.config.timeBudgetMs,
    maxDepth: session.config.depth,
    explorationRate: session.config.explorationRate,
    explorationTop: session.config.explorationTop,
    explorationSlack: session.config.explorationSlack,
    explorationTemperature: session.config.explorationTemperature,
    openingSearchDepth: session.config.openingDepth,
  };
}

function difficultyForIntensity(intensity: LearningIntensity): AiDifficulty {
  switch (intensity) {
    case "fast":
      return "easy";
    case "deep":
      return "hard";
    case "normal":
      return "medium";
  }
}

function adjudicateLearningWinner(): Kingdom {
  const kingdoms: Kingdom[] = ["wei", "shu", "wu"];
  const activeKingdoms = kingdoms.filter((kingdom) => !state.defeatedKingdoms.includes(kingdom));
  const candidates = activeKingdoms.length ? activeKingdoms : kingdoms;

  return candidates
    .map((kingdom) => ({ kingdom, score: evaluateAiState(state, kingdom, activeAiProfile) }))
    .sort((left, right) => right.score - left.score || left.kingdom.localeCompare(right.kingdom))[0].kingdom;
}

function boardStateKey(): string {
  const pieces = state.pieces
    .filter((piece) => piece.blocksMovement)
    .map((piece) => `${piece.id}:${piece.position}:${piece.controller}:${piece.defeated ? 1 : 0}`)
    .sort()
    .join("|");

  return `${state.currentKingdom}|${pieces}`;
}

function formatMoveLog(kingdom: Kingdom, move: AiMove): string {
  const movedPiece = state.pieces.find((piece) => piece.id === move.pieceId);

  return `${kingdomName(kingdom)}${movedPiece?.label ?? "棋"} ${move.from}-${move.target}`;
}

function formatLearningProgress(session: LearningSession, done = false): string {
  const last = session.records.at(-1);
  const winners = session.records.reduce<Record<Kingdom, number>>(
    (current, record) => {
      current[record.winner] += 1;
      return current;
    },
    { wei: 0, shu: 0, wu: 0 },
  );
  const summary = [
    done ? "AI自动对弈自我提升完成" : `第${last?.round ?? session.currentRound}轮已完成`,
    `进度：${session.records.length}/${session.totalRounds}轮`,
    `强度：${learningIntensityName(session.intensity)}，搜索深度：${session.config.depth}，开局深度：${session.config.openingDepth}`,
    `胜者统计：魏 ${winners.wei} / 蜀 ${winners.shu} / 吴 ${winners.wu}`,
  ];

  if (last) {
    summary.push(
      `最近一轮：${kingdomName(last.winner)}获胜，${learningEndReasonName(last.reason)}，${last.plies}步，调参${last.applied ? "已导入" : "未导入"}，评分变化 ${last.gain}`,
      `回归场景：${last.scenario}`,
      `自博弈：${last.benchmarkSummary}`,
    );
  }

  summary.push(`学习记录已保存：localStorage.${aiLearningHistoryStorageKey}`);

  return summary.join("\n");
}

function learningStyleLabels(): Record<Kingdom, string> {
  return {
    wei: aiStyleForKingdom("wei").label,
    shu: aiStyleForKingdom("shu").label,
    wu: aiStyleForKingdom("wu").label,
  };
}

function benchmarkSummary(report: ReturnType<typeof runAiBenchmark>): string {
  return [
    `${report.selfPlay.games}局`,
    `自然胜${report.selfPlay.naturalWins}`,
    `重复${report.selfPlay.repetitionStops}`,
    `多样性${report.selfPlay.openingDiversity}`,
    `安全${report.selfPlay.averageSafety}`,
  ].join(" / ");
}

function persistLearningHistory(session: LearningSession): void {
  const payload = {
    savedAt: new Date().toISOString(),
    totalRounds: session.totalRounds,
    completedRounds: session.records.length,
    intensity: session.intensity,
    difficulty: difficultyForIntensity(session.intensity),
    config: session.config,
    records: session.records,
    profile: activeAiProfile,
  };

  window.localStorage.setItem(aiLearningHistoryStorageKey, JSON.stringify(payload));
  syncLearningDownloadButton();
}

function syncLearningDownloadButton(): void {
  aiDownloadLearningButton!.disabled = !window.localStorage.getItem(aiLearningHistoryStorageKey);
}

function downloadLearningData(): void {
  const storedHistory = window.localStorage.getItem(aiLearningHistoryStorageKey);

  if (!storedHistory) {
    aiLearningOutput!.textContent = "暂无可下载的自学习数据。请先完成至少一轮自学习。";
    syncLearningDownloadButton();
    return;
  }

  let parsedHistory: { savedAt?: string };

  try {
    parsedHistory = JSON.parse(storedHistory) as { savedAt?: string };
  } catch {
    window.localStorage.removeItem(aiLearningHistoryStorageKey);
    aiLearningOutput!.textContent = "自学习数据已损坏，已清除。请重新运行自学习。";
    syncLearningDownloadButton();
    return;
  }

  const savedAt = parsedHistory.savedAt ?? new Date().toISOString();
  const filename = `three-player-chess-ai-learning-${savedAt.replace(/[:.]/g, "-")}.json`;
  const blob = new Blob([`${JSON.stringify(parsedHistory, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  aiLearningOutput!.textContent = `学习数据已生成下载文件：${filename}\n建议保存到项目目录 ai-learning-exports/，后续可以把该 JSON 提供给我继续迭代。`;
}

function learningIntensityName(intensity: LearningIntensity): string {
  return {
    fast: "简单（快速）",
    normal: "中等（常规）",
    deep: "困难（深度）",
  }[intensity];
}

function learningEndReasonName(reason: LearningEndReason): string {
  return {
    winner: "正常胜负",
    timeout: "超时",
    repetition: "重复局面",
    "ply-limit": "步数过长",
    "no-move": "无可行棋",
  }[reason];
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed;

  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function readStoredAiProfile(): AiProfile {
  const storedProfile = window.localStorage.getItem(aiProfileStorageKey);

  if (!storedProfile) {
    return cloneAiProfile(defaultAiProfile);
  }

  try {
    const baseProfile = cloneAiProfile(defaultAiProfile);
    const parsedProfile = JSON.parse(storedProfile) as Partial<AiProfile>;

    return {
      ...baseProfile,
      ...parsedProfile,
      pieceValues: {
        ...baseProfile.pieceValues,
        ...parsedProfile.pieceValues,
      },
      scoring: {
        ...baseProfile.scoring,
        ...parsedProfile.scoring,
      },
    };
  } catch {
    window.localStorage.removeItem(aiProfileStorageKey);
    return cloneAiProfile(defaultAiProfile);
  }
}

function cloneAiProfile(profile: AiProfile): AiProfile {
  return JSON.parse(JSON.stringify(profile)) as AiProfile;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
