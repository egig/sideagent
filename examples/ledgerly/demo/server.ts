// The server behind the recorded demo (`pnpm demo`): the sideagent server and dashboard over an in-memory database,
// with nothing on the network. The model is a script that answers the demo's questions the way a real one would,
// and the docs pages are served from public/docs. Run from the repo root with tsx; it imports the library's source,
// as e2e/support/server.ts does.
import { readFile, readdir } from "node:fs/promises";
import { createServer as createHttp } from "node:http";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { getRequestListener } from "@hono/node-server";
import { drizzle } from "drizzle-orm/pglite";
import { createServer as createVite } from "vite";
import { adminUiHtml } from "../../../src/admin/ui.js";
import type { PgDb } from "../../../src/admin/store/pg/index.js";
import { createServer } from "../../../src/create-server.js";
import { demoEmbeddings, demoLlmHandler } from "./script.js";

const PORT = Number(process.env.DEMO_PORT ?? 8801);
const publicUrl = `http://localhost:${PORT}`;
const adminUi = fileURLToPath(new URL("../../../admin-ui/", import.meta.url));
const docsDir = fileURLToPath(new URL("../public/docs/", import.meta.url));
export const LLM_BASE_URL = "https://llm.ledgerly.test/v1";
export const DOCS_HOST = "https://docs.ledgerly.test";

/** A docs page as the HTML a site would serve, so the knowledge fetcher indexes it like any page. */
function pageHtml(markdown: string): string {
  const plain = (s: string) =>
    s
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;");
  const body = markdown
    .split("\n")
    .filter((l) => l.trim() && !/^\|[\s|-]+\|$/.test(l))
    .map((l) =>
      l.startsWith("# ")
        ? `<h1>${plain(l.slice(2))}</h1>`
        : l.startsWith("## ")
          ? `<h2>${plain(l.slice(3))}</h2>`
          : /^(- |\d+\. )/.test(l)
            ? `<p>${plain(l.replace(/^(- |\d+\. )/, ""))}</p>`
            : `<p>${plain(l.replace(/^\||\|$/g, "").replace(/\s*\|\s*/g, "; "))}</p>`,
    )
    .join("");
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? "Ledgerly docs";
  return `<html><head><title>${plain(title)}</title></head><body>${body}</body></html>`;
}

const pages = new Map<string, string>();
for (const file of await readdir(docsDir)) {
  if (file.endsWith(".md"))
    pages.set(`${DOCS_HOST}/${file.replace(/\.md$/, "")}`, pageHtml(await readFile(`${docsDir}${file}`, "utf8")));
}

const fakeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.url.startsWith(`${LLM_BASE_URL}/`)) {
    if (request.url.endsWith("/chat/completions")) return demoLlmHandler(request);
  }
  const page = pages.get(request.url);
  if (page) return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response("not found", { status: 404 });
};

// Like a Cloudflare host: the owner's agents start on a model the host provides, so setup begins with the model done.
const builtinModel = {
  model: "demo-chat",
  embeddingModel: "demo-embed",
  models: () => ({
    llm: { baseUrl: LLM_BASE_URL, apiKey: "sk-demo-0000", model: "demo-chat", fetch: fakeFetch },
    embeddings: demoEmbeddings,
  }),
  embed: async (texts: string[]) => (await demoEmbeddings.embedDocuments(texts)).map((v) => Float32Array.from(v)),
  consume: async () => ({ allowed: true }),
  usage: async () => ({ month: new Date().toISOString().slice(0, 7), used: 12, limit: 300 }),
};

const links = new Map<string, string>();

const app = createServer({
  database: drizzle(new PGlite({ extensions: { vector } })) as unknown as PgDb,
  publicUrl,
  secret: "demo-only-secret-demo-only-secret-demo-only",
  auth: { signup: true, sendMagicLink: async (email, url) => void links.set(email, url) },
  resolve: async () => ["93.184.216.34"],
  fetch: fakeFetch,
  builtinModel,
});
await app.ready;

const api = getRequestListener(app.fetch);
const http = createHttp();
const vite = await createVite({
  configFile: fileURLToPath(new URL("../../../admin-ui/vite.config.ts", import.meta.url)),
  appType: "custom",
  logLevel: "warn",
  server: { middlewareMode: true, hmr: false },
});

http.on("request", (req, res) => {
  const url = new URL(req.url ?? "/", publicUrl);
  if (url.pathname === "/__demo/magic-link") {
    const link = links.get(url.searchParams.get("email") ?? "");
    res.writeHead(link ? 200 : 404, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ link: link ?? null }));
  }
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/v1")) return void api(req, res);
  vite.middlewares(req, res, async () => {
    try {
      const html = adminUiHtml(await readFile(`${adminUi}index.html`, "utf8"), {});
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(await vite.transformIndexHtml(req.url ?? "/", html));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
});

http.listen(PORT, () => console.log(`ledgerly demo server on ${publicUrl}`));
