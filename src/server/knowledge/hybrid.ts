import type { Document } from "@langchain/core/documents";
import type { ChunkMeta, Hit } from "./vector-store.js";

/** Standard reciprocal-rank-fusion constant: damps the difference between the first few ranks. */
const RRF_K = 60;

const keyOf = (doc: Document) => `${(doc.metadata as Partial<ChunkMeta>).sourceId ?? ""}\u0000${doc.pageContent}`;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

interface Candidate {
  doc: Document;
  cosine?: number;
  lexical?: number;
  rrf: number;
}

/**
 * Merges the semantic and lexical rankings with reciprocal rank fusion, so neither score scale has to be
 * comparable. The reported `score` is the best evidence for the chunk: its cosine similarity or its lexical
 * score, whichever is higher. `topK` is the only thing that decides what is returned.
 */
export function mergeRankings(semantic: [Document, number][], lexical: [Document, number][], topK: number): Hit[] {
  const found = new Map<string, Candidate>();
  const add = (list: [Document, number][], kind: "cosine" | "lexical") => {
    list.forEach(([doc, score], i) => {
      const key = keyOf(doc);
      let c = found.get(key);
      if (!c) found.set(key, (c = { doc, rrf: 0 }));
      if (kind === "cosine") c.cosine = Math.max(c.cosine ?? -Infinity, score);
      else c.lexical = Math.max(c.lexical ?? 0, score);
      c.rrf += 1 / (RRF_K + i + 1);
    });
  };
  add(semantic, "cosine");
  add(lexical, "lexical");

  return [...found.values()]
    .sort(
      (a, b) =>
        b.rrf - a.rrf || (b.cosine ?? -Infinity) - (a.cosine ?? -Infinity) || (b.lexical ?? 0) - (a.lexical ?? 0),
    )
    .slice(0, topK)
    .map((c) => ({
      text: c.doc.pageContent,
      score: clamp(Math.max(c.cosine ?? 0, c.lexical ?? 0)),
      meta: c.doc.metadata as ChunkMeta,
    }));
}
