import { ToolMessage } from "@langchain/core/messages";
import type { AgentEvent } from "../../../protocol.js";
import type { AuditEvent } from "../../security/policy.js";
import type { RunContext } from "../types.js";

export interface ToolContext {
  callId: string;
  threadId: string;
  run: RunContext;
  signal?: AbortSignal;
  /** Streams an event to the browser. */
  write: (e: AgentEvent) => void;
  /** Never throws; args are redacted before they reach onAudit. */
  audit: (e: AuditEvent) => void;
  /** Audit fields shared by every outcome of this call. */
  base: Pick<AuditEvent, "at" | "userId" | "threadId" | "operationId" | "callId">;
}

/**
 * `content` is what the model sees. `result` is stored as the message artifact and used to
 * rebuild history in the browser, so it must already be safe to show there.
 */
export function toolResult(callId: string, content: string, result: unknown): ToolMessage {
  return new ToolMessage({ tool_call_id: callId, content, artifact: { result } });
}
