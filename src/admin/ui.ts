// sideagent/admin/ui: puts the dashboard's runtime settings into its index.html. Pure string work, safe anywhere. The
// files themselves are in dist/admin-ui; serve them with `serveAdminUi` (Node) or your platform's static assets.

export interface AdminUiConfig {
  /** Where the dashboard is mounted, e.g. `/admin`. Default: the root. */
  basePath?: string;
  /** Where the admin API is mounted. Default `/api`. */
  apiBase?: string;
  /** The host's own assistant for the dashboard: an agent and its publishable key. */
  assistant?: { agentId: string; publishableKey: string };
  /** Link to the docs, shown in the sidebar. */
  docsUrl?: string;
}

/** JSON that cannot end the script tag it sits in. */
const safeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const attr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The built index.html with `window.__SIDEAGENT_ADMIN__` set. The build's asset links are relative, so a `<base>` at
 * the mount point keeps them working on the dashboard's deep routes (`/agents/agt_1/knowledge`).
 */
export function adminUiHtml(indexHtml: string, config: AdminUiConfig = {}): string {
  const settings = { ...config, basePath: (config.basePath ?? "").replace(/\/$/, "") };
  return indexHtml.replace(
    "<!--sideagent-config-->",
    `<base href="${attr(settings.basePath)}/"><script>window.__SIDEAGENT_ADMIN__=${safeJson(settings)}</script>`,
  );
}
