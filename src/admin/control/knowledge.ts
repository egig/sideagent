// Knowledge sources: web pages (fetched and indexed in the background) or pasted text.
import { Hono } from "hono";
import { knowledgeInput } from "../config.js";
import type { AdminDeps } from "../deps.js";
import { addSource, scheduleIndexing } from "../knowledge/sources.js";
import { bump, checkHosts, invalid, loadRow, notFound, parseBody, type AgentsEnv } from "./context.js";

export function knowledgeRoutes(deps: AdminDeps) {
  const app = new Hono<AgentsEnv>();

  app.get("/:id/knowledge", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    return c.json({ sources: await deps.store.knowledge.listSources(row.id) });
  });

  app.post("/:id/knowledge", async (c) => {
    const body = await parseBody(c, knowledgeInput);
    if (!body.ok) return body.response;
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    if (body.data.kind === "url") {
      const hostErrors = await checkHosts(deps, { url: body.data.url });
      if (Object.keys(hostErrors).length) return invalid(c, hostErrors);
    }
    const result = await addSource(deps, row.id, body.data);
    if ("error" in result) return invalid(c, { [body.data.kind === "url" ? "url" : "content"]: result.error });
    scheduleIndexing(deps, row);
    await bump(c, deps, {});
    return c.json({ source: result.source }, 201);
  });

  app.delete("/:id/knowledge/:sourceId", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    if (!(await deps.store.knowledge.removeSource(row.id, c.req.param("sourceId")))) return c.json(notFound, 404);
    await bump(c, deps, {});
    return c.body(null, 204);
  });

  app.post("/:id/knowledge/reindex", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const queued = await deps.store.knowledge.markAllPending(row.id);
    if (queued) scheduleIndexing(deps, row);
    return c.json({ queued });
  });

  return app;
}
