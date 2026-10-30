import { describe, expect, it } from "vitest";
import { mockEmbeddings } from "../testing/mock-llm.js";
import type { AgentEvent } from "../protocol.js";
import { createAgent, type TurnErrorContext } from "./index.js";

const ORIGIN = "https://app.example.com";
// A fetch that fails like a dead model host.
const failingFetch: typeof fetch = async () => {
  throw new Error("model exploded");
};

async function failedTurn(onError: (ctx: TurnErrorContext) => void | Promise<void>) {
  const agent = await createAgent({
    llm: { baseUrl: "https://llm.invalid/v1", apiKey: "k", model: "m", fetch: failingFetch, maxRetries: 0 },
    knowledge: {
      sources: [
        { id: "refunds", title: "Refund policy", content: "Customers can request a refund within thirty days." },
      ],
    },
    embeddings: mockEmbeddings,
    allowedOrigins: [ORIGIN],
    anonymous: true,
    onError,
  });
  const res = await agent.handler(
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ message: "hi" }),
    }),
  );
  const events = (await res.text())
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice(6)) as AgentEvent);
  return events.filter((e) => e.type === "error");
}

describe("onError", () => {
  it("gets the real error while the browser gets the generic message", async () => {
    const seen: TurnErrorContext[] = [];
    const errors = await failedTurn((c) => void seen.push(c));
    expect(errors).toEqual([{ type: "error", code: "error", message: "The agent failed. Try again." }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.code).toBe("error");
    // The OpenAI client words the failure itself; the point is that the server gets it and the browser does not.
    expect((seen[0]!.error as Error).message).toBe("Connection error.");
    expect(JSON.stringify(errors)).not.toContain("Connection");
  });

  it("swallows a throwing callback", async () => {
    const errors = await failedTurn(() => {
      throw new Error("logger down");
    });
    expect(errors.map((e) => e.code)).toEqual(["error"]);
  });
});
