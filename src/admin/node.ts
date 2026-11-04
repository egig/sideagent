// sideagent/admin/node: serves the built dashboard from disk. Node only (it reads files); on Workers or another platform
// upload dist/admin-ui as static assets and rewrite index.html with `adminUiHtml`.
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { adminUiHtml, type AdminUiConfig } from "./ui.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export interface ServeAdminUiOptions extends AdminUiConfig {
  /** Folder with the built dashboard. Default: the one shipped in this package. */
  dir?: string;
  /** Path prefixes that are never the dashboard's, so a root mount leaves the API alone. Default `["/api", "/v1"]`. */
  exclude?: string[];
}

/**
 * A request handler for the dashboard's files under `basePath`. Returns null for any other path, so it chains in front
 * of the rest of the app:  `const ui = serveAdminUi({ basePath: "/admin" }); (req) => ui(req) ?? admin.fetch(req)`.
 * Unknown paths without a file extension get index.html, so the dashboard's own routes work on reload.
 */
export function serveAdminUi(options: ServeAdminUiOptions = {}): (request: Request) => Promise<Response> | null {
  // `dir` is the server's business: only the dashboard's own settings go into the page.
  const { dir: given, exclude = ["/api", "/v1"], ...settings } = options;
  const dir = given ?? fileURLToPath(new URL("../admin-ui", import.meta.url));
  const base = (options.basePath ?? "").replace(/\/$/, "");
  const headers = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" };
  let index: string | undefined;

  const page = async () => {
    index ??= adminUiHtml(await readFile(join(dir, "index.html"), "utf8"), settings);
    return new Response(index, {
      headers: { ...headers, "content-type": TYPES[".html"]!, "cache-control": "no-cache" },
    });
  };

  return (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const path = new URL(request.url).pathname;
    if (path !== base && !path.startsWith(`${base}/`)) return null;
    if (exclude.some((x) => path === x || path.startsWith(`${x}/`))) return null;
    const rel = decodeURIComponent(path.slice(base.length)) || "/";
    return (async () => {
      const ext = extname(rel);
      if (!ext || rel === "/" || rel === "/index.html") return page();
      // Stay inside the folder: no `..`, no absolute paths.
      const file = normalize(join(dir, rel));
      if (!file.startsWith(dir + sep)) return new Response("not found", { status: 404, headers });
      try {
        const body = await readFile(file);
        // Built assets carry a content hash in their name.
        const cache = rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
        return new Response(body, {
          headers: { ...headers, "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": cache },
        });
      } catch {
        return new Response("not found", { status: 404, headers });
      }
    })();
  };
}
