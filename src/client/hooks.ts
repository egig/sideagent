import type { AgentEvent } from "../protocol.js";

/**
 * UI hooks. They run your code at the edges of a turn. The model can never trigger them or any other
 * client action.
 */
export interface AgentHooks {
  onTurnStart?: () => void;
  onTurnEnd?: () => void;
  onError?: (e: { code: string; message: string }) => void;
}

export function safely(fn: (() => void) | undefined) {
  try {
    fn?.();
  } catch (err) {
    console.error("[sideagent] hook threw:", err);
  }
}

/** Fires the hooks for one turn's server events. */
export function turnHooks(hooks: AgentHooks | undefined) {
  safely(hooks?.onTurnStart);
  return {
    event(ev: AgentEvent) {
      if (ev.type === "error") safely(() => hooks?.onError?.({ code: ev.code, message: ev.message }));
    },
    end() {
      safely(hooks?.onTurnEnd);
    },
  };
}
