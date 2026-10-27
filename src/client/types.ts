import type { ReactNode } from "react";
import type { AgentEvent, HistoryMessage } from "../protocol.js";
import type { AgentHooks } from "./hooks.js";

export type AgentChatMode = "floating" | "sidebar";
export type ApprovalEvent = Extract<AgentEvent, { type: "approval.request" }>;
export type Decision = "approve" | "reject";

export interface AgentChatProps {
  /** URL of your sideagent endpoint, e.g. "/api/agent". */
  endpoint: string;
  /** Starting layout. The user can switch; their choice is remembered. */
  mode?: AgentChatMode;
  title?: string;
  placeholder?: string;
  hooks?: AgentHooks;
  /**
   * Extra info about the page (route, selected record). The model sees it as untrusted data;
   * it never grants permissions.
   */
  context?: unknown | (() => unknown);
  /** Use "include" when the endpoint is on another origin and relies on cookies. */
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  defaultOpen?: boolean;
  /** Custom result views per operationId. Anything not listed gets the built-in table / fields view. */
  resultRenderers?: Record<string, (e: { operationId: string; args: unknown; result: unknown }) => ReactNode>;
  /** "auto" follows the OS and host `.dark` / `data-theme=dark`. Colors are overridable via --sideagent-* CSS variables. */
  theme?: "auto" | "light" | "dark";
  /** Set false to hide the layout switcher. */
  allowModeSwitch?: boolean;
}

/** What the chat starts from: a fresh thread, or one loaded from history. `key` remounts Chat. */
export interface Session {
  key: number;
  threadId?: string;
  messages?: HistoryMessage[];
  pending?: ApprovalEvent;
}
