// List, create, read, edit (general section) and delete agents.
import { Hono } from "hono";
import type { AgentSummary } from "../api.js";
import { createInput, emptyConfig, generalInput, type AgentConfig } from "../config.js";
import type { AdminDeps } from "../deps.js";
import { newAgentId } from "../ids.js";
import type { AgentRecord } from "../store/types.js";
import { bump, loadRow, notFound, parseBody, type AgentsEnv } from "./context.js";
import { displayStatus, respond, toJson } from "./serialize.js";

export function crudRoutes(deps: AdminDeps) {
  const app = new Hono<AgentsEnv>();

  app.get("/", async (c) => {
    const rows = await deps.store.agents.list(c.get("scope"));
    const agents: AgentSummary[] = rows.map((a) => ({ id: a.id, name: a.name, status: displayStatus(a) }));
    return c.json({ agents });
  });

  app.post("/", async (c) => {
    const body = await parseBody(c, createInput);
    if (!body.ok) return body.response;
    const now = new Date();
    const row: AgentRecord = {
      id: newAgentId(),
      ownerId: c.get("scope"),
      name: body.data.name,
      status: "draft",
      disabledAt: null,
      configVersion: 1,
      config: emptyConfig(),
      llmKeySealed: null,
      llmKeyLast4: null,
      createdAt: now,
      updatedAt: now,
    };
    await deps.store.agents.create(row);
    return c.json(await toJson(deps, row, await deps.store.knowledge.counts(row.id)), 201);
  });

  app.get("/:id", async (c) => respond(c, deps, await loadRow(c, deps)));

  // General: name, allowed origins, instructions.
  app.patch("/:id", async (c) => {
    const body = await parseBody(c, generalInput);
    if (!body.ok) return body.response;
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const { name, ...rest } = body.data;
    const config: AgentConfig = { ...row.config, ...rest };
    return respond(c, deps, await bump(c, deps, { ...(name !== undefined && { name }), config }));
  });

  // The row goes first: once it is gone the agent is unreachable (its knowledge, audit rows and traces go with it).
  // If clearing the threads then fails they are orphaned but unreachable.
  app.delete("/:id", async (c) => {
    const removed = await deps.store.agents.remove(c.get("scope"), c.req.param("id")!);
    if (!removed) return c.json(notFound, 404);
    const id = c.req.param("id")!;
    await Promise.all(removed.userIds.map((u) => deps.destroyThreads?.(id, u)));
    return c.body(null, 204);
  });

  return app;
}
