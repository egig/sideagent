import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { mockEmbeddingsHandler, mockLlmHandler } from "../testing/mock-llm.js";
import { createAgent, type Agent } from "./index.js";

const ORIGIN = "https://app.example.com";
const OFF_TOPIC = "Stay on topic.";
let srv: Server;
let docsOnly: Agent;
let owner: Agent;
let natural: Agent;
let naturalNoRetry: Agent;
let chatCalls = 0;
let lastChatBody = "";
let failChat = false;
const port = () => (srv.address() as AddressInfo).port;

beforeAll(async () => {
  srv = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const handler = req.url?.endsWith("/embeddings") ? mockEmbeddingsHandler : mockLlmHandler;
    if (req.url?.endsWith("/chat/completions")) {
      chatCalls++;
      lastChatBody = body;
      if (failChat) {
        res.writeHead(500).end("boom");
        return;
      }
    }
    const out = await handler(
      new Request("http://x", { method: "POST", body, headers: { "content-type": "application/json" } }),
    );
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const base = {
    llm: { baseUrl: `http://127.0.0.1:${port()}/v1`, apiKey: "k", model: "mock" },
    allowedOrigins: [ORIGIN],
    anonymous: true,
    allowPrivateNetworks: true,
    scope: { minScore: 0.3, offTopic: OFF_TOPIC },
    knowledge: {
      embeddings: { model: "mock-embedding" },
      sources: [
        { id: "refunds", title: "Refund policy", content: "Customers can request a refund within thirty days." },
      ],
    },
  };
  docsOnly = await createAgent({ ...base });
  owner = await createAgent({ ...base, exposeKnowledge: () => true });
  const naturalBase = { ...base, scope: { ...base.scope, naturalReply: true } };
  natural = await createAgent(naturalBase);
  naturalNoRetry = await createAgent({ ...naturalBase, llm: { ...base.llm, maxRetries: 0 } });
});
afterAll(() => srv.close());

async function chat(agent: Agent, message: string) {
  const res = await agent.handler(
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ message }),
    }),
  );
  const raw = await res.text();
  const events = raw
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice(6)) as AgentEvent);
  const text = events.map((e) => (e.type === "text.delta" ? e.text : "")).join("");
  return { events, text };
}

describe("scope: relevance gate", () => {
  it("answers off-topic questions with the fixed reply and never calls the model", async () => {
    const before = chatCalls;
    const { text, events } = await chat(docsOnly, "what is 2+2");
    expect(text).toBe(OFF_TOPIC);
    expect(events.at(-1)?.type).toBe("turn.end");
    expect(chatCalls).toBe(before);
  });

  it("lets a question that matches the documentation through to the model", async () => {
    const before = chatCalls;
    const { text } = await chat(docsOnly, "refund within thirty days");
    expect(chatCalls).toBeGreaterThan(before);
    expect(text).not.toBe(OFF_TOPIC);
    expect(text).toContain("Done.");
  });
});

describe("scope: naturalReply", () => {
  it("has the model write the decline from the last message only, with no tools", async () => {
    const before = chatCalls;
    const { text } = await chat(natural, "what is 2+2");
    expect(chatCalls).toBe(before + 1);
    expect(text).toBe("Hello from the mock model.");
    expect(text).not.toBe(OFF_TOPIC);
    const sent = JSON.parse(lastChatBody) as { tools?: unknown; messages: { role: string; content: string }[] };
    expect(sent.tools).toBeUndefined();
    expect(sent.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(sent.messages[0]!.content).toContain("never answer it");
  });

  it("keeps answering a question the documentation backs", async () => {
    const { text } = await chat(natural, "refund within thirty days");
    expect(text).toContain("Done.");
  });

  it("falls back to the fixed reply when the model call fails", async () => {
    failChat = true;
    try {
      const { text } = await chat(naturalNoRetry, "what is 2+2");
      expect(text).toBe(OFF_TOPIC);
    } finally {
      failChat = false;
    }
  });
});

describe("scope: owner view", () => {
  it("streams what the gate retrieved, with scores, even when it stops the turn", async () => {
    const { events, text } = await chat(owner, "what is 2+2");
    expect(text).toBe(OFF_TOPIC);
    expect(events.map((e) => e.type)).toEqual([
      "turn.start",
      "tool.start",
      "tool.complete",
      "knowledge.hits",
      "text.delta",
      "turn.end",
    ]);
    const hits = events.find((e) => e.type === "knowledge.hits");
    expect(hits).toMatchObject({ callId: "gate", hits: [{ title: "Refund policy" }] });
  });

  it("sends nothing of the sort to end users", async () => {
    const { events } = await chat(docsOnly, "what is 2+2");
    expect(events.some((e) => e.type === "knowledge.hits")).toBe(false);
  });
});
