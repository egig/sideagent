import { cosineSimilarity } from "@langchain/core/utils/math";
import type { Hit } from "./vector-store.js";

export interface SemanticCacheOptions {
  /** Two query embeddings at or above this cosine similarity share a cache entry. */
  minScore: number;
  maxEntries: number;
  ttlMs: number;
}

interface Entry {
  vector: number[];
  hits: Hit[];
  at: number;
}

/**
 * Caches search results by query embedding, so a repeated or slightly reworded question skips the vector
 * store. Per KnowledgeBase instance: no result ever crosses agents. The knowledge version is the cache's
 * lifetime, so a source update clears it and `ttlMs` bounds anything the store changes on its own.
 */
export class SemanticCache {
  private entries: Entry[] = [];

  constructor(private opts: SemanticCacheOptions) {}

  get(vector: number[], now: number): Hit[] | undefined {
    this.dropExpired(now);
    let best = -1;
    let bestScore = this.opts.minScore;
    this.entries.forEach((entry, i) => {
      if (entry.vector.length !== vector.length) return;
      const score = cosineSimilarity([vector], [entry.vector])[0]![0]!;
      if (score >= bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best < 0) return undefined;
    const [entry] = this.entries.splice(best, 1);
    this.entries.push(entry!);
    return entry!.hits.map((h) => ({ ...h, meta: { ...h.meta } }));
  }

  set(vector: number[], hits: Hit[], now: number): void {
    this.dropExpired(now);
    this.entries = this.entries.filter((e) => !(e.vector.length === vector.length && sameVector(e.vector, vector)));
    this.entries.push({ vector, hits, at: now });
    while (this.entries.length > this.opts.maxEntries) this.entries.shift();
  }

  clear(): void {
    this.entries = [];
  }

  private dropExpired(now: number): void {
    this.entries = this.entries.filter((e) => now - e.at < this.opts.ttlMs);
  }
}

function sameVector(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
