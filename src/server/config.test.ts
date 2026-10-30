import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const base = {
  llm: { baseUrl: "https://llm.example.com/v1", apiKey: "k", model: "m" },
  allowedOrigins: ["https://app.example.com"],
  knowledge: {
    sources: [{ id: "a", title: "A", content: "x" }],
    embeddings: { model: "m", baseUrl: "https://e.example.com", apiKey: "k" },
  },
};

describe("parseConfig", () => {
  it("applies default limits", () => {
    expect(parseConfig(base, true).limits.maxSteps).toBe(8);
  });
  it("rejects missing getAuth without anonymous", () => {
    expect(() => parseConfig(base, false)).toThrow(/getAuth/);
  });
  it("accepts explicit anonymous", () => {
    expect(parseConfig({ ...base, anonymous: true }, false).anonymous).toBe(true);
  });
  it("rejects empty origins", () => {
    expect(() => parseConfig({ ...base, allowedOrigins: [] }, true)).toThrow(/allowedOrigins/);
  });
  it("rejects unknown keys", () => {
    expect(() => parseConfig({ ...base, bogus: 1 }, true)).toThrow();
  });
  it("requires knowledge", () => {
    const { knowledge: _k, ...bare } = base;
    expect(() => parseConfig(bare, true)).toThrow(/knowledge/);
  });
  it("no longer takes operations", () => {
    for (const key of ["spec", "baseUrl", "allow", "approvalSecret"]) {
      expect(() => parseConfig({ ...base, [key]: key === "allow" ? [] : "x" }, true)).toThrow();
    }
  });
  it("fills in scope defaults", () => {
    expect(parseConfig({ ...base, scope: {} }, true).scope?.minScore).toBe(0.45);
  });
  it("fills in hybrid and cache defaults", () => {
    const knowledge = parseConfig(base, true).knowledge;
    expect(knowledge.hybrid).toBe(true);
    expect(knowledge.cache).toEqual({ enabled: true, minScore: 0.97, maxEntries: 100, ttlMs: 300_000 });
  });
  it("rejects unknown hybrid and cache options", () => {
    expect(() => parseConfig({ ...base, knowledge: { ...base.knowledge, hybrid: "yes" } }, true)).toThrow();
    expect(() => parseConfig({ ...base, knowledge: { ...base.knowledge, cache: { nope: 1 } } }, true)).toThrow();
  });
});
