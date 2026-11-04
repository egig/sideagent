// What a new message costs, and when it is refused before the model runs: the anonymous daily cap
// (D-38), the built-in monthly cap (D-18, D-30) and a stale index. Approvals and history reads are free.
import type { Context } from "hono";
import type { AdminDeps } from "../deps.js";
import { anonDailyMessages, embeddingKey } from "../llm.js";
import type { AgentRecord } from "../store/types.js";
import type { Log } from "./audit.js";
import { sse, uniform } from "./http.js";

/** The response that refuses this message, or null when it may run. */
export async function checkMessageQuota(
  c: Context,
  deps: AdminDeps,
  row: AgentRecord,
  userId: string | null,
  cors: Record<string, string>,
  now: () => number,
  log: Log,
): Promise<Response | null> {
  // Anonymous visitors share a daily cap per agent (D-38), before the monthly one so a refused message costs the
  // owner nothing. Custom models are counted too: the owner's provider bills them.
  if (!userId) {
    const daily = await deps.store.usage.consumeAnon(row.id, anonDailyMessages(deps), new Date(now()));
    if (!daily.allowed) {
      await log({ result: "limited", reason: "anon_daily_cap_reached" });
      return uniform(c, 429, "limit_reached", cors);
    }
  }
  // A new message costs one built-in message; approvals and history reads do not. A custom model is billed by
  // its own provider, so it is not counted (D-18, D-30).
  if (row.config.llm?.provider === "builtin" && deps.builtin) {
    const cap = await deps.builtin.consume(row.ownerId, new Date(now()));
    if (!cap.allowed) {
      await log({ result: "limited", reason: "builtin_cap_reached" });
      return uniform(c, 429, "limit_reached");
    }
  }
  // Passages made by another embedding model are skipped by search: say so instead of "off topic".
  if (await deps.store.knowledge.isStale(row.id, embeddingKey(deps, row.config))) {
    await log({ result: "error", reason: "knowledge_stale" });
    return sse(
      [
        { type: "turn.start", threadId: `thr_${crypto.randomUUID()}` },
        { type: "error", code: "knowledge_stale", message: "The knowledge base needs to be re-indexed." },
        { type: "turn.end" },
      ],
      cors,
    );
  }
  return null;
}
