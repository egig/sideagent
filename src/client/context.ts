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

export const RenderersContext = createContext<AgentChatProps["resultRenderers"]>(undefined);
