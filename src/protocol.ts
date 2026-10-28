/** Events streamed from server to client over SSE. Shared with the client as types only. */
export type AgentEvent =
  | { type: "turn.start"; threadId: string }
  | { type: "text.delta"; text: string }
  | { type: "tool.start"; callId: string; operationId: string }
  | {
      type: "approval.request";
      callId: string;
      operationId: string;
      method: string;
      path: string;
      args: unknown;
      token: string;
      expiresAt: number;
    }
  | {
      type: "tool.complete";
      callId: string;
      operationId: string;
      status: number;
      args: unknown;
      result: unknown;
      invalidates: string[];
    }
  | { type: "tool.rejected"; callId: string; operationId: string }
  | { type: "error"; code: string; message: string }
  | { type: "turn.end" };

export type ChatRequest =
  | { threadId?: string; message: string; context?: unknown }
  | { threadId: string; approval: { token: string; decision: "approve" | "reject" } }
  | { action: "agent.info" }
  | { action: "threads.list" }
  | { action: "threads.get"; threadId: string }
  | { action: "threads.delete"; threadId: string };

/** Answer to `agent.info`. Only sideagent Cloud serves it; the chat title falls back to "Assistant" without it. */
export interface AgentInfo {
  name: string;
}

export interface ThreadMeta {
  id: string;
  /** First user message, truncated. Never model output. */
  title: string;
  updatedAt: number;
}

export type HistoryPart =
  | { type: "text"; text: string }
  | { type: "tool"; callId: string; operationId: string; args: unknown; result?: unknown };

export interface HistoryMessage {
  role: "user" | "assistant";
  parts: HistoryPart[];
}

export interface ThreadResponse {
  messages: HistoryMessage[];
  /** Set when the thread is waiting for an approval decision. */
  pending?: Extract<AgentEvent, { type: "approval.request" }>;
}
