import type { Kingdom } from "../core/board";
import { chooseAiMove, clearTranspositionTable, type AiMove, type AiMoveOptions } from "../core/ai";
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

interface AiWorkerControl {
  type: "clear" | "precompute";
  state?: GameState;
  kingdom?: Kingdom;
  profile?: AiProfile;
}

// Handle move computation requests
self.addEventListener("message", (event: MessageEvent<AiWorkerRequest | AiWorkerControl>) => {
  const data = event.data;

  // Control messages for TT management
  if ("type" in data) {
    if (data.type === "clear") {
      clearTranspositionTable();
    } else if (data.type === "precompute" && data.state && data.kingdom && data.profile) {
      // Pre-compute: do a quick search to populate the TT while opponent is thinking
      chooseAiMove(data.state, data.kingdom, data.profile, {
        timeBudgetMs: 200,
        maxDepth: 2,
      });
    }

    return;
  }

  // Standard move computation
  const request = data as AiWorkerRequest;
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
