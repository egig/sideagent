// Which model an agent embeds and answers with: the integrator's own OpenAI-compatible endpoint (D-18, D-30).
import { open } from "./security/crypto.js";
import { BlockedUrlError } from "./security/url-guard.js";
import type { AdminDeps } from "./deps.js";
import { embedder, KnowledgeError, type Embed } from "./knowledge/ingest.js";
import type { AgentRecord } from "./store/types.js";

export const DEFAULT_ANON_DAILY_MESSAGES = 25;

export const anonDailyMessages = (deps: Pick<AdminDeps, "anonDailyMessages">) => {
  const limit = deps.anonDailyMessages;
  return limit !== undefined && Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_ANON_DAILY_MESSAGES;
};

/**
 * Names the embedding model behind an agent's vectors (D-30). Query and document vectors must come from the same
 * one; a source indexed under another key is skipped by search until it is re-indexed.
 */
export function embeddingKey(deps: Pick<AdminDeps, "builtin">, config: Pick<AgentRecord["config"], "llm">): string {
  const llm = config.llm;
  if (!llm) return "";
  if (llm.provider === "builtin") return deps.builtin ? `builtin:${deps.builtin.embeddingModel}` : "";
  return `openai:${llm.baseUrl}|${llm.embeddingModel}`;
}

/** Where knowledge embeddings run for this agent. Throws KnowledgeError when they cannot. */
export async function embedderFor(
  deps: Pick<AdminDeps, "secrets" | "fetch" | "builtin">,
  row: AgentRecord,
): Promise<Embed> {
  const llm = row.config.llm;
  if (llm?.provider === "builtin") {
    if (!deps.builtin) throw new KnowledgeError("Built-in embeddings are not configured on this server.");
    return deps.builtin.embed;
  }
  if (!llm || !row.llmKeySealed) throw new KnowledgeError("Add your LLM API key in Settings.");
  const apiKey = await open(deps.secrets, row.id, "llmKey", row.llmKeySealed);
  return embedder({ baseUrl: llm.baseUrl, apiKey, model: llm.embeddingModel }, deps.fetch);
}

/** Whether an anonymous message would be answered now, without counting one (D-38). For `agent.info`. */
export async function anonAvailable(
  deps: AdminDeps,
  agent: { id: string; ownerId: string; builtin: boolean },
  now = new Date(),
) {
  if ((await deps.store.usage.anonUsed(agent.id, now)) >= anonDailyMessages(deps)) return false;
  if (!agent.builtin || !deps.builtin) return true;
  const { used, limit } = await deps.builtin.usage(agent.ownerId, now);
  return used < limit;
}

/** A coarse reason for the owner. Reads only an HTTP status and our own error classes, never the provider's words. */
export function llmErrorCode(e: unknown): string {
  if (e instanceof BlockedUrlError) return "llm_unreachable";
  const status = String(
    (e as { status?: number } | null)?.status ?? /HTTP (\d{3})/.exec(e instanceof Error ? e.message : "")?.[1],
  );
  if (status === "401" || status === "403") return "llm_auth";
  if (status === "404") return "llm_model_not_found";
  if (status === "429") return "llm_rate_limited";
  if (e instanceof TypeError || (e instanceof Error && e.name === "TimeoutError")) return "llm_unreachable";
  return "llm_error";
}
