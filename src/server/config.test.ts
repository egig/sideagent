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
