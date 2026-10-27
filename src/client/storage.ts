import type { AgentChatMode } from "./types.js";

/** localStorage wrappers: private mode and blocked storage must never break the chat. */

export const MODE_KEY = "sideagent:mode";
export const WIDTH_KEY = "sideagent:width";
export const threadKey = (endpoint: string) => `sideagent:thread:${endpoint}`;

const MODES: AgentChatMode[] = ["floating", "sidebar"];

export function storeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function storeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export function readMode(fallback: AgentChatMode): AgentChatMode {
  const v = storeGet(MODE_KEY) as AgentChatMode | null;
  return v && MODES.includes(v) ? v : fallback;
}
