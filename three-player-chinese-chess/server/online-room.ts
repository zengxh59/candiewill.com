import type { Kingdom, PointId } from "../src/core/board";
import { createInitialGameState, type GameOptions, type GameState } from "../src/core/game-state";
import { applyMove, resignKingdom } from "../src/core/rules";
import { getCheckedKingdoms } from "../src/core/moves";
import { onlineSeatOrder, type OnlineParticipant, type OnlineRole, type OnlineRoomPhase, type OnlineRoomSnapshot } from "../src/online/protocol";

const reconnectWindowMs = 2 * 60 * 1000;
const roomCodeAlphabet = "0123456789";

export interface OnlineRoom {
  roomCode: string;
  phase: OnlineRoomPhase;
  state: GameState;
  options: GameOptions;
  participants: Map<string, OnlineParticipant>;
  createdAt: number;
  updatedAt: number;
}

export interface JoinResult {
  room: OnlineRoom;
  participant: OnlineParticipant;
  snapshot: OnlineRoomSnapshot;
  reconnected: boolean;
}

export interface MoveResult {
  ok: boolean;
  room?: OnlineRoom;
  snapshot?: OnlineRoomSnapshot;
  reason?: string;
}

export interface ForfeitResult {
  ok: boolean;
  room?: OnlineRoom;
  snapshot?: OnlineRoomSnapshot;
  reason?: string;
}

export class OnlineRoomManager {
  private readonly rooms = new Map<string, OnlineRoom>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  createRoom(playerId: string, name: string | undefined, options: GameOptions): JoinResult {
    const roomCode = this.createRoomCode();
    const initialState = createInitialGameState(options);
    const room: OnlineRoom = {
      roomCode,
      phase: "waiting",
      state: {
        ...initialState,
        checkedKingdoms: getCheckedKingdoms(initialState),
      },
      options,
      participants: new Map(),
      createdAt: this.now(),
      updatedAt: this.now(),
    };

    this.rooms.set(roomCode, room);
    return this.joinExistingRoom(roomCode, playerId, name);
  }

  joinRoom(roomCode: string, playerId: string, name?: string): JoinResult {
    const normalizedRoomCode = normalizeRoomCode(roomCode);

    if (!isValidRoomCode(normalizedRoomCode)) {
      throw new Error("房间码需为 5 位数字。");
    }

    return this.joinExistingRoom(normalizedRoomCode, playerId, name);
  }

  leaveRoom(roomCode: string, playerId: string): OnlineRoom | null {
    const room = this.rooms.get(normalizeRoomCode(roomCode));
    const participant = room?.participants.get(playerId);

    if (!room || !participant) {
      return null;
    }

    participant.connected = false;
    participant.disconnectedAt = this.now();
    room.updatedAt = this.now();
    this.syncPhase(room);

    return room;
  }

