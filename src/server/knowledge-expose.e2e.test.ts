import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { mockEmbeddingsHandler, mockLlmHandler } from "../testing/mock-llm.js";
import { createAgent } from "./index.js";

const ORIGIN = "https://app.example.com";
const CANARY = "CANARY-PASSAGE-TEXT";

// No server: the injected fetch is the only way the agent reaches the model and the embeddings.
const llmUrls: string[] = [];
const embeddingUrls: string[] = [];
const llmBodies: any[] = [];
const mockFetch: typeof fetch = async (input, init) => {
  const req = new Request(input as any, init);
  const url = req.url;
  if (url.endsWith("/embeddings")) {
    embeddingUrls.push(url);
    return mockEmbeddingsHandler(req);
  }
  llmUrls.push(url);
  llmBodies.push(await req.clone().json());
  return mockLlmHandler(req);
};

const make = (exposeKnowledge?: Parameters<typeof createAgent>[0]["exposeKnowledge"]) =>
  createAgent({
    llm: { baseUrl: "https://llm.invalid/v1", apiKey: "k", model: "mock", fetch: mockFetch },
    allowedOrigins: [ORIGIN],
    anonymous: true,
    exposeKnowledge,
    knowledge: {
      embeddings: { model: "mock-embedding", fetch: mockFetch },
      sources: [
        { id: "refunds", title: "Refund policy", content: `# Refunds\n\n${CANARY} refund within thirty days.` },
      ],
    },
  });

async function chat(agent: Awaited<ReturnType<typeof make>>, body: object, headers: Record<string, string> = {}) {
  const res = await agent.handler(
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    }),
  );
  const raw = await res.text();
  const events = raw
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice(6)) as AgentEvent);
  return { raw, events };
}
/** The mock model repeats what it was given in its text, so look at everything except the model's own words. */
const leaks = (events: AgentEvent[]) => JSON.stringify(events.filter((e) => e.type !== "text.delta")).includes(CANARY);
const SEARCH = { message: 'CALL search_knowledge {"query":"refund within thirty days"}' };

describe("exposeKnowledge", () => {
  it("is off by default: no knowledge.hits and no passage text in the stream", async () => {
    const { events } = await chat(await make(), SEARCH);
    expect(events.some((e) => e.type === "tool.complete")).toBe(true);
    expect(events.some((e) => e.type === "knowledge.hits")).toBe(false);
    expect(leaks(events)).toBe(false);
  });

  it("ignores flags sent in the request body", async () => {
    const agent = await make();
    for (const extra of [{ debug: true }, { exposeKnowledge: true }, { context: { exposeKnowledge: true } }]) {
      const { events } = await chat(agent, { ...SEARCH, ...extra });
      expect(events.some((e) => e.type === "knowledge.hits")).toBe(false);
      expect(leaks(events)).toBe(false);
    }
  });

  it("streams passages after tool.complete when the host says yes, for that request only", async () => {
    const agent = await make(({ request }) => request.headers.get("x-owner") === "1");
    const owner = await chat(agent, SEARCH, { "x-owner": "1" });
    const types = owner.events.map((e) => e.type);
    expect(types.indexOf("knowledge.hits")).toBeGreaterThan(types.indexOf("tool.complete"));
    const hits = owner.events.find(
      (e): e is Extract<AgentEvent, { type: "knowledge.hits" }> => e.type === "knowledge.hits",
    )!;
    expect(hits.query).toBe("refund within thirty days");
    expect(hits.hits[0]).toMatchObject({ title: "Refund policy" });
    expect(hits.hits[0]!.text).toContain(CANARY);
    expect(typeof hits.hits[0]!.score).toBe("number");

    const other = await chat(agent, SEARCH);
    expect(leaks(other.events)).toBe(false);
  });

  it("treats a throwing or non-true callback as no", async () => {
    for (const cb of [
      () => {
        throw new Error("boom");
      },
      () => "yes" as unknown as boolean,
    ]) {
      const { events } = await chat(await make(cb), SEARCH);
      expect(events.some((e) => e.type === "turn.end")).toBe(true);
      expect(leaks(events)).toBe(false);
    }
  });

  it("still gives the model the passages as untrusted data", async () => {
    llmBodies.length = 0;
    await chat(await make(() => true), SEARCH);
    const toolMsg = llmBodies.flatMap((b) => b.messages).find((m: any) => m.role === "tool");
    expect(String(toolMsg.content)).toContain("<knowledge_source");
    expect(String(toolMsg.content)).toContain(CANARY);
  });
});

describe("llm and embeddings fetch", () => {
  it("sends every model and embeddings call through the given fetch", async () => {
    llmUrls.length = 0;
    embeddingUrls.length = 0;
    await chat(await make(), SEARCH);
    expect(llmUrls.length).toBeGreaterThan(0);
    expect(llmUrls.every((u) => u.startsWith("https://llm.invalid/v1/"))).toBe(true);
    expect(embeddingUrls.length).toBeGreaterThan(0);
  });

  it("embeddings fall back to llm.fetch", async () => {
    embeddingUrls.length = 0;
    const agent = await createAgent({
      llm: { baseUrl: "https://llm.invalid/v1", apiKey: "k", model: "mock", fetch: mockFetch },
      allowedOrigins: [ORIGIN],
      anonymous: true,
      knowledge: {
        embeddings: { model: "mock-embedding" },
        sources: [{ id: "a", title: "A", content: "alpha" }],
      },
    });
    await chat(agent, SEARCH);
    expect(embeddingUrls.length).toBeGreaterThan(0);
  });
});
