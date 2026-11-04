// Adding and indexing knowledge sources. The store keeps the rows and vectors; the limits and the page fetching live here
// so every database enforces the same ones.
import { assertPublicUrl } from "../url-guard.js";
import type { AdminDeps } from "../deps.js";
import { embedderFor, embeddingKey } from "../llm.js";
import type { AgentRecord, SourceInput } from "../store/types.js";
import type { KnowledgeSource } from "../api.js";
import {
  chunkText,
  fetchPage,
  KnowledgeError,
  KNOWLEDGE_MAX_SOURCES,
  MAX_CHUNKS,
  SOURCE_MAX_BYTES,
  TITLE_MAX,
} from "./ingest.js";

export type NewSource = { kind: "url"; url: string; title?: string } | { kind: "text"; title: string; content: string };

/** Validation of shape and URL safety happens in the route; this enforces counts and sizes. */
export async function addSource(
  deps: Pick<AdminDeps, "store">,
  agentId: string,
  input: NewSource,
): Promise<{ source: KnowledgeSource } | { error: string }> {
  const { store } = deps;
  const existing = await store.knowledge.listSources(agentId);
  if (existing.length >= KNOWLEDGE_MAX_SOURCES)
    return { error: `${KNOWLEDGE_MAX_SOURCES} sources at most. Remove one first.` };
  if (input.kind === "url" && existing.some((s) => s.kind === "url" && s.url === input.url))
    return { error: "That page is already a source." };
  if (input.kind === "text" && new TextEncoder().encode(input.content).byteLength > SOURCE_MAX_BYTES)
    return { error: "Text is larger than 200 KB." };
  const row: SourceInput =
    input.kind === "url"
      ? { kind: "url", title: (input.title?.trim() || input.url).slice(0, TITLE_MAX), url: input.url }
      : { kind: "text", title: (input.title.trim() || "Untitled").slice(0, TITLE_MAX), content: input.content };
  return { source: await store.knowledge.addSource(agentId, row) };
}

/**
 * Indexes queued sources one by one. A failure is recorded on that source and never stops the others. Sources left
 * "indexing" by a worker that died are picked up again. Returns how many it took.
 */
export async function indexPending(deps: AdminDeps, agent: AgentRecord): Promise<number> {
  const { store } = deps;
  let embed: (texts: string[]) => Promise<Float32Array[]>;
  try {
    embed = await embedderFor(deps, agent);
    // A customer embeddings URL is checked again at call time (D-11).
    if (agent.config.llm) await assertPublicUrl(agent.config.llm.baseUrl, deps.resolve);
  } catch (e) {
    const failure = e instanceof KnowledgeError ? e : new KnowledgeError("The embeddings provider URL is blocked.");
    embed = async () => {
      throw failure;
    };
  }
  const key = embeddingKey(agent.config);
  const queued = await store.knowledge.claimPending(agent.id);
  for (const s of queued) {
    try {
      let text = s.content ?? "";
      let title = s.title;
      if (s.kind === "url") {
        const page = await fetchPage(s.url!, deps.resolve, deps.fetch);
        text = page.text;
        if (title === s.url && page.title) title = page.title.slice(0, TITLE_MAX);
      }
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > SOURCE_MAX_BYTES) throw new KnowledgeError("Content is larger than 200 KB.");
      const texts = chunkText(text);
      if (texts.length === 0) throw new KnowledgeError("No text found.");
      if ((await store.knowledge.chunksOutside(agent.id, s.id)) + texts.length > MAX_CHUNKS) {
        throw new KnowledgeError(`Knowledge would exceed ${MAX_CHUNKS} chunks.`);
      }
      const vectors = await embed(texts);
      if (vectors.length !== texts.length)
        throw new KnowledgeError("The embeddings provider returned an unexpected response.");
      await store.knowledge.saveIndexed(agent.id, s.id, {
        title,
        bytes,
        embedKey: key,
        texts,
        vectors: vectors.map((v) => Array.from(v)),
      });
    } catch (e) {
      await store.knowledge.markFailed(agent.id, s.id, e instanceof KnowledgeError ? e.message : "Indexing failed.");
    }
  }
  return queued.length;
}

/** Runs the indexer after the response, and again while sources are still queued (a source added during a run). */
export function scheduleIndexing(deps: AdminDeps, agent: AgentRecord): void {
  const run = async () => {
    for (let round = 0; round < 5; round++) {
      // Re-read: the embedding settings may have changed since this was queued.
      const fresh = await deps.store.agents.get(agent.id);
      if (!fresh) return;
      if ((await indexPending(deps, fresh)) === 0) return;
    }
  };
  const work = () => run().catch(() => console.error("indexing failed"));
  (deps.background ?? ((start) => void start()))(work);
}
