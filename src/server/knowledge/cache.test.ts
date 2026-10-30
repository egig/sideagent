import { describe, expect, it } from "vitest";
import { SemanticCache } from "./cache.js";
import type { Hit } from "./vector-store.js";

const hit = (text: string): Hit => ({ text, score: 0.8, meta: { sourceId: "a", title: "A" } });
const cache = (over: Partial<ConstructorParameters<typeof SemanticCache>[0]> = {}) =>
  new SemanticCache({ minScore: 0.9, maxEntries: 10, ttlMs: 1000, ...over });

describe("SemanticCache", () => {
  it("answers a near-identical query and misses a different one", () => {
    const c = cache();
    c.set([1, 0], [hit("refund")], 0);
    expect(c.get([0.99, 0.14], 1)?.[0]!.text).toBe("refund");
    expect(c.get([0, 1], 1)).toBeUndefined();
  });

  it("respects the similarity floor", () => {
    const c = cache({ minScore: 1 });
    c.set([1, 0], [hit("exact")], 0);
    expect(c.get([1, 0.1], 1)).toBeUndefined();
    expect(c.get([1, 0], 1)?.[0]!.text).toBe("exact");
  });

  it("expires entries after ttlMs", () => {
    const c = cache({ ttlMs: 50 });
    c.set([1, 0], [hit("old")], 0);
    expect(c.get([1, 0], 40)).toBeDefined();
    expect(c.get([1, 0], 50)).toBeUndefined();
  });

  it("evicts the least recently used entry", () => {
    const c = cache({ maxEntries: 2 });
    c.set([1, 0], [hit("a")], 0);
    c.set([0, 1], [hit("b")], 1);
    expect(c.get([1, 0], 2)?.[0]!.text).toBe("a");
    c.set([1, 1], [hit("c")], 3);
    expect(c.get([0, 1], 4)).toBeUndefined();
    expect(c.get([1, 0], 4)).toBeDefined();
  });

  it("returns a copy, so callers cannot mutate the cache", () => {
    const c = cache({ minScore: 0 });
    c.set([1, 0], [hit("safe")], 0);
    const first = c.get([1, 0], 1)!;
    first[0]!.text = "changed";
    first[0]!.meta.title = "changed";
    first.push(hit("extra"));
    expect(c.get([1, 0], 2)).toEqual([hit("safe")]);
  });

  it("clears everything", () => {
    const c = cache();
    c.set([1, 0], [hit("x")], 0);
    c.clear();
    expect(c.get([1, 0], 0)).toBeUndefined();
  });
});
