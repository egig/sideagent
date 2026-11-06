// `pnpm dev`: one server on one origin, like production. The API is createServer; the dashboard comes from Vite in
// middleware mode (hot module reload over the same port), with the same index.html settings `serveAdminUi` adds.
// Same variables as src/cli.ts, from the shell or a `.env` in the working directory.
import { readFile } from "node:fs/promises";
import { createServer as createHttp } from "node:http";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { createServer as createVite } from "vite";
import { adminUiHtml } from "../src/admin/ui.js";
import type { PgDb } from "../src/admin/store/pg/index.js";
import { createServer } from "../src/create-server.js";

try {
  process.loadEnvFile?.(".env");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

const env = process.env;
const port = Number(env.PORT ?? 8788);
const publicUrl = env.PUBLIC_URL ?? `http://localhost:${port}`;
const adminUi = fileURLToPath(new URL("../admin-ui/", import.meta.url));

let database: string | PgDb;
if (env.DATABASE_URL) {
  database = env.DATABASE_URL;
} else {
  const [{ PGlite }, { vector }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite-pgvector"),
    import("drizzle-orm/pglite"),
  ]);
  database = drizzle(new PGlite({ extensions: { vector } })) as unknown as PgDb;
  console.warn("DATABASE_URL is not set: using an in-memory database, data is lost on exit.");
}

const pair = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : undefined);

const app = createServer({
  database,
  publicUrl,
  secret: env.SIDEAGENT_SECRET ?? "dev-only-secret-dev-only-secret-dev-only-secret",
  auth: {
    signup: env.SIGNUP === "true",
    sendMagicLink:
      env.SIDEAGENT_LOG_SIGN_IN_LINKS === "true"
        ? async (email, url) => console.log(`sign-in link for ${email}: ${url}`)
        : undefined,
    github: pair(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    google: pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  },
  onError: ({ agentId, code }) => console.error("agent turn error", { agentId, code }),
});
await app.ready;

const api = getRequestListener(app.fetch);
const http = createHttp();
const vite = await createVite({
  configFile: fileURLToPath(new URL("../admin-ui/vite.config.ts", import.meta.url)),
  appType: "custom",
  server: { middlewareMode: true, hmr: { server: http } },
});

http.on("request", (req, res) => {
  const path = (req.url ?? "/").split("?")[0]!;
  if (path.startsWith("/api") || path.startsWith("/v1")) return void api(req, res);
  vite.middlewares(req, res, async () => {
    // Not a module or asset: the dashboard page, which also serves its own deep routes on reload.
    try {
      const html = adminUiHtml(await readFile(`${adminUi}index.html`, "utf8"), {});
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(await vite.transformIndexHtml(req.url ?? "/", html));
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      res.writeHead(500).end(String(e));
    }
  });
});

http.listen(port, () => console.log(`sideagent dev on ${publicUrl} (dashboard with hot reload)`));
