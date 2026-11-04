// Which model an agent embeds and answers with: the integrator's own OpenAI-compatible endpoint (D-18, D-30).
import { open } from "./crypto.js";
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
export function embeddingKey(config: Pick<AgentRecord["config"], "llm">): string {
  const llm = config.llm;
  return llm ? `openai:${llm.baseUrl}|${llm.embeddingModel}` : "";
}

/** Where knowledge embeddings run for this agent. Throws KnowledgeError when they cannot. */
export async function embedderFor(deps: Pick<AdminDeps, "secrets" | "fetch">, row: AgentRecord): Promise<Embed> {
  const llm = row.config.llm;
  if (!llm || !row.llmKeySealed) throw new KnowledgeError("Add your LLM API key in Settings.");
  const apiKey = await open(deps.secrets, row.id, "llmKey", row.llmKeySealed);
  return embedder({ baseUrl: llm.baseUrl, apiKey, model: llm.embeddingModel }, deps.fetch);
}

/** Whether an anonymous message would be answered now, without counting one (D-38). For `agent.info`. */
export async function anonAvailable(deps: AdminDeps, agent: { id: string }, now = new Date()) {
  return (await deps.store.usage.anonUsed(agent.id, now)) < anonDailyMessages(deps);
}
