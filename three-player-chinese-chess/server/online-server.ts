import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { OnlineRoomManager, type OnlineRoom } from "./online-room";
import type { ClientOnlineMessage, ServerOnlineMessage } from "../src/online/protocol";

const port = Number(process.env.PORT ?? 4173);
const distDir = resolve(process.cwd(), "dist");
const manager = new OnlineRoomManager();
const sockets = new Map<WebSocket, { playerId: string | null; roomCode: string | null }>();

const server = createServer((request, response) => {
  if (request.url?.startsWith("/ws")) {
    response.writeHead(426);
    response.end("WebSocket endpoint");
    return;
  }

  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(join(distDir, requestedPath));
  const safeFilePath = filePath.startsWith(distDir) && existsSync(filePath) ? filePath : join(distDir, "index.html");
  const contentType = contentTypeFor(safeFilePath);

  response.setHeader("Content-Type", contentType);
  createReadStream(safeFilePath)
    .on("error", () => {
      response.writeHead(404);
      response.end("Not found");
    })
    .pipe(response);
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  sockets.set(socket, { playerId: null, roomCode: null });

  socket.on("message", (data) => {
    handleSocketMessage(socket, data.toString());
  });

  socket.on("close", () => {
    const session = sockets.get(socket);
    sockets.delete(socket);

    if (session?.playerId && session.roomCode) {
      const room = manager.leaveRoom(session.roomCode, session.playerId);

      if (room) {
        broadcastRoom(room);
      }
    }
  });
});

setInterval(() => {
  for (const room of manager.cleanupExpiredParticipants()) {
    broadcastRoom(room);
  }
}, 30_000).unref();

server.listen(port, () => {
  console.log(`Three-player Chinese chess online server listening on http://127.0.0.1:${port}`);
});

function handleSocketMessage(socket: WebSocket, raw: string): void {
  let message: ClientOnlineMessage;

  try {
    message = JSON.parse(raw) as ClientOnlineMessage;
  } catch {
    send(socket, { type: "error", message: "消息格式无效。" });
    return;
  }

  try {
    switch (message.type) {
      case "ping":
        send(socket, { type: "pong" });
        return;
      case "createRoom": {
        const result = manager.createRoom(message.playerId, message.name, message.options);
        sockets.set(socket, { playerId: message.playerId, roomCode: result.room.roomCode });
        send(socket, { type: "roomJoined", snapshot: result.snapshot });
        broadcastRoom(result.room);
        return;
      }
      case "joinRoom": {
        const result = manager.joinRoom(message.roomCode, message.playerId, message.name);
        sockets.set(socket, { playerId: message.playerId, roomCode: result.room.roomCode });
        send(socket, { type: "roomJoined", snapshot: result.snapshot });
        broadcastRoom(result.room);
        return;
      }
      case "leaveRoom": {
        const room = manager.leaveRoom(message.roomCode, message.playerId);
        sockets.set(socket, { playerId: null, roomCode: null });

        if (room) {
          broadcastRoom(room);
        }

        return;
      }
      case "forfeitRoom": {
        const result = manager.forfeitRoom(message.roomCode, message.playerId);

        if (!result.ok || !result.room) {
          send(socket, { type: "error", message: result.reason ?? "退出房间失败。" });
          return;
        }

        broadcastRoom(result.room);
        return;
      }
      case "submitMove": {
        const result = manager.submitMove(message.roomCode, message.playerId, message.pieceId, message.target);

        if (!result.ok || !result.room || !result.snapshot) {
          send(socket, { type: "moveRejected", clientMoveId: message.clientMoveId, reason: result.reason ?? "走子无效。" });
          return;
        }

        send(socket, { type: "moveAccepted", clientMoveId: message.clientMoveId, snapshot: result.snapshot });
        broadcastRoom(result.room);
        return;
      }
    }
  } catch (error) {
    send(socket, { type: "error", message: error instanceof Error ? error.message : "服务器处理失败。" });
  }
}

function broadcastRoom(room: OnlineRoom): void {
  for (const [socket, session] of sockets) {
    if (session.roomCode !== room.roomCode || !session.playerId || socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    send(socket, {
      type: "roomState",
      snapshot: manager.snapshot(room, session.playerId),
    });
  }
}

function send(socket: WebSocket, message: ServerOnlineMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function contentTypeFor(filePath: string): string {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
  }[extname(filePath)] ?? "application/octet-stream";
}
