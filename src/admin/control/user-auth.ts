// How the agent identifies end users (data-plane auth mode). Not the integrator's own sign-in.
import { Hono } from "hono";
import { authInput } from "../config.js";
import type { AdminDeps } from "../deps.js";
import { bump, checkHosts, invalid, loadRow, notFound, parseBody, type AgentsEnv } from "./context.js";
import { respond } from "./serialize.js";

export function userAuthRoutes(deps: AdminDeps) {
  const app = new Hono<AgentsEnv>();

  app.put("/:id/auth", async (c) => {
    const body = await parseBody(c, authInput);
    if (!body.ok) return body.response;
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const auth = body.data;
    const hostErrors = await checkHosts(deps, {
      jwksUrl: auth.mode === "jwks" ? auth.jwksUrl : null,
      url: auth.mode === "userinfo" ? auth.url : null,
    });
    if (Object.keys(hostErrors).length) return invalid(c, hostErrors);
    return respond(c, deps, await bump(c, deps, { config: { ...row.config, auth } }));
  });

  return app;
}
