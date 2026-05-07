import { describe, expect, it } from "vitest";
import { OnlineRoomManager } from "./online-room";

const options = { defeatedPieceMode: "block" as const, defeatCondition: "capture" as const };

describe("OnlineRoomManager", () => {
  it("creates a room and seats players in Wei, Shu, Wu order", () => {
    const manager = new OnlineRoomManager();
    const created = manager.createRoom("p1", "Host", options);
    const second = manager.joinRoom(created.room.roomCode, "p2", "Second");
    const third = manager.joinRoom(created.room.roomCode, "p3", "Third");

    expect(created.room.roomCode).toMatch(/^\d{5}$/);
    expect(created.snapshot.seat).toBe("wei");
    expect(second.snapshot.seat).toBe("shu");
    expect(third.snapshot.seat).toBe("wu");
    expect(third.snapshot.phase).toBe("playing");
  });

  it("puts the fourth participant into spectator mode", () => {
    const manager = new OnlineRoomManager();
    const created = manager.createRoom("p1", undefined, options);

    manager.joinRoom(created.room.roomCode, "p2");
    manager.joinRoom(created.room.roomCode, "p3");
    const spectator = manager.joinRoom(created.room.roomCode, "p4");

    expect(spectator.snapshot.role).toBe("spectator");
    expect(spectator.snapshot.seat).toBeNull();
    expect(spectator.snapshot.spectators).toHaveLength(1);
  });

  it("reconnects a player to the same seat inside the reconnect window", () => {
    let now = 1_000;
    const manager = new OnlineRoomManager(() => now);
    const created = manager.createRoom("p1", "Host", options);

    manager.leaveRoom(created.room.roomCode, "p1");
    now += 30_000;
    const rejoined = manager.joinRoom(created.room.roomCode, "p1", "Host again");

    expect(rejoined.reconnected).toBe(true);
    expect(rejoined.snapshot.seat).toBe("wei");
    expect(rejoined.snapshot.players[0].connected).toBe(true);
  });

  it("throws for an unknown room code", () => {
    const manager = new OnlineRoomManager();

    expect(() => manager.joinRoom("12345", "p1")).toThrow("房间不存在");
  });

  it("throws for a nonnumeric room code", () => {
    const manager = new OnlineRoomManager();

    expect(() => manager.joinRoom("abcde", "p1")).toThrow("5 位数字");
  });

  it("rejects moves from the wrong player and accepts the current seat move", () => {
    const manager = new OnlineRoomManager();
    const created = manager.createRoom("p1", undefined, options);

    manager.joinRoom(created.room.roomCode, "p2");
    manager.joinRoom(created.room.roomCode, "p3");

    const wrongTurn = manager.submitMove(created.room.roomCode, "p2", "shu-soldier-5", "K5");
    const accepted = manager.submitMove(created.room.roomCode, "p1", "wei-soldier-5", "A5");

    expect(wrongTurn.ok).toBe(false);
    expect(wrongTurn.reason).toContain("还没有轮到你");
    expect(accepted.ok).toBe(true);
    expect(accepted.snapshot?.gameState.currentKingdom).toBe("shu");
  });

  it("rejects illegal moves without changing the authoritative state", () => {
    const manager = new OnlineRoomManager();
    const created = manager.createRoom("p1", undefined, options);

    manager.joinRoom(created.room.roomCode, "p2");
    manager.joinRoom(created.room.roomCode, "p3");

    const rejected = manager.submitMove(created.room.roomCode, "p1", "wei-soldier-5", "E5");

    expect(rejected.ok).toBe(false);
    expect(created.room.state.currentKingdom).toBe("wei");
  });

  it("forfeits an active player without pausing the remaining active players", () => {
    const manager = new OnlineRoomManager();
    const created = manager.createRoom("p1", undefined, options);

    manager.joinRoom(created.room.roomCode, "p2");
    manager.joinRoom(created.room.roomCode, "p3");

    const forfeit = manager.forfeitRoom(created.room.roomCode, "p1");
    const accepted = manager.submitMove(created.room.roomCode, "p2", "shu-soldier-5", "K5");

    expect(forfeit.ok).toBe(true);
    expect(forfeit.snapshot?.gameState.defeatedKingdoms).toEqual(["wei"]);
    expect(forfeit.snapshot?.gameState.currentKingdom).toBe("shu");
    expect(accepted.ok).toBe(true);
    expect(accepted.snapshot?.gameState.currentKingdom).toBe("wu");
  });
});
