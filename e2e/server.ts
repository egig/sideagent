// The server the Playwright tests drive: `createServer` over an in-memory database, the dashboard from Vite (as in
// `pnpm dev`), and nothing on the network. DNS and outbound fetch are faked: the integrator's LLM provider at
// llm.example.com is the library's scripted model, and docs.example.com serves a few pages. Sign-in links are kept in
// memory and read back by the tests through /__e2e/magic-link, which exists on this test server only.
import { readFile } from "node:fs/promises";
import { createServer as createHttp } from "node:http";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { getRequestListener } from "@hono/node-server";
import { drizzle } from "drizzle-orm/pglite";
import { createServer as createVite } from "vite";
import { adminUiHtml } from "../src/admin/ui.js";
import type { PgDb } from "../src/admin/store/pg/index.js";
import { createServer } from "../src/create-server.js";
import { mockEmbeddingsHandler, mockLlmHandler } from "../src/testing/mock-llm.js";
import { DOCS_PAGE, LLM_BASE_URL, WRONG_KEY } from "./constants.js";

const E2E_PORT = Number(process.env.E2E_PORT ?? 8799);
const publicUrl = `http://localhost:${E2E_PORT}`;
const adminUi = fileURLToPath(new URL("../admin-ui/", import.meta.url));

const DOCS: Record<string, string> = {
  [DOCS_PAGE]:
    "<html><title>Refund policy</title><body><h1>Refunds</h1><p>Refunds are paid within 5 business days of the request.</p></body></html>",
};

const fakeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = request.url;
  if (url.startsWith(`${LLM_BASE_URL}/`)) {
    if (request.headers.get("authorization") === `Bearer ${WRONG_KEY}`)
      return Response.json({ error: { message: "Incorrect API key provided" } }, { status: 401 });
    if (url.endsWith("/chat/completions")) return mockLlmHandler(request);
    if (url.endsWith("/embeddings")) return mockEmbeddingsHandler(request);
  }
  const page = DOCS[url];
  if (page) return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response("not found", { status: 404 });
};

const links = new Map<string, string>();

const app = createServer({
  database: drizzle(new PGlite({ extensions: { vector } })) as unknown as PgDb,
  publicUrl,
  secret: "e2e-only-secret-e2e-only-secret-e2e-only",
  auth: { signup: true, sendMagicLink: async (email, url) => void links.set(email, url) },
  // Every host is public except *.private.example, as in the unit tests.
  resolve: async (host) => (host.endsWith("private.example") ? ["10.0.0.9"] : ["93.184.216.34"]),
  fetch: fakeFetch,
});
await app.ready;

const api = getRequestListener(app.fetch);
const http = createHttp();
const vite = await createVite({
  configFile: fileURLToPath(new URL("../admin-ui/vite.config.ts", import.meta.url)),
  appType: "custom",
  logLevel: "warn",
  server: { middlewareMode: true, hmr: false },
});

http.on("request", (req, res) => {
  const url = new URL(req.url ?? "/", publicUrl);
  if (url.pathname === "/__e2e/magic-link") {
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

http.listen(E2E_PORT, () => console.log(`sideagent e2e server on ${publicUrl}`));
