// Activate and deactivate.
import { Hono } from "hono";
import type { AdminDeps } from "../deps.js";
import { bump, loadRow, notFound, type AgentsEnv } from "./context.js";
import { respond, toJson } from "./serialize.js";

export function lifecycleRoutes(deps: AdminDeps) {
  const app = new Hono<AgentsEnv>();

  app.post("/:id/activate", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const detail = await toJson(deps, row, await deps.store.knowledge.counts(row.id));
    if (detail.readiness.some((r) => !r.ok)) return c.json({ error: "not_ready", readiness: detail.readiness }, 409);
    return respond(c, deps, await bump(c, deps, { status: "active", disabledAt: null }));
  });

  app.post("/:id/deactivate", async (c) => respond(c, deps, await bump(c, deps, { disabledAt: new Date() })));

  return app;
}
