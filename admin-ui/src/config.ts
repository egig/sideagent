// Runtime settings the server writes into index.html as `window.__SIDEAGENT_ADMIN__` (see serveAdminUi). The same
// build serves any mount point, so nothing about the host is compiled in.
export interface AdminUiConfig {
  /** Where the dashboard is mounted, without a trailing slash. "" for the root. */
  basePath: string;
  /** Where the admin API is mounted. Default `/api`. */
  apiBase: string;
  /** The host's own assistant for the dashboard: an agent and its publishable key (D-27). Optional. */
  assistant?: { agentId: string; publishableKey: string };
  /** Link to the docs, shown in the sidebar. Optional. */
  docsUrl?: string;
}

declare global {
  interface Window {
    __SIDEAGENT_ADMIN__?: Partial<AdminUiConfig>;
  }
}

const given = typeof window === "undefined" ? undefined : window.__SIDEAGENT_ADMIN__;

export const config: AdminUiConfig = {
  basePath: (given?.basePath ?? "").replace(/\/$/, ""),
  apiBase: given?.apiBase ?? "/api",
  assistant: given?.assistant,
  docsUrl: given?.docsUrl,
};
