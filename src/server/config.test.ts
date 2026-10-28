import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const base = {
  spec: {},
  baseUrl: "https://api.example.com",
  llm: { baseUrl: "https://llm.example.com/v1", apiKey: "k", model: "m" },
  allow: ["listInvoices"],
  allowedOrigins: ["https://app.example.com"],
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
  it("rejects empty allowlist and origins", () => {
    expect(() => parseConfig({ ...base, allow: [] }, true)).toThrow(/allow is empty/);
    expect(() => parseConfig({ ...base, allowedOrigins: [] }, true)).toThrow(/allowedOrigins/);
  });
  it("rejects unknown keys", () => {
    expect(() => parseConfig({ ...base, bogus: 1 }, true)).toThrow();
  });
});

describe("scope and knowledge-only config", () => {
  const knowledge = {
    sources: [{ id: "a", title: "A", content: "x" }],
    embeddings: { model: "m", baseUrl: "https://e.example.com", apiKey: "k" },
  };
  const llm = { baseUrl: "https://llm.example.com", apiKey: "k", model: "m" };
  const only = { llm, allow: [], allowedOrigins: ["https://app.example.com"], knowledge };
  it("accepts an empty allow list with knowledge, without spec or baseUrl", () => {
    expect(parseConfig(only, true).allow).toEqual([]);
  });
  it("still rejects an empty allow list without knowledge", () => {
    const { knowledge: _k, ...bare } = only;
    expect(() => parseConfig(bare, true)).toThrow(/allow is empty/);
  });
  it("requires spec and baseUrl once operations are allowed", () => {
    expect(() => parseConfig({ ...only, allow: ["x"] }, true)).toThrow(/spec and baseUrl/);
  });
  it("needs knowledge for scope and fills in defaults", () => {
    const { knowledge: _k, ...bare } = only;
    expect(() =>
      parseConfig({ ...bare, allow: ["x"], spec: {}, baseUrl: "https://a.example.com", scope: {} }, true),
    ).toThrow(/scope needs knowledge/);
    expect(parseConfig({ ...only, scope: {} }, true).scope?.minScore).toBe(0.45);
  });
});
