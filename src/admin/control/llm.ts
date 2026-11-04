// The host's built-in model (D-18) or the integrator's own OpenAI-compatible provider.
import { Hono } from "hono";
import { llmInput } from "../config.js";
import { seal } from "../security/crypto.js";
import type { AdminDeps } from "../deps.js";
import { scheduleIndexing } from "../knowledge/sources.js";
import type { AgentChange } from "../store/types.js";
import { bump, checkHosts, invalid, loadRow, notFound, parseBody, type AgentsEnv } from "./context.js";
import { respond } from "./serialize.js";

export function llmRoutes(deps: AdminDeps) {
  const app = new Hono<AgentsEnv>();

  // Changing where embeddings run re-indexes all knowledge.
  app.put("/:id/llm", async (c) => {
    const body = await parseBody(c, llmInput);
    if (!body.ok) return body.response;
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const before = row.config.llm;
    let set: AgentChange & { config: NonNullable<AgentChange["config"]> };
    if (body.data.provider === "builtin") {
      if (!deps.builtin) return invalid(c, { provider: "The built-in model is not available." });
      // The stored key is kept so switching back needs no re-entry.
      set = { config: { ...row.config, llm: { provider: "builtin" } } };
    } else {
      const { apiKey, ...llm } = body.data;
      if (!apiKey && !row.llmKeySealed) return invalid(c, { apiKey: "API key is required." });
      const hostErrors = await checkHosts(deps, { baseUrl: llm.baseUrl });
      if (Object.keys(hostErrors).length) return invalid(c, hostErrors);
      set = {
        config: { ...row.config, llm },
        ...(apiKey && {
          llmKeySealed: await seal(deps.secrets, row.id, "llmKey", apiKey),
          llmKeyLast4: apiKey.slice(-4),
        }),
      };
    }
    const after = set.config.llm;
    const embeddingsMoved =
      before?.provider !== after?.provider ||
      (before?.provider === "custom" &&
        after?.provider === "custom" &&
        (before.baseUrl !== after.baseUrl || before.embeddingModel !== after.embeddingModel));
    const updated = await bump(c, deps, set);
    if (updated && embeddingsMoved && (await deps.store.knowledge.markAllPending(updated.id)) > 0)
      scheduleIndexing(deps, updated);
    return respond(c, deps, updated);
  });

  return app;
}
