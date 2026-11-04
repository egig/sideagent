// The model behind a hosted agent: the host's built-in one (D-18) or the integrator's own OpenAI-compatible
// endpoint, reached through the SSRF guard (D-30).
import type { CreateAgentOptions } from "../../server/index.js";
import type { AdminDeps } from "../deps.js";
import { open } from "../security/crypto.js";
import { guardedFetch } from "../security/guarded-fetch.js";
import type { AgentRecord } from "../store/types.js";

/** One retry: the SSRF guard's refusals and dead hosts should fail in seconds, not after the clients' full backoff (D-30). */
const LLM_RETRIES = 1;

export type Provider = Pick<CreateAgentOptions, "model" | "embeddings" | "llm"> & {
  embeddingsConfig?: { model: string; fetch: typeof fetch; maxRetries: number };
};

/** `failed` is told every model or embeddings failure, so the router can audit it as a provider failure. */
export async function buildProvider(
  deps: AdminDeps,
  row: AgentRecord,
  failed: (agentId: string, e: unknown) => void,
): Promise<Provider> {
  const llm = row.config.llm;
  // Built-in: the host's model for chat and embeddings. Custom: the library talks to the integrator's endpoint with
  // a guarded fetch, for the chat model and for query embeddings (D-30).
  if (llm?.provider === "builtin") {
    if (!deps.builtin) throw new Error("no built-in model");
    return deps.builtin.models((e) => failed(row.id, e));
  }
  if (!llm || !row.llmKeySealed) throw new Error("no llm key");
  const inner = guardedFetch(deps.resolve, deps.fetch);
  const guarded: typeof fetch = async (input, init) => {
    const res = await inner(input, init).catch((e: unknown) => (failed(row.id, e), Promise.reject(e)));
    if (!res.ok) failed(row.id, new Error(`provider answered HTTP ${res.status}`));
    return res;
  };
  return {
    llm: {
      baseUrl: llm.baseUrl,
      apiKey: await open(deps.secrets, row.id, "llmKey", row.llmKeySealed),
      model: llm.model,
      fetch: guarded,
      maxRetries: LLM_RETRIES,
    },
    embeddingsConfig: { model: llm.embeddingModel, fetch: guarded, maxRetries: LLM_RETRIES },
  };
}
