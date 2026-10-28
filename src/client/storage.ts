import type { AgentChatMode } from "./types.js";

/** localStorage wrappers: private mode and blocked storage must never break the chat. */

/** `ns` keeps two chats on one page (and one origin) from sharing layout settings. Without it the keys are unchanged. */
const prefix = (ns?: string) => (ns ? `sideagent:${ns}:` : "sideagent:");
export const modeKey = (ns?: string) => `${prefix(ns)}mode`;
export const widthKey = (ns?: string) => `${prefix(ns)}width`;
export const threadKey = (endpoint: string, ns?: string) => `${prefix(ns)}thread:${endpoint}`;

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

export function readMode(fallback: AgentChatMode, ns?: string): AgentChatMode {
  const v = storeGet(modeKey(ns)) as AgentChatMode | null;
  return v && MODES.includes(v) ? v : fallback;
}
