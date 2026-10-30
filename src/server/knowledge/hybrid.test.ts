import { Document } from "@langchain/core/documents";
import { describe, expect, it } from "vitest";
import { mergeRankings } from "./hybrid.js";

const doc = (id: string, text: string) => new Document({ pageContent: text, metadata: { sourceId: id, title: id } });

describe("mergeRankings", () => {
  it("fuses both rankings by rank and keeps a keyword-only hit", () => {
    const a = doc("a", "refund policy");
    const b = doc("b", "return an item");
    const c = doc("c", "warehouse address");
    const hits = mergeRankings(
      [
        [a, 0.9],
        [b, 0.8],
      ],
      [
        [b, 0.6],
        [c, 0.5],
      ],
      3,
    );
    expect(hits.map((h) => h.meta.sourceId)).toEqual(["b", "a", "c"]);
    expect(hits.find((h) => h.meta.sourceId === "c")!.score).toBe(0.5);
  });

  it("deduplicates a document found by both searches", () => {
    const a = doc("a", "refund policy");
    const hits = mergeRankings([[a, 0.9]], [[a, 0.7]], 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.score).toBe(0.9);
  });

  it("reports the strongest evidence and clamps it to [0, 1]", () => {
    const a = doc("a", "one");
    const b = doc("b", "two");
    const hits = mergeRankings(
      [[a, 0.4]],
      [
        [a, 1.4],
        [b, -1],
      ],
      2,
    );
    expect(hits.find((h) => h.meta.sourceId === "a")!.score).toBe(1);
    expect(hits.find((h) => h.meta.sourceId === "b")!.score).toBe(0);
  });

  it("stops at topK", () => {
    const docs = Array.from({ length: 8 }, (_, i) => doc(String(i), `text ${i}`));
    const hits = mergeRankings(
      docs.map((d, i): [Document, number] => [d, 1 - i / 10]),
      [],
      3,
    );
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.meta.sourceId)).toEqual(["0", "1", "2"]);
  });
});
