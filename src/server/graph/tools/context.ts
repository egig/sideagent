import { ToolMessage } from "@langchain/core/messages";
import type { AgentEvent } from "../../../protocol.js";
import type { RunContext } from "../types.js";

export interface ToolContext {
  callId: string;
  run: RunContext;
  signal?: AbortSignal;
  /** Streams an event to the browser. */
  write: (e: AgentEvent) => void;
}

/**
 * `content` is what the model sees. `result` is stored as the message artifact and used to
 * rebuild history in the browser, so it must already be safe to show there.
 */
export function toolResult(callId: string, content: string, result: unknown, relevant?: boolean): ToolMessage {
  return new ToolMessage({ tool_call_id: callId, content, artifact: { result, ...(relevant ? { relevant } : {}) } });
}
