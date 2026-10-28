import type { ReactNode } from "react";
import type { AgentEvent, HistoryMessage } from "../protocol.js";
import type { AgentHooks } from "./hooks.js";

export type AgentChatMode = "floating" | "sidebar";
export type ApprovalEvent = Extract<AgentEvent, { type: "approval.request" }>;
export type Decision = "approve" | "reject";

export interface AgentChatProps {
  /** URL of your sideagent endpoint, e.g. "/api/agent". With `publishableKey`, overrides the URL the key names. */
  endpoint?: string;
  /** sideagent Cloud publishable key (`pk_live_…`). Requests go to the agent it names and carry it. */
  publishableKey?: string;
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
  /**
   * Called before every request; its headers are added to `headers` (which wins on a clash). Use it for a
   * login token that expires, e.g. `Authorization: Bearer <token>` from your login SDK. If it throws, the
   * request is not sent and the chat shows an error.
   */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /**
   * Scopes what the chat remembers in localStorage (the last conversation) to one user, e.g. their user ID.
   * Changing it starts over with that user's last conversation.
   */
  storageKey?: string;
  defaultOpen?: boolean;
  /** Set false to hide the floating launcher button. The panel then opens only through `useAgent().setOpen` or `defaultOpen`. */
  launcher?: boolean;
  /**
   * Set false to turn off chat history: no History button, and the chat does not remember or reopen the last
   * conversation, so every visit starts fresh. The server still keeps its threads.
   */
  history?: boolean;
  /** Extra buttons rendered in the panel header, before History. Use `className="sa-btn sa-icon-btn"` to match. */
  headerActions?: ReactNode;
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
