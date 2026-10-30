/**
 * A small BM25 index over the chunks a store holds. Hybrid retrieval fuses its ranking with vector search.
 * English stop words only; other languages are indexed as-is.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

const K1 = 1.2;
const B = 0.75;

/** Lowercase word and number tokens, stop words dropped. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOPWORDS.has(t));
}

interface Indexed {
  terms: Map<string, number>;
  length: number;
}

/** BM25 over documents keyed by the same ids the vector store uses. Scores are squashed to [0, 1). */
export class BM25Index {
  private docs = new Map<string, Indexed>();
  private totalLength = 0;

  add(id: string, text: string): this {
    this.delete(id);
    const tokens = tokenize(text);
    const terms = new Map<string, number>();
    for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
    this.docs.set(id, { terms, length: tokens.length });
    this.totalLength += tokens.length;
    return this;
  }

  delete(id: string): void {
    const old = this.docs.get(id);
    if (!old) return;
    this.totalLength -= old.length;
    this.docs.delete(id);
  }

  clear(): void {
    this.docs.clear();
    this.totalLength = 0;
  }

  /** Highest-scoring documents for `query`, best first. Documents sharing no term with it are left out. */
  search(query: string, k: number): { id: string; score: number }[] {
    if (!this.docs.size) return [];
    const queryTerms = [...new Set(tokenize(query))];
    if (!queryTerms.length) return [];

    const n = this.docs.size;
    const avgLength = this.totalLength / n || 1;
    const df = new Map<string, number>(queryTerms.map((t) => [t, 0]));
    for (const doc of this.docs.values()) {
      for (const t of queryTerms) if (doc.terms.has(t)) df.set(t, df.get(t)! + 1);
    }

    const scored: { id: string; score: number }[] = [];
    for (const [id, doc] of this.docs) {
      let score = 0;
      for (const t of queryTerms) {
        const tf = doc.terms.get(t);
        if (!tf) continue;
        const idf = Math.log(1 + (n - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
        score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / avgLength)));
      }
      if (score > 0) scored.push({ id, score: score / (score + 1) });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
