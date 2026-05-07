import type { Kingdom } from "../core/board";
import { chooseAiMove, type AiMove, type AiMoveOptions } from "../core/ai";
import type { AiProfile } from "../core/ai-profile";
import type { GameState } from "../core/game-state";

interface AiWorkerRequest {
  id: number;
  state: GameState;
  kingdom: Kingdom;
  profile: AiProfile;
  options: AiMoveOptions;
}

interface AiWorkerResponse {
  id: number;
  move: AiMove | null;
  error?: string;
}

self.addEventListener("message", (event: MessageEvent<AiWorkerRequest>) => {
  const request = event.data;
  let response: AiWorkerResponse;

  try {
    response = {
      id: request.id,
      move: chooseAiMove(request.state, request.kingdom, request.profile, request.options),
    };
  } catch (error) {
    response = {
      id: request.id,
      move: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  self.postMessage(response);
});
