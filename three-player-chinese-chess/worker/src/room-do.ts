import type { Kingdom, PointId } from "../../src/core/board";
import { createInitialGameState, type GameOptions, type GameState } from "../../src/core/game-state";
import { applyMove, resignKingdom } from "../../src/core/rules";
import { getCheckedKingdoms } from "../../src/core/moves";
import {
  onlineSeatOrder,
  type OnlineParticipant,
  type OnlineRole,
  type OnlineRoomPhase,
  type OnlineRoomSnapshot,
  type ClientOnlineMessage,
  type ServerOnlineMessage,
} from "../../src/online/protocol";

const reconnectWindowMs = 2 * 60 * 1000;

interface RoomState {
  roomCode: string;
  phase: OnlineRoomPhase;
  state: GameState;
  options: GameOptions;
  participants: Map<string, OnlineParticipant>;
}

interface SocketSession {
  playerId: string | null;
  pendingRoomCode: string | null;
}

export class RoomDO implements DurableObject {
  private room: RoomState | null = null;
  private sockets = new Map<WebSocket, SocketSession>();

  constructor(private ctx: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") !== "websocket") {
      if (url.pathname === "/check") {
        return new Response(this.room ? "exists" : "available", { status: this.room ? 200 : 404 });
      }
      return new Response("WebSocket endpoint", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    const roomCode = request.headers.get("X-Room-Code") ?? "";
    const action = request.headers.get("X-Action") ?? "join";

    this.ctx.acceptWebSocket(server);
    this.sockets.set(server, {
      playerId: null,
      pendingRoomCode: action === "create" ? roomCode : null,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string): void {
    let message: ClientOnlineMessage;

    try {
      message = JSON.parse(data) as ClientOnlineMessage;
    } catch {
      this.send(ws, { type: "error", message: "消息格式无效。" });
      return;
    }

    try {
      switch (message.type) {
        case "ping":
          this.send(ws, { type: "pong" });
          return;
        case "createRoom": {
          const session = this.sockets.get(ws);
          const roomCode = session?.pendingRoomCode;
          if (roomCode) {
            this.sockets.set(ws, { ...session!, pendingRoomCode: null });
          }
          this.handleCreateRoom(ws, message, roomCode ?? undefined);
          return;
        }
        case "joinRoom":
          this.handleJoinRoom(ws, message);
          return;
        case "leaveRoom": {
          const session = this.sockets.get(ws);
          if (session?.playerId) {
            this.disconnectPlayer(session.playerId);
          }
          this.sockets.set(ws, { playerId: null });
          return;
        }
        case "forfeitRoom": {
          this.handleForfeit(ws, message);
          return;
        }
        case "submitMove": {
          this.handleSubmitMove(ws, message);
          return;
        }
      }
    } catch (error) {
      this.send(ws, { type: "error", message: error instanceof Error ? error.message : "服务器处理失败。" });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const session = this.sockets.get(ws);
    this.sockets.delete(ws);

    if (session?.playerId) {
      this.disconnectPlayer(session.playerId);
    }
  }

  private handleCreateRoom(ws: WebSocket, msg: Extract<ClientOnlineMessage, { type: "createRoom" }>, overrideCode?: string): void {
    if (this.room) {
      this.send(ws, { type: "error", message: "房间已存在。" });
      return;
    }

    const roomCode = overrideCode ?? msg.playerId;
    const initialState = createInitialGameState(msg.options);

    this.room = {
      roomCode,
      phase: "waiting",
      state: { ...initialState, checkedKingdoms: getCheckedKingdoms(initialState) },
      options: msg.options,
      participants: new Map(),
    };

    this.joinRoomInternal(ws, msg.playerId, msg.name);
  }

  private handleJoinRoom(ws: WebSocket, msg: Extract<ClientOnlineMessage, { type: "joinRoom" }>): void {
    if (!this.room) {
      this.send(ws, { type: "error", message: "房间不存在或已过期。" });
      return;
    }

    this.joinRoomInternal(ws, msg.playerId, msg.name);
  }

  private joinRoomInternal(ws: WebSocket, playerId: string, name?: string): void {
    if (!this.room) return;

    const existing = this.room.participants.get(playerId);

    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.name = cleanName(name) ?? existing.name;
      this.sockets.set(ws, { playerId });
      this.send(ws, { type: "roomJoined", snapshot: this.snapshot(playerId) });
      this.broadcastRoom();
      return;
    }

    const seat = this.nextOpenSeat();
    const role: OnlineRole = seat ? "player" : "spectator";
    const participant: OnlineParticipant = {
      playerId,
      name: cleanName(name) ?? defaultName(role, seat),
      seat,
      role,
      connected: true,
      joinedAt: Date.now(),
      disconnectedAt: null,
    };

    this.room.participants.set(playerId, participant);
    this.sockets.set(ws, { playerId });
    this.syncPhase();
    this.send(ws, { type: "roomJoined", snapshot: this.snapshot(playerId) });
    this.broadcastRoom();
  }

  private handleSubmitMove(ws: WebSocket, msg: Extract<ClientOnlineMessage, { type: "submitMove" }>): void {
    if (!this.room) {
      this.send(ws, { type: "moveRejected", clientMoveId: msg.clientMoveId, reason: "房间不存在或已过期。" });
      return;
    }

    const participant = this.room.participants.get(msg.playerId);

    if (!participant || participant.role !== "player" || !participant.seat) {
      this.send(ws, { type: "moveRejected", clientMoveId: msg.clientMoveId, reason: "只有入座玩家可以行棋。" });
      return;
    }

    if (this.room.state.defeatedKingdoms.includes(participant.seat)) {
      this.send(ws, { type: "moveRejected", clientMoveId: msg.clientMoveId, reason: "你已经出局，不能继续行棋。" });
      return;
    }

    if (!participant.connected) {
      this.send(ws, { type: "moveRejected", clientMoveId: msg.clientMoveId, reason: "连接已断开，请重连后再行棋。" });
      return;
    }

    if (this.room.phase !== "playing") {
      const reason = this.room.phase === "waiting" ? "三名玩家到齐后才能开始。" : "对局已经结束。";
      this.send(ws, { type: "moveRejected", clientMoveId: msg.clientMoveId, reason });
      return;
    }

    const activePlayers = this.getActivePlayers();
    if (activePlayers.some((p) => !p.connected)) {
      this.send(ws, { type: "moveRejected", clientMoveId: msg.clientMoveId, reason: "有玩家暂时离线，对局已暂停。" });
      return;
    }

    if (participant.seat !== this.room.state.currentKingdom) {
      this.send(ws, { type: "moveRejected", clientMoveId: msg.clientMoveId, reason: "还没有轮到你行棋。" });
      return;
    }

    try {
      const nextState = applyMove(this.room.state, msg.pieceId, msg.target);
      this.room.state = nextState;
      this.syncPhase();
      this.send(ws, { type: "moveAccepted", clientMoveId: msg.clientMoveId, snapshot: this.snapshot(msg.playerId) });
      this.broadcastRoom(msg.playerId);
    } catch (error) {
      this.send(ws, { type: "moveRejected", clientMoveId: msg.clientMoveId, reason: error instanceof Error ? error.message : "走子无效。" });
    }
  }

  private handleForfeit(ws: WebSocket, msg: Extract<ClientOnlineMessage, { type: "forfeitRoom" }>): void {
    if (!this.room) {
      this.send(ws, { type: "error", message: "房间不存在或已过期。" });
      return;
    }

    const participant = this.room.participants.get(msg.playerId);
    if (!participant || participant.role !== "player" || !participant.seat) {
      this.send(ws, { type: "error", message: "只有入座玩家会被判负。" });
      return;
    }

    if (this.room.phase === "finished") {
      this.send(ws, { type: "error", message: "对局已经结束。" });
      return;
    }

    if (this.room.phase === "playing") {
      this.room.state = resignKingdom(this.room.state, participant.seat);
    }

    this.disconnectPlayer(msg.playerId);
    this.send(ws, { type: "roomJoined", snapshot: this.snapshot(msg.playerId) });
    this.broadcastRoom();
  }

  private disconnectPlayer(playerId: string): void {
    if (!this.room) return;

    const participant = this.room.participants.get(playerId);
    if (!participant) return;

    participant.connected = false;
    participant.disconnectedAt = Date.now();
    this.syncPhase();
    this.broadcastRoom();

    this.scheduleCleanup();
  }

  private broadcastRoom(excludePlayerId?: string): void {
    if (!this.room) return;

    for (const [ws, session] of this.sockets) {
      if (
        !session.playerId ||
        ws.readyState as number !== WebSocket.READY_STATE_OPEN ||
        session.playerId === excludePlayerId
      ) {
        continue;
      }

      this.send(ws, { type: "roomState", snapshot: this.snapshot(session.playerId) });
    }
  }

  private send(ws: WebSocket, message: ServerOnlineMessage): void {
    if (ws.readyState as number === WebSocket.READY_STATE_OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private snapshot(viewerPlayerId: string): OnlineRoomSnapshot {
    if (!this.room) {
      throw new Error("No room");
    }

    const participant = this.room.participants.get(viewerPlayerId);

    return {
      roomCode: this.room.roomCode,
      phase: this.room.phase,
      gameState: this.room.state,
      players: this.getPlayers(),
      spectators: this.getSpectators(),
      seat: participant?.seat ?? null,
      role: participant?.role ?? "spectator",
      options: this.room.options,
      reconnectExpiresAt: participant?.disconnectedAt ? participant.disconnectedAt + reconnectWindowMs : null,
    };
  }

  private nextOpenSeat(): Kingdom | null {
    const occupied = new Set(this.getPlayers().map((p) => p.seat));
    return onlineSeatOrder.find((seat) => !occupied.has(seat)) ?? null;
  }

  private getPlayers(): OnlineParticipant[] {
    if (!this.room) return [];
    return [...this.room.participants.values()]
      .filter((p) => p.role === "player")
      .sort((a, b) => onlineSeatOrder.indexOf(a.seat!) - onlineSeatOrder.indexOf(b.seat!));
  }

  private getActivePlayers(): OnlineParticipant[] {
    return this.getPlayers().filter((p) => p.seat !== null && !this.room!.state.defeatedKingdoms.includes(p.seat));
  }

  private getSpectators(): OnlineParticipant[] {
    if (!this.room) return [];
    return [...this.room.participants.values()]
      .filter((p) => p.role === "spectator")
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  private syncPhase(): void {
    if (!this.room) return;
    if (this.room.state.winner) {
      this.room.phase = "finished";
      return;
    }
    this.room.phase = this.getPlayers().length === onlineSeatOrder.length ? "playing" : "waiting";
  }

  private scheduleCleanup(): void {
    this.ctx.storage.setAlarm(Date.now() + reconnectWindowMs + 5000);
  }

  async alarm(): Promise<void> {
    if (!this.room) return;

    const now = Date.now();
    const allExpired = [...this.room.participants.values()].every(
      (p) => !p.connected && p.disconnectedAt !== null && now - p.disconnectedAt > reconnectWindowMs,
    );

    if (allExpired) {
      this.room = null;
      this.sockets.clear();
    }
  }
}

function cleanName(name: string | undefined): string | null {
  const cleaned = name?.trim().slice(0, 16);
  return cleaned || null;
}

function defaultName(role: OnlineRole, seat: Kingdom | null): string {
  if (role === "spectator") return "观战者";
  return { wei: "魏国玩家", shu: "蜀国玩家", wu: "吴国玩家" }[seat!];
}
