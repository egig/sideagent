// The host's built-in model (D-18) or the integrator's own OpenAI-compatible provider.
import { Hono } from "hono";
import { llmInput } from "../config.js";
import type { LlmCheck, LlmCheckPart } from "../api.js";
import { llmErrorCode } from "../llm.js";
import { open, seal } from "../security/crypto.js";
import { guardedFetch } from "../security/guarded-fetch.js";
import type { AdminDeps } from "../deps.js";
import { scheduleIndexing } from "../knowledge/sources.js";
import type { AgentChange, AgentRecord } from "../store/types.js";
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
    // A new key is often the fix for sources that failed to index: try them again.
    const retry =
      !embeddingsMoved &&
      body.data.provider === "custom" &&
      !!body.data.apiKey &&
      (await deps.store.knowledge.listSources(row.id)).some((s) => s.status === "failed");
    if (updated && (embeddingsMoved || retry) && (await deps.store.knowledge.markAllPending(updated.id)) > 0)
      scheduleIndexing(deps, updated);
    return respond(c, deps, updated);
  });

  // Tries the saved settings with one tiny chat call and one embedding call, so a wrong key or model shows before
  // knowledge fails to index. Answers with our own reason codes only: provider bodies can echo keys (D-31).
  app.post("/:id/llm/check", async (c) => {
    const row = await loadRow(c, deps);
    if (!row) return c.json(notFound, 404);
    const llm = row.config.llm;
    if (llm?.provider === "builtin") {
      if (!deps.builtin) return invalid(c, { provider: "The built-in model is not available." });
      return c.json({ chat: { ok: true }, embeddings: { ok: true } } satisfies LlmCheck);
    }
    if (!llm || !row.llmKeySealed) return invalid(c, { apiKey: "Save the LLM settings with an API key first." });
    return c.json(await checkCustom(deps, row, llm));
  });

  return app;
}

const CHECK_TIMEOUT_MS = 15_000;

async function checkCustom(
  deps: AdminDeps,
  row: AgentRecord,
  llm: { baseUrl: string; model: string; embeddingModel: string },
): Promise<LlmCheck> {
  const apiKey = await open(deps.secrets, row.id, "llmKey", row.llmKeySealed!);
  const fetcher = guardedFetch(deps.resolve, deps.fetch);
  const base = llm.baseUrl.replace(/\/+$/, "");
  const call = async (path: string, body: unknown): Promise<LlmCheckPart> => {
    try {
      const res = await fetcher(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      // The body is drained unread: only the status is reported.
      await res.body?.cancel();
      return res.ok ? { ok: true } : { ok: false, reason: llmErrorCode({ status: res.status }) };
    } catch (e) {
      return { ok: false, reason: llmErrorCode(e) };
    }
  };
  const [chat, embeddings] = await Promise.all([
    call("/chat/completions", { model: llm.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    call("/embeddings", { model: llm.embeddingModel, input: ["ping"] }),
  ]);
  return { chat, embeddings };
}
