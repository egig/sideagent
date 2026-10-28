import type { AgentEvent } from "../protocol.js";

export interface OperationEvent {
  operationId: string;
  status: number;
  args: unknown;
  result: unknown;
}

export interface OperationRef {
  callId: string;
  operationId: string;
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
  /** Fires when an operation starts running, after any approval. Always followed by a complete or an abort. */
  onOperationStart?: (e: OperationRef) => void;
  /** Fires for an operation that started but whose result never arrived (turn stopped, connection lost). */
  onOperationAbort?: (e: OperationRef) => void;
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

/**
 * Fires the hooks for one turn's server events. Tracks operations in flight, so `end` can abort the ones
 * whose result never arrived and an app that blocks on `onOperationStart` is never left blocked.
 * `onApprovalRequested` is left to the caller, which fires it when the approval is shown.
 */
export function turnHooks(hooks: AgentHooks | undefined) {
  const running = new Map<string, string>();
  safely(hooks?.onTurnStart);
  return {
    event(ev: AgentEvent) {
      if (ev.type === "tool.start") {
        running.set(ev.callId, ev.operationId);
        safely(() => hooks?.onOperationStart?.({ callId: ev.callId, operationId: ev.operationId }));
      } else if (ev.type === "tool.complete") {
        running.delete(ev.callId);
        fireComplete(hooks, ev);
      } else if (ev.type === "error") {
        safely(() => hooks?.onError?.({ code: ev.code, message: ev.message }));
      }
    },
    end() {
      for (const [callId, operationId] of running) safely(() => hooks?.onOperationAbort?.({ callId, operationId }));
      running.clear();
      safely(hooks?.onTurnEnd);
    },
  };
}
