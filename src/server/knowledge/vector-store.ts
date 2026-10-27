export interface ChunkMeta {
  sourceId: string;
  title: string;
  /** Only set for sources that came from a URL listed in config. */
  url?: string;
}
export interface StoredChunk {
  text: string;
  vector: number[];
  meta: ChunkMeta;
}
export interface Hit {
  text: string;
  score: number;
  meta: ChunkMeta;
}

/** Plug in your own (pgvector, Vectorize, …). The default is an in-memory cosine store. */
export interface VectorStore {
  replace(sourceId: string, chunks: StoredChunk[]): Promise<void>;
  search(vector: number[], k: number): Promise<Hit[]>;
}

export class MemoryVectorStore implements VectorStore {
  private bySource = new Map<string, StoredChunk[]>();
  async replace(sourceId: string, chunks: StoredChunk[]) {
    this.bySource.set(sourceId, chunks);
  }
  async search(vector: number[], k: number) {
    const hits: Hit[] = [];
    for (const chunks of this.bySource.values()) {
      for (const c of chunks) hits.push({ text: c.text, meta: c.meta, score: cosine(vector, c.vector) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
