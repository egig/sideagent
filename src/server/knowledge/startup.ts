import type { AgentConfig } from "../config.js";
import { createEmbeddings, type EmbeddingsLike } from "../model.js";
import { KnowledgeBase, type KnowledgeRerankerOption, type VectorStore } from "./index.js";

const KNOWLEDGE_STARTUP_WAIT_MS = 60_000;

/** Builds the knowledge base and loads it, but waits for a slow embeddings host only so long. */
export async function startKnowledge(
  config: AgentConfig,
  givenEmbeddings: EmbeddingsLike | undefined,
  store: VectorStore | undefined,
  reranker: Exclude<KnowledgeRerankerOption, true> | undefined,
) {
  const k = config.knowledge;
  // parseConfig guarantees exactly one of the two sources
  const embedder = givenEmbeddings ?? createEmbeddings(k.embeddings!, config.llm);
  const knowledge = new KnowledgeBase(k, {
    embedDocuments: (t) => embedder.embedDocuments(t),
    embedQuery: (t) => embedder.embedQuery(t),
    reranker,
    store,
    allowPrivateNetworks: config.allowPrivateNetworks,
  });
  // Don't let a slow or dead embeddings host block startup forever; loading continues in the background.
  const loading = knowledge.load();
  const timedOut = await Promise.race([
    loading.then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), KNOWLEDGE_STARTUP_WAIT_MS)),
  ]);
  if (timedOut)
    console.warn(
      "[sideagent] knowledge is still loading after 60s; search results may be incomplete until it finishes.",
    );
  return knowledge;
}
