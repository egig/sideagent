import { describe, expect, it } from "vitest";
import { BM25Index, tokenize } from "./lexical.js";

describe("tokenize", () => {
  it("lowercases, keeps numbers, drops stop words and punctuation", () => {
    expect(tokenize("How do I get a REFUND-2 within 30 days?")).toEqual(["get", "refund", "2", "within", "30", "days"]);
  });
});

describe("BM25Index", () => {
  const index = () =>
    new BM25Index()
      .add("refunds", "# Refunds\n\nCustomers can request a refund within thirty days.")
      .add("shipping", "# Shipping\n\nOrders ship from the warehouse in two business days.");

  it("ranks the document that contains the query terms first", () => {
    expect(index().search("refund", 2)[0]!.id).toBe("refunds");
    expect(index().search("warehouse", 2)[0]!.id).toBe("shipping");
  });

  it("returns nothing for unmatched or stop-word-only queries", () => {
    expect(index().search("zzz", 2)).toEqual([]);
    expect(index().search("the and of", 2)).toEqual([]);
  });

  it("keeps scores in [0, 1) and returns at most k", () => {
    const found = index().search("order shipping refund", 1);
    expect(found).toHaveLength(1);
    expect(found[0]!.score).toBeGreaterThan(0);
    expect(found[0]!.score).toBeLessThan(1);
  });

  it("re-indexes on add and forgets on delete", () => {
    const ix = index();
    ix.add("refunds", "Warehouse returns are free.");
    expect(ix.search("refund", 2)).toEqual([]);
    expect(ix.search("returns", 2)[0]!.id).toBe("refunds");
    ix.delete("refunds");
    expect(ix.search("returns", 2)).toEqual([]);
  });
});
