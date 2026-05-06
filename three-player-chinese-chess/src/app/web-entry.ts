import "../styles.css";
import type { Kingdom, PointId } from "../core/board";
import { chooseAiMove, evaluateAiState, type AiMove } from "../core/ai";
import { defaultAiProfile, type AiProfile } from "../core/ai-profile";
import { runAiBenchmark, tuneAiProfile } from "../core/ai-lab";
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
const aiStartLearningButton = document.querySelector<HTMLButtonElement>("#ai-start-learning");
const aiLearningRoundsInput = document.querySelector<HTMLInputElement>("#ai-learning-rounds");
const aiLearningOutput = document.querySelector<HTMLOutputElement>("#ai-learning-output");

if (!canvas || !status || !startScreen || !startButton || !settingsButton || !aiStartLearningButton || !aiLearningRoundsInput || !aiLearningOutput) {
  throw new Error("Board canvas was not found.");
}

type GameMode = "ai" | "online" | "ai-learning";
type LearningIntensity = "fast" | "normal" | "deep";
type LearningEndReason = "winner" | "timeout" | "repetition" | "ply-limit" | "no-move";

interface LearningConfig {
  depth: number;
  tuneIterations: number;
  timeLimitMs: number;
  moveDelayMs: number;
  maxPlies: number;
  explorationRate: number;
  explorationTop: number;
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
  isTuning: boolean;
  random: () => number;
}

const humanKingdom: Kingdom = "wei";
const aiProfileStorageKey = "three-player-chinese-chess.ai-profile";
const aiLearningHistoryStorageKey = "three-player-chinese-chess.ai-learning-history";
let currentGameMode: GameMode = "ai";
let aiTimer: number | null = null;
let isAiThinking = false;
let isAnimating = false;
let thinkingPhase = 0;
let thinkingFrame: number | null = null;
let currentAnimation: BoardAnimation | null = null;
let activeAiProfile = readStoredAiProfile();
let learningSession: LearningSession | null = null;
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
  stopLearningSession();
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
  stopLearningSession();
  isAiThinking = false;
  isAnimating = false;
  currentAnimation = null;
  startScreen.classList.remove("is-hidden");
  render();
});

aiStartLearningButton.addEventListener("click", () => {
  startLearningSession();
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
  const move = learningSession
    ? chooseAiMove(state, kingdom, activeAiProfile, {
        random: learningSession.random,
        explorationRate: learningSession.config.explorationRate,
        explorationTop: learningSession.config.explorationTop,
      })
    : chooseAiMove(state, kingdom, activeAiProfile);

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
  const base = cloneAiProfile(activeAiProfile);

  switch (intensity) {
    case "fast":
      activeAiProfile = {
        ...base,
        searchDepth: 1,
        rootBeam: Math.min(base.rootBeam, 8),
        responseBeam: Math.min(base.responseBeam, 3),
        thirdPlayerBeam: Math.min(base.thirdPlayerBeam, 2),
      };
      return { depth: 1, tuneIterations: 6, timeLimitMs: 2 * 60 * 1000, moveDelayMs: 10, maxPlies: 180, explorationRate: 0.34, explorationTop: 4 };
    case "deep":
      activeAiProfile = {
        ...base,
        searchDepth: Math.max(base.searchDepth, 3),
        rootBeam: Math.max(base.rootBeam, 16),
        responseBeam: Math.max(base.responseBeam, 6),
        thirdPlayerBeam: Math.max(base.thirdPlayerBeam, 4),
      };
      return { depth: 3, tuneIterations: 18, timeLimitMs: 5 * 60 * 1000, moveDelayMs: 24, maxPlies: 300, explorationRate: 0.18, explorationTop: 3 };
    case "normal":
      activeAiProfile = {
        ...base,
        searchDepth: Math.max(base.searchDepth, 2),
      };
      return { depth: 2, tuneIterations: 10, timeLimitMs: 3 * 60 * 1000, moveDelayMs: 16, maxPlies: 240, explorationRate: 0.24, explorationTop: 3 };
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
    `强度：${learningIntensityName(session.intensity)}，搜索深度：${session.config.depth}`,
    `胜者统计：魏 ${winners.wei} / 蜀 ${winners.shu} / 吴 ${winners.wu}`,
  ];

  if (last) {
    summary.push(
      `最近一轮：${kingdomName(last.winner)}获胜，${learningEndReasonName(last.reason)}，${last.plies}步，调参${last.applied ? "已导入" : "未导入"}，评分变化 ${last.gain}`,
      `回归场景：${last.scenario}`,
    );
  }

  summary.push(`学习记录已保存：localStorage.${aiLearningHistoryStorageKey}`);

  return summary.join("\n");
}

function persistLearningHistory(session: LearningSession): void {
  const payload = {
    savedAt: new Date().toISOString(),
    totalRounds: session.totalRounds,
    completedRounds: session.records.length,
    intensity: session.intensity,
    config: session.config,
    records: session.records,
    profile: activeAiProfile,
  };

  window.localStorage.setItem(aiLearningHistoryStorageKey, JSON.stringify(payload));
}

function learningIntensityName(intensity: LearningIntensity): string {
  return {
    fast: "快速",
    normal: "常规",
    deep: "深度",
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
