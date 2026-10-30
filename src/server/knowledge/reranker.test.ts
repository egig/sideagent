import { describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createLlmReranker } from "./reranker.js";

describe("createLlmReranker", () => {
  it("returns scores from the configured model in candidate order", async () => {
    const invoke = vi.fn(async () => ({ content: '```json\n{"scores":[0.1,0.9]}\n```' }));
    const rerank = createLlmReranker({ invoke } as unknown as BaseChatModel);

    const scores = await rerank("How do refunds work?", [
      { text: "Shipping details", score: 0.7, meta: { sourceId: "shipping", title: "Shipping" } },
      { text: "Refund within 30 days", score: 0.6, meta: { sourceId: "refunds", title: "Refunds" } },
    ]);

    expect(scores).toEqual([0.1, 0.9]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(JSON.stringify(invoke.mock.calls[0])).toContain("Refund within 30 days");
  });

  it("rejects a response without a scores array", async () => {
    const invoke = vi.fn(async () => ({ content: "not JSON" }));
    const rerank = createLlmReranker({ invoke } as unknown as BaseChatModel);

    await expect(
      rerank("question", [{ text: "passage", score: 0.5, meta: { sourceId: "s", title: "S" } }]),
    ).rejects.toThrow();
  });
});
