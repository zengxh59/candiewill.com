import "../styles.css";
import type { Kingdom, PointId } from "../core/board";
import { chooseAiMove, type AiMove, type AiMoveOptions } from "../core/ai";
import { aiStyleForKingdom, defaultAiProfile } from "../core/ai-profile";
import {
  capturedPieceAt,
  createInitialGameState,
  nextActiveKingdom,
  pieceAt,
  type DefeatedPieceMode,
  type GameOptions,
  type GameState,
  type MoveRecord,
} from "../core/game-state";
import { getCheckedKingdoms, getLegalMoves } from "../core/moves";
import type { Piece } from "../core/pieces";
import { applyMove, kingdomName, resignKingdom } from "../core/rules";
import type { ClientOnlineMessage, OnlineRoomSnapshot, ServerOnlineMessage } from "../online/protocol";
import { drawBoard, type BoardAnimation } from "../renderer/canvas-board";
import { defaultGeometry, hitTestBoardPoint, pointIdPosition } from "../renderer/geometry";

const canvas = document.querySelector<HTMLCanvasElement>("#board");
const status = document.querySelector<HTMLDivElement>("#status");
const startScreen = document.querySelector<HTMLElement>("#start-screen");
const startButton = document.querySelector<HTMLButtonElement>("#start-game");
const settingsButton = document.querySelector<HTMLButtonElement>("#show-settings");
const undoButton = document.querySelector<HTMLButtonElement>("#undo-move");
const resignButton = document.querySelector<HTMLButtonElement>("#resign-game");
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
  !resignButton ||
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

type GameMode = "ai" | "online";
type AiDifficulty = "easy" | "medium" | "hard";

interface StartSettings {
  gameMode: GameMode;
  aiDifficulty: AiDifficulty;
  options: GameOptions;
}

const humanKingdom: Kingdom = "wei";
let currentGameMode: GameMode = "ai";
let currentAiDifficulty: AiDifficulty = "medium";
let aiTimer: number | null = null;
let isAiThinking = false;
let isAnimating = false;
let thinkingPhase = 0;
let thinkingFrame: number | null = null;
let currentAnimation: BoardAnimation | null = null;
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
  resignButton!.hidden = !(
    currentGameMode === "ai" &&
    !state.winner &&
    !state.defeatedKingdoms.includes(humanKingdom) &&
    startScreen!.classList.contains("is-hidden")
  );
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
  const settings = readStartSettings();
  currentGameMode = settings.gameMode;

  if (currentGameMode === "online") {
    startOnlineRoom(settings);
    return;
  }

  currentAiDifficulty = settings.aiDifficulty;
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

resignButton.addEventListener("click", () => {
  void handleResignRequest();
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
  const moveOptions = aiMoveOptionsForDifficulty(currentAiDifficulty, kingdom);
  const move = await requestAiMove(state, kingdom, moveOptions);

  if (!move) {
    isAiThinking = false;
    stopThinkingLoop();

    state = {
      ...state,
      lastMoveMessage: `${kingdomName(kingdom)}暂无可行棋子`,
      currentKingdom: nextActiveKingdom(kingdom, state.defeatedKingdoms),
    };
    render();
    scheduleAiTurn();
    return;
  }

  isAiThinking = false;
  stopThinkingLoop();
  await commitMove(move.pieceId, move.target, kingdom, "AI");
  scheduleAiTurn();
}

function requestAiMove(sourceState: GameState, kingdom: Kingdom, options: AiMoveOptions): Promise<AiMove | null> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(chooseAiMove(sourceState, kingdom, defaultAiProfile, options));
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
      finish(chooseAiMove(sourceState, kingdom, defaultAiProfile, { ...options, timeBudgetMs: Math.min(120, options.timeBudgetMs ?? 120) }));
    }, timeoutMs);

    try {
      worker = new Worker(new URL("./ai-worker.ts", import.meta.url), { type: "module" });
    } catch {
      window.clearTimeout(timeout);
      resolve(chooseAiMove(sourceState, kingdom, defaultAiProfile, options));
      return;
    }

    if (!worker) {
      window.clearTimeout(timeout);
      resolve(chooseAiMove(sourceState, kingdom, defaultAiProfile, options));
      return;
    }

    worker.addEventListener("message", (event: MessageEvent<{ id: number; move: AiMove | null; error?: string }>) => {
      if (event.data.id !== requestId) {
        return;
      }

      finish(event.data.error ? chooseAiMove(sourceState, kingdom, defaultAiProfile, { ...options, timeBudgetMs: 180 }) : event.data.move);
    });
    worker.addEventListener("error", () => {
      finish(chooseAiMove(sourceState, kingdom, defaultAiProfile, { ...options, timeBudgetMs: 180 }));
    });
    worker.postMessage({
      id: requestId,
      state: sourceState,
      kingdom,
      profile: defaultAiProfile,
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

async function handleResignRequest(): Promise<void> {
  const confirmed = await showConfirmDialog({
    title: "确认认输",
    message: "认输后将判为出局，本局结束。确定要认输吗？",
    okText: "确认认输",
  });

  if (!confirmed) {
    return;
  }

  clearAiTimer();
  stopThinkingLoop();
  isAiThinking = false;
  isAnimating = false;
  currentAnimation = null;
  undoSnapshot = null;

  state = resignKingdom(state, humanKingdom);
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