  submitMove(roomCode: string, playerId: string, pieceId: string, target: PointId): MoveResult {
    const room = this.rooms.get(normalizeRoomCode(roomCode));

    if (!room) {
      return { ok: false, reason: "房间不存在或已过期。" };
    }

    const participant = room.participants.get(playerId);

    if (!participant || participant.role !== "player" || !participant.seat) {
      return { ok: false, reason: "只有入座玩家可以行棋。" };
    }

    if (room.state.defeatedKingdoms.includes(participant.seat)) {
      return { ok: false, reason: "你已经出局，不能继续行棋。" };
    }

    if (!participant.connected) {
      return { ok: false, reason: "连接已断开，请重连后再行棋。" };
    }

    if (room.phase !== "playing") {
      return { ok: false, reason: room.phase === "waiting" ? "三名玩家到齐后才能开始。" : "对局已经结束。" };
    }

    const activePlayers = this.activePlayers(room);

    if (activePlayers.some((player) => !player.connected)) {
      return { ok: false, reason: "有玩家暂时离线，对局已暂停。" };
    }

    if (participant.seat !== room.state.currentKingdom) {
      return { ok: false, reason: "还没有轮到你行棋。" };
    }

    try {
      const nextState = applyMove(room.state, pieceId, target);
      room.state = nextState;
      room.updatedAt = this.now();
      this.syncPhase(room);

      return { ok: true, room, snapshot: this.snapshot(room, playerId) };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "走子无效。" };
    }
  }

  forfeitRoom(roomCode: string, playerId: string): ForfeitResult {
    const room = this.rooms.get(normalizeRoomCode(roomCode));

    if (!room) {
      return { ok: false, reason: "房间不存在或已过期。" };
    }

    const participant = room.participants.get(playerId);

    if (!participant || participant.role !== "player" || !participant.seat) {
      return { ok: false, reason: "只有入座玩家会被判负。" };
    }

    if (room.phase === "finished") {
      return { ok: false, reason: "对局已经结束。" };
    }

    if (room.phase !== "playing") {
      participant.connected = false;
      participant.disconnectedAt = this.now();
      room.updatedAt = this.now();
      this.syncPhase(room);

      return { ok: true, room, snapshot: this.snapshot(room, playerId) };
    }

    room.state = resignKingdom(room.state, participant.seat);
    participant.connected = false;
    participant.disconnectedAt = this.now();
    room.updatedAt = this.now();
    this.syncPhase(room);

    return { ok: true, room, snapshot: this.snapshot(room, playerId) };
  }

  snapshot(room: OnlineRoom, viewerPlayerId: string): OnlineRoomSnapshot {
    const participant = room.participants.get(viewerPlayerId);

    return {
      roomCode: room.roomCode,
      phase: room.phase,
      gameState: room.state,
      players: this.players(room),
      spectators: this.spectators(room),
      seat: participant?.seat ?? null,
      role: participant?.role ?? "spectator",
      options: room.options,
      reconnectExpiresAt: participant?.disconnectedAt ? participant.disconnectedAt + reconnectWindowMs : null,
    };
  }

  room(roomCode: string): OnlineRoom | undefined {
    return this.rooms.get(normalizeRoomCode(roomCode));
  }

  cleanupExpiredParticipants(): OnlineRoom[] {
    const now = this.now();

    for (const room of this.rooms.values()) {
      const participants = [...room.participants.values()];
      const allExpired =
        participants.length > 0 &&
        participants.every((participant) => {
          return !participant.connected && participant.disconnectedAt !== null && now - participant.disconnectedAt > reconnectWindowMs;
        });

      if (allExpired) {
        this.rooms.delete(room.roomCode);
      }
    }

    return [];
  }

  private joinExistingRoom(roomCode: string, playerId: string, name?: string): JoinResult {
    const room = this.rooms.get(roomCode);

    if (!room) {
      throw new Error("房间不存在或已过期。");
    }

    const existing = room.participants.get(playerId);

    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.name = cleanName(name) ?? existing.name;
      room.updatedAt = this.now();
      this.syncPhase(room);

      return {
        room,
        participant: existing,
        snapshot: this.snapshot(room, playerId),
        reconnected: true,
      };
    }

    const seat = this.nextOpenSeat(room);
    const role: OnlineRole = seat ? "player" : "spectator";
    const participant: OnlineParticipant = {
      playerId,
      name: cleanName(name) ?? defaultName(role, seat),
      seat,
      role,
      connected: true,
      joinedAt: this.now(),
      disconnectedAt: null,
    };

    room.participants.set(playerId, participant);
    room.updatedAt = this.now();
    this.syncPhase(room);

    return {
      room,
      participant,
      snapshot: this.snapshot(room, playerId),
      reconnected: false,
    };
  }

  private createRoomCode(): string {
    let roomCode = "";

    do {
      roomCode = Array.from({ length: 5 }, () => roomCodeAlphabet[Math.floor(Math.random() * roomCodeAlphabet.length)]).join("");
    } while (this.rooms.has(roomCode));

    return roomCode;
  }

  private nextOpenSeat(room: OnlineRoom): Kingdom | null {
    const occupiedSeats = new Set(this.players(room).map((player) => player.seat));

    return onlineSeatOrder.find((seat) => !occupiedSeats.has(seat)) ?? null;
  }

  private players(room: OnlineRoom): OnlineParticipant[] {
    return [...room.participants.values()]
      .filter((participant) => participant.role === "player")
      .sort((left, right) => onlineSeatOrder.indexOf(left.seat!) - onlineSeatOrder.indexOf(right.seat!));
  }

  private activePlayers(room: OnlineRoom): OnlineParticipant[] {
    return this.players(room).filter((participant) => {
      return participant.seat !== null && !room.state.defeatedKingdoms.includes(participant.seat);
    });
  }

  private spectators(room: OnlineRoom): OnlineParticipant[] {
    return [...room.participants.values()]
      .filter((participant) => participant.role === "spectator")
      .sort((left, right) => left.joinedAt - right.joinedAt);
  }

  private syncPhase(room: OnlineRoom): void {
    if (room.state.winner) {
      room.phase = "finished";
      return;
    }

    room.phase = this.players(room).length === onlineSeatOrder.length ? "playing" : "waiting";
  }
}

export function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim();
}

export function isValidRoomCode(roomCode: string): boolean {
  return /^\d{5}$/.test(roomCode);
}

function cleanName(name: string | undefined): string | null {
  const cleaned = name?.trim().slice(0, 16);

  return cleaned ? cleaned : null;
}

function defaultName(role: OnlineRole, seat: Kingdom | null): string {
  if (role === "spectator") {
    return "观战者";
  }

  return {
    wei: "魏国玩家",
    shu: "蜀国玩家",
    wu: "吴国玩家",
  }[seat!];
}
