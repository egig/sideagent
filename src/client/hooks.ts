import type { AgentEvent } from "../protocol.js";

export interface OperationEvent {
  operationId: string;
  status: number;
  args: unknown;
  result: unknown;
}

/**
 * UI hooks. They run your code after the server confirms something happened, e.g. refetch a
 * list after `createInvoice`. The model can never trigger them or any other client action.
 */
export interface AgentHooks {
  onTurnStart?: () => void;
  onTurnEnd?: () => void;
  onApprovalRequested?: (e: Extract<AgentEvent, { type: "approval.request" }>) => void;
  onError?: (e: { code: string; message: string }) => void;
  /** Fires for every finished operation, successful or not. */
  onAnyOperation?: (e: OperationEvent) => void;
  /** Fires for one operationId. */
  onOperationComplete?: Record<string, (e: OperationEvent) => void>;
  /** Fires per `x-agent: { invalidates: [...] }` tag after a successful operation. */
  onInvalidate?: (tag: string, e: OperationEvent) => void;
}

export function safely(fn: (() => void) | undefined) {
  try {
    fn?.();
  } catch (err) {
    console.error("[sideagent] hook threw:", err);
  }
}

/** Runs the operation hooks for a finished tool call. */
export function fireComplete(hooks: AgentHooks | undefined, ev: Extract<AgentEvent, { type: "tool.complete" }>) {
  const oe: OperationEvent = { operationId: ev.operationId, status: ev.status, args: ev.args, result: ev.result };
  safely(() => hooks?.onAnyOperation?.(oe));
  safely(() => hooks?.onOperationComplete?.[ev.operationId]?.(oe));
  for (const tag of ev.invalidates) safely(() => hooks?.onInvalidate?.(tag, oe));
}
