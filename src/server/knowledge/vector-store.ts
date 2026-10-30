import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { VectorStore as LangChainVectorStore, type VectorStoreInterface } from "@langchain/core/vectorstores";
import { cosineSimilarity } from "@langchain/core/utils/math";
import { BM25Index } from "./lexical.js";

export interface ChunkMeta {
  sourceId: string;
  title: string;
  /** Only set for sources that came from a URL listed in config. */
  url?: string;
}
export interface Hit {
  text: string;
  score: number;
  meta: ChunkMeta;
}

/**
 * Any LangChain vector store (pgvector, Vectorize, Qdrant, …). Sideagent embeds chunks itself and calls
 * `addVectors` with stable ids (`<sourceId>#<n>`) so a refresh overwrites in place, `delete({ ids })` for chunks
 * that no longer exist, and `similaritySearchVectorWithScore` to search. The store's own `embeddings` are not used.
 *
 * Implement `keywordSearch` (over the same ids) to turn on hybrid retrieval. Its scores may use any scale;
 * sideagent fuses them with the vector ranking by rank, and clamps them to [0, 1] for reporting.
 */
export interface HybridVectorStore extends VectorStoreInterface {
  keywordSearch?(query: string, k: number): Promise<[Document, number][]>;
}
export type VectorStore = HybridVectorStore;

/** Default store: cosine similarity over everything in process memory. */
export class MemoryVectorStore extends LangChainVectorStore {
  declare FilterType: object;
  lc_namespace = ["sideagent", "vectorstores", "memory"];
  private rows = new Map<string, { vector: number[]; doc: Document }>();
  private lexical = new BM25Index();

  constructor(embeddings: EmbeddingsInterface) {
    super(embeddings, {});
  }

  _vectorstoreType() {
    return "sideagent_memory";
  }

  async addVectors(vectors: number[][], documents: Document[], options?: { ids?: string[] }) {
    const ids = documents.map((_, i) => options?.ids?.[i] ?? crypto.randomUUID());
    documents.forEach((doc, i) => {
      this.rows.set(ids[i]!, { vector: vectors[i]!, doc });
      this.lexical.add(ids[i]!, doc.pageContent);
    });
    return ids;
  }

  async addDocuments(documents: Document[], options?: { ids?: string[] }) {
    const vectors = await this.embeddings.embedDocuments(documents.map((d) => d.pageContent));
    return this.addVectors(vectors, documents, options);
  }

  async delete(params?: { ids?: string[] }) {
    for (const id of params?.ids ?? []) {
      this.rows.delete(id);
      this.lexical.delete(id);
    }
  }

  async keywordSearch(query: string, k: number): Promise<[Document, number][]> {
    return this.lexical.search(query, k).map(({ id, score }) => [this.rows.get(id)!.doc, score]);
  }

  async similaritySearchVectorWithScore(query: number[], k: number): Promise<[Document, number][]> {
    const rows = [...this.rows.values()].filter((r) => r.vector.length === query.length);
    if (!rows.length) return [];
    const scores = cosineSimilarity(
      [query],
      rows.map((r) => r.vector),
    )[0]!;
    return rows
      .map((r, i): [Document, number] => [r.doc, scores[i]!])
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);
  }
}
