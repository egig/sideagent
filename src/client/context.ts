import { createContext, useContext } from "react";

/** Set by AgentProvider so a sidebar chat docks beside the app instead of floating over it. */
export const DockContext = createContext(false);

export interface AgentControls {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** False when the server says the agent refuses every message now (a usage cap), so the chat is hidden. */
  available: boolean;
}

export const AgentContext = createContext<AgentControls | null>(null);

/** Open or close the assistant from anywhere under `AgentProvider`. */
export function useAgent(): AgentControls {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used inside <AgentProvider>");
  return ctx;
}

/** Lets the chat report that the agent is unavailable. A no-op outside AgentProvider. */
export const SetAvailableContext = createContext<((available: boolean) => void) | null>(null);
