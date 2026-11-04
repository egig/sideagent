import { describe, expect, it } from "vitest";
import { emptyConfig, readiness } from "./config.js";

describe("readiness (D-19)", () => {
  const input = { knowledgeSources: 0, hasLlmKey: false };
  const failing = (config = emptyConfig(), i = input) =>
    readiness(config, i)
      .filter((r) => !r.ok)
      .map((r) => r.id);

  it("needs content, an origin and a user auth mode, and no API settings", () => {
    expect(failing()).toEqual(["content", "origins", "llm", "auth"]);
    expect(readiness(emptyConfig(), input).map((r) => r.id)).toEqual(["content", "origins", "llm", "auth"]);
  });

  it("is ready with knowledge or instructions, an origin, a model and anonymous auth", () => {
    const config = {
      ...emptyConfig(),
      allowedOrigins: ["https://app.example.com"],
      llm: { baseUrl: "https://l.example.com/v1", model: "m", embeddingModel: "e" },
      auth: { mode: "anonymous" as const },
    };
    const keyed = { ...input, hasLlmKey: true };
    expect(failing(config, { ...keyed, knowledgeSources: 1 })).toEqual([]);
    expect(failing({ ...config, instructions: "Be brief." }, keyed)).toEqual([]);
  });

  it("needs a model and its key", () => {
    const config = {
      ...emptyConfig(),
      llm: { baseUrl: "https://l.example.com/v1", model: "m", embeddingModel: "e" },
    };
    expect(failing(config)).toContain("llm");
    expect(failing(config, { ...input, hasLlmKey: true })).not.toContain("llm");
  });
});
