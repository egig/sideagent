// The admin's HTTP app: the dashboard API under /api. The data plane (/v1/agents) is mounted next to it by createAdmin.
// Sign-in itself is the host's (deps.session); this only guards the routes and the origin.
import { Hono, type MiddlewareHandler } from "hono";
import { agentsRouter } from "./control/router.js";
import type { AgentsEnv } from "./control/context.js";
import { DEFAULT_SCOPE, type AdminDeps } from "./deps.js";

// hono/logger prints the query string, which carries OAuth codes and magic-link tokens. Log the path only (D-4).
const pathLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
};

// The session cookie rides along on cross-site form posts from sibling subdomains (SameSite=Lax treats them as
// same-site). Writes must come from the dashboard's own origin (D-10).
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createAdminApi(deps: AdminDeps) {
  const origin = new URL(deps.publicUrl).origin;
  const app = new Hono();
  app.use("*", pathLogger);
  app.get("/api/health", (c) => c.json({ ok: true }));

  const api = new Hono<AgentsEnv>();
  api.use("*", async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header("origin") !== origin)
      return c.json({ error: "forbidden" }, 403);
    const user = await deps.session(c.req.raw);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    c.set("scope", (await deps.scope?.(user, c.req.raw)) || DEFAULT_SCOPE);
    await next();
  });
  api.get("/me", (c) => {
    const { id, email, name, image } = c.get("user");
    return c.json({ user: { id, email, name, image } });
  });
  api.route("/agents", agentsRouter(deps));
  app.route("/api", api);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    // Clients only ever see the uniform body (D-4). Production errors may echo request details, so they stay out of the logs.
    if (deps.debug) console.error(`${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
