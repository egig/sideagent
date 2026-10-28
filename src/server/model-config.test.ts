import { describe, expect, it } from "vitest";
import { createChatModel, createEmbeddings } from "./model.js";

describe("llm and embeddings options", () => {
  it("send embeddings through the given fetch and fail at once with maxRetries 0", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      throw new Error("blocked");
    };
    const e = createEmbeddings(
      { model: "m", fetch, maxRetries: 0 },
      { baseUrl: "https://llm.invalid/v1", apiKey: "k", model: "x" },
    );
    await expect(e.embedQuery("hi")).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("send chat calls through the given fetch and fail at once with maxRetries 0", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      throw new Error("blocked");
    };
    const m = createChatModel({ baseUrl: "https://llm.invalid/v1", apiKey: "k", model: "x", fetch, maxRetries: 0 });
    await expect(m.invoke("hi")).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
