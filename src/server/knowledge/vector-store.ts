import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { VectorStore, type VectorStoreInterface } from "@langchain/core/vectorstores";
import { cosineSimilarity } from "@langchain/core/utils/math";

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
 */
export type { VectorStoreInterface as VectorStore };

/** Default store: cosine similarity over everything in process memory. */
export class MemoryVectorStore extends VectorStore {
  declare FilterType: object;
  lc_namespace = ["sideagent", "vectorstores", "memory"];
  private rows = new Map<string, { vector: number[]; doc: Document }>();

  constructor(embeddings: EmbeddingsInterface) {
    super(embeddings, {});
  }

  _vectorstoreType() {
    return "sideagent_memory";
  }

  async addVectors(vectors: number[][], documents: Document[], options?: { ids?: string[] }) {
    const ids = documents.map((_, i) => options?.ids?.[i] ?? crypto.randomUUID());
    documents.forEach((doc, i) => this.rows.set(ids[i]!, { vector: vectors[i]!, doc }));
    return ids;
  }

  async addDocuments(documents: Document[], options?: { ids?: string[] }) {
    const vectors = await this.embeddings.embedDocuments(documents.map((d) => d.pageContent));
    return this.addVectors(vectors, documents, options);
  }

  async delete(params?: { ids?: string[] }) {
    for (const id of params?.ids ?? []) this.rows.delete(id);
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
