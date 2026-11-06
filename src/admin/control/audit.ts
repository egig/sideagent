// Audit log and traces: filters are exact matches; an unknown value is ignored, not an error.
import { Hono } from "hono";
import { tracingInput } from "../config.js";
import type { AdminDeps } from "../deps.js";
import { AUDIT_RANGES, AUDIT_RESULTS } from "../retention.js";
import type { AuditQuery, AuditResult } from "../store/types.js";
import { bump, loadRow, notFound, parseBody, type AgentsEnv } from "./context.js";
import { respond } from "./serialize.js";

const pageOf = (raw: string | undefined) => Math.max(1, Math.min(10_000, Number.parseInt(raw ?? "1", 10) || 1));

export function auditRoutes(deps: AdminDeps) {
  const app = new Hono<AgentsEnv>();

  app.get("/:id/audit", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const q = c.req.query();
    const range = (q.range && q.range in AUDIT_RANGES ? q.range : "7d") as AuditQuery["range"];
    return c.json(
      await deps.store.audit.listEvents(row.id, {
        range,
        page: pageOf(q.page),
        result: AUDIT_RESULTS.includes(q.result as AuditResult) ? (q.result as AuditResult) : undefined,
        event: q.event?.slice(0, 64) || undefined,
        user: q.user?.slice(0, 256) || undefined,
      }),
    );
  });

  // The Overview's numbers: this window and the one before it.
  app.get("/:id/stats", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const range = c.req.query("range") === "24h" ? "24h" : "7d";
    return c.json(await deps.store.audit.stats(row.id, range));
  });

  // How much of each turn is recorded for the trace view (D-35). Takes effect on the next turn.
  app.put("/:id/tracing", async (c) => {
    const body = await parseBody(c, tracingInput);
    if (!body.ok) return body.response;
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    return respond(c, deps, await bump(c, deps, { config: { ...row.config, tracing: body.data.level } }));
  });

  app.get("/:id/traces", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const q = c.req.query();
    const status = q.status === "ok" || q.status === "error" ? q.status : undefined;
    return c.json(
      await deps.store.audit.listTraces(row.id, {
        page: pageOf(q.page),
        status,
        user: q.user?.slice(0, 256) || undefined,
      }),
    );
  });

  app.get("/:id/traces/:traceId", async (c) => {
    const row = await loadRow(c, deps);
    const trace = row && (await deps.store.audit.getTrace(row.id, c.req.param("traceId")));
    return trace ? c.json(trace) : c.json(notFound, 404);
  });

  return app;
}
