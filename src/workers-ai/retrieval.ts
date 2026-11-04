import type { KnowledgeReranker } from "../server/knowledge/index.js";
import type { WorkersAiBinding } from "./chat.js";

const EMBED_BATCH = 100;

/** Embeddings backed by the Workers AI binding. Pass them to createAgent as `embeddings`. */
export function workersAiEmbeddings(ai: WorkersAiBinding, model: string) {
  async function embedDocuments(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const res: any = await ai.run(model, { text: batch });
      const data = res?.data ?? res?.result?.data;
      if (!Array.isArray(data) || data.length !== batch.length || !data.every((v: unknown) => Array.isArray(v))) {
        throw new Error("Workers AI returned an unrecognized embeddings response");
      }
      out.push(...(data as number[][]));
    }
    return out;
  }
  return {
    embedDocuments,
    async embedQuery(text: string): Promise<number[]> {
      return (await embedDocuments([text]))[0]!;
    },
  };
}

/** A cross-encoder reranker backed by Workers AI. Defaults to BAAI's bge-reranker-base model. */
export function workersAiReranker(ai: WorkersAiBinding, model = "@cf/baai/bge-reranker-base"): KnowledgeReranker {
  return async (query, candidates) => {
    const result: any = await ai.run(model, {
      query,
      top_k: candidates.length,
      contexts: candidates.map(({ text }) => ({ text })),
    });
    const response = result?.response ?? result?.result?.response;
    if (!Array.isArray(response) || response.length !== candidates.length) {
      throw new Error("Workers AI returned an unrecognized reranker response");
    }
    const scores = Array<number>(candidates.length);
    for (const item of response) {
      if (
        !item ||
        !Number.isInteger(item.id) ||
        item.id < 0 ||
        item.id >= candidates.length ||
        !Number.isFinite(item.score) ||
        scores[item.id] !== undefined
      ) {
        throw new Error("Workers AI returned an unrecognized reranker response");
      }
      scores[item.id] = item.score;
    }
    if (scores.some((score) => !Number.isFinite(score))) {
      throw new Error("Workers AI returned an unrecognized reranker response");
    }
    return scores;
  };
}
