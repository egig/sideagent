import { createContext, useContext } from "react";
import type { AgentChatProps } from "./types.js";

/** Set by AgentProvider so a sidebar chat docks beside the app instead of floating over it. */
export const DockContext = createContext(false);

export interface AgentControls {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const AgentContext = createContext<AgentControls | null>(null);

/** Open or close the assistant from anywhere under `AgentProvider`. */
export function useAgent(): AgentControls {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used inside <AgentProvider>");
  return ctx;
}

/** Whether an operation is running. Set by AgentProvider; null outside it. */
export const BusyContext = createContext<boolean | null>(null);
/** Lets the chat report whether an operation is running. A no-op outside AgentProvider. */
export const SetBusyContext = createContext<((busy: boolean) => void) | null>(null);

/**
 * True while one of the agent's operations is running, after any approval, e.g. to block input that would
 * race it. Use it anywhere under `AgentProvider`.
 */
export function useAgentBusy(): boolean {
  const busy = useContext(BusyContext);
  if (busy === null) throw new Error("useAgentBusy must be used inside <AgentProvider>");
  return busy;
}

export const RenderersContext = createContext<AgentChatProps["resultRenderers"]>(undefined);
