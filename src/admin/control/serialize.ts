// The agent as the dashboard reads it. Secrets never appear: the LLM key shows as its last four characters.
import { publishableKey } from "../../keys.js";
import type { AgentDetail } from "../api.js";
import { DEFAULT_TRACE_LEVEL, readiness } from "../config.js";
import type { AdminDeps } from "../deps.js";
import type { AgentRecord, KnowledgeCounts } from "../store/types.js";
import { notFound, type Ctx } from "./context.js";

export const displayStatus = (a: AgentRecord) => (a.disabledAt || a.status !== "active" ? "inactive" : "active");

export async function toJson(deps: AdminDeps, a: AgentRecord, knowledge: KnowledgeCounts): Promise<AgentDetail> {
  const origin = new URL(deps.publicUrl);
  return {
    agent: {
      id: a.id,
      name: a.name,
      status: displayStatus(a),
      configVersion: a.configVersion,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      publishableKey: publishableKey(origin.host, a.id),
      endpoint: `${origin.origin}/v1/agents/${a.id}`,
      allowedOrigins: a.config.allowedOrigins,
      instructions: a.config.instructions,
      llm: a.config.llm,
      llmKey: a.llmKeyLast4 ? { last4: a.llmKeyLast4 } : null,
      auth: a.config.auth,
      tracing: a.config.tracing ?? DEFAULT_TRACE_LEVEL,
      knowledge,
    },
    readiness: readiness(a.config, {
      knowledgeSources: knowledge.sources - knowledge.failed,
      failedSources: knowledge.failed,
      hasLlmKey: a.llmKeyLast4 !== null,
    }),
  };
}

/** 404 for a missing or foreign agent, else the full agent detail. */
export async function respond(c: Ctx, deps: AdminDeps, row: AgentRecord | null) {
  if (!row) return c.json(notFound, 404);
  return c.json(await toJson(deps, row, await deps.store.knowledge.counts(row.id)));
}
