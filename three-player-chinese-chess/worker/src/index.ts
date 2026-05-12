import { RoomDO } from "./room-do";

export { RoomDO };

interface Env {
  ROOM_DO: DurableObjectNamespace;
}

const roomCodeAlphabet = "0123456789";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (!url.pathname.startsWith("/ws")) {
      return new Response("Not found", { status: 404 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket endpoint", { status: 426 });
    }

    let roomCode: string;
    let action: string;

    if (url.pathname === "/ws/create" || url.pathname === "/ws/create/") {
      roomCode = generateRoomCode();
      action = "create";
    } else {
      const match = url.pathname.match(/^\/ws\/join\/(\d{5})\/?$/);
      if (!match) {
        return new Response("Not found. Use /ws/create or /ws/join/{code}", { status: 404 });
      }
      roomCode = match[1];
      action = "join";
    }

    const id = env.ROOM_DO.idFromName(roomCode);
    const stub = env.ROOM_DO.get(id);

    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set("X-Room-Code", roomCode);
    forwardHeaders.set("X-Action", action);

    return stub.fetch(new Request(request, { headers: forwardHeaders }));
  },
};

function generateRoomCode(): string {
  return Array.from({ length: 5 }, () => roomCodeAlphabet[Math.floor(Math.random() * roomCodeAlphabet.length)]).join("");
}
