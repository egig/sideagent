// Types and helpers shared by the agent sub-routers. Every lookup goes through the store's scoped methods (the scope is the host's `scope` hook, one workspace by
// default), so another scope's agent is indistinguishable from a missing one (D-9).
import type { Context } from "hono";
import type { z } from "zod";
import type { AdminDeps, AdminUser } from "../deps.js";
import { fieldErrors, normalizeConfig } from "../config.js";
import { assertPublicUrl, BlockedUrlError } from "../url-guard.js";
import type { AgentChange, AgentRecord } from "../store/types.js";

export type AgentsEnv = { Variables: { user: AdminUser; scope: string } };
export type Ctx = Context<AgentsEnv>;

export const notFound = { error: "not_found" } as const;

export async function readJson(c: Ctx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export async function parseBody<T extends z.ZodType>(c: Ctx, schema: T) {
  const result = schema.safeParse(await readJson(c));
  return result.success
    ? ({ ok: true, data: result.data } as const)
    : ({ ok: false, response: c.json({ error: "invalid_request", fields: fieldErrors(result.error) }, 400) } as const);
}

export const invalid = (c: Ctx, fields: Record<string, string>) => c.json({ error: "invalid_request", fields }, 400);

const withConfig = (row: AgentRecord): AgentRecord => ({ ...row, config: normalizeConfig(row.config) });

/** The agent from `:id` in the user's scope from `:id`, or null. */
export async function loadRow(c: Ctx, deps: AdminDeps) {
  const row = await deps.store.agents.getOwned(c.get("scope"), c.req.param("id")!);
  return row ? withConfig(row) : null;
}

/** Applies the change and bumps configVersion atomically, scoped to the owner. Null: the agent is gone or foreign. */
export async function bump(c: Ctx, deps: AdminDeps, change: AgentChange) {
  const row = await deps.store.agents.update(c.get("scope"), c.req.param("id")!, change);
  return row ? withConfig(row) : null;
}

// Save-time SSRF check with DNS (PRD 6.6 item 1). Syntax was checked by zod.
export async function checkHosts(deps: AdminDeps, urls: Record<string, string | null | undefined>) {
  const fields: Record<string, string> = {};
  for (const [field, url] of Object.entries(urls)) {
    if (!url) continue;
    try {
      await assertPublicUrl(url, deps.resolve);
    } catch (e) {
      if (!(e instanceof BlockedUrlError)) throw e;
      fields[field] = e.message;
    }
  }
  return fields;
}
