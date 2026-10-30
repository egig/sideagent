/** Events streamed from server to client over SSE. Shared with the client as types only. */
export type AgentEvent =
  | { type: "turn.start"; threadId: string }
  | { type: "text.delta"; text: string }
  | { type: "tool.start"; callId: string; tool: string }
  | {
      type: "tool.complete";
      callId: string;
      tool: string;
      status: number;
      args: unknown;
      result: unknown;
    }
  /**
   * Passages a knowledge search returned, after its `tool.complete`. Sent only when the host opts in
   * per request (`exposeKnowledge` on createAgent); never in history. Clients may ignore it.
   */
  | {
      type: "knowledge.hits";
      callId: string;
      query: string;
      hits: { title: string; url?: string; score: number; text: string }[];
    }
  | { type: "error"; code: string; message: string }
  | { type: "turn.end" };

export type ChatRequest =
  | { threadId?: string; message: string; context?: unknown }
  | { action: "agent.info" }
  | { action: "threads.list" }
  | { action: "threads.get"; threadId: string }
  | { action: "threads.delete"; threadId: string };

/**
 * Answer to `agent.info`. Only sideagent Cloud serves it; the chat title falls back to "Assistant" without it.
 * `available: false` means the agent will refuse every message right now (a usage cap is reached), so the
 * chat hides itself. Absent or `true`: show it.
 */
export interface AgentInfo {
  name: string;
  available?: boolean;
}

export interface ThreadMeta {
  id: string;
  /** First user message, truncated. Never model output. */
  title: string;
  updatedAt: number;
}

export type HistoryPart =
  { type: "text"; text: string } | { type: "tool"; callId: string; tool: string; args: unknown; result?: unknown };

export interface HistoryMessage {
  role: "user" | "assistant";
  parts: HistoryPart[];
}

export interface ThreadResponse {
  messages: HistoryMessage[];
}
