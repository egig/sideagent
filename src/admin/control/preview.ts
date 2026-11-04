// Agent preview (D-31): the owner talks to their own agent from the dashboard, in any status. The session, the owner
// check (another owner's agent is a 404) and the dashboard origin (D-10) are settled here; the turn itself is the data
// plane's own flow, so the owner tests what end users get.
import { Hono } from "hono";
import type { AdminDeps } from "../deps.js";
import { loadRow, notFound, type AgentsEnv } from "./context.js";

/** The throwaway user id a preview chats as. */
export const previewUserId = (ownerId: string) => `preview:${ownerId}`;

export function previewRoutes(deps: AdminDeps) {
  const app = new Hono<AgentsEnv>();

  app.post("/:id/preview", async (c) => {
    const row = await loadRow(c, deps);
    if (!row || !deps.preview) return c.json(notFound, 404);
    return deps.preview(c.req.raw, row, c.get("user").id);
  });

  // The preview chats are throwaway: this removes every one of them for this owner and agent.
  app.delete("/:id/preview/threads", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    await deps.destroyThreads?.(row.id, previewUserId(c.get("user").id));
    return c.json({ ok: true });
  });

  return app;
}
