import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mockEmbeddingsHandler, mockLlmHandler } from "../testing/mock-llm.js";
import type { AgentEvent } from "../protocol.js";
import { createAgent, type Agent } from "./index.js";

const ORIGIN = "https://app.example.com";
const knowledge = {
  embeddings: { model: "mock-embedding" },
  sources: [
    {
      id: "refunds",
      title: "Refund policy",
      content: "# Refunds\n\nCustomers can request a refund within thirty days.",
    },
  ],
};

let srv: Server;
let agent: Agent;
const port = () => (srv.address() as AddressInfo).port;
const llm = () => ({ baseUrl: `http://127.0.0.1:${port()}/v1`, apiKey: "test", model: "mock" });

beforeAll(async () => {
  srv = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const handler = req.url?.endsWith("/embeddings") ? mockEmbeddingsHandler : mockLlmHandler;
    const out = await handler(
      new Request("http://x", { method: "POST", body, headers: { "content-type": "application/json" } }),
    );
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  agent = await createAgent({
    llm: llm(),
    knowledge,
    allowedOrigins: [ORIGIN],
    getAuth: (req) => ({ userId: (req.headers.get("authorization") ?? "").replace("Bearer ", "") || "anon" }),
  });
});
afterAll(() => srv.close());

async function chat(body: unknown, opts: { user?: string; origin?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${opts.user ?? "u1"}`,
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const res = await agent.handler(
    new Request("http://localhost/agent", { method: opts.method ?? "POST", headers, body: JSON.stringify(body) }),
  );
  const events: AgentEvent[] = [];
  if (res.headers.get("content-type")?.includes("event-stream")) {
    for (const block of (await res.text()).split("\n\n"))
      if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
  }
  return { res, events };
}
const of = <T extends AgentEvent["type"]>(events: AgentEvent[], t: T) =>
  events.filter((e) => e.type === t) as Extract<AgentEvent, { type: T }>[];

describe("happy paths", () => {
  it("searches the knowledge and answers, showing sources but not passages", async () => {
    const { events } = await chat({ message: "what is the refund policy" });
    expect(of(events, "tool.start")[0]!.tool).toBe("search_knowledge");
    const done = of(events, "tool.complete")[0]!;
    expect(done.result).toEqual({ sources: [{ id: "refunds", title: "Refund policy" }] });
    expect(JSON.stringify(events)).not.toContain("thirty days");
    expect(of(events, "text.delta").length).toBeGreaterThan(0);
  });

  it("answers without a search when the question does not need one", async () => {
    const { events } = await chat({ message: "hello" });
    expect(of(events, "tool.start")).toHaveLength(0);
    expect(of(events, "text.delta").length).toBeGreaterThan(0);
  });
});

describe("attacks", () => {
  it("does not run a tool the model asks for that does not exist", async () => {
    const { events } = await chat({ message: 'CALL deleteInvoice {"id":"1"}' });
    expect(of(events, "tool.start")).toHaveLength(0);
    expect(of(events, "error")).toHaveLength(0);
  });

  it("no longer takes an approval in the request body", async () => {
    const first = await chat({ message: "hello" });
    const threadId = of(first.events, "turn.start")[0]!.threadId;
    const { res } = await chat({ threadId, approval: { token: "x", decision: "approve" } });
    expect(res.status).toBe(400);
  });

  it("denies another user's thread", async () => {
    const first = await chat({ message: "hello" });
    const threadId = of(first.events, "turn.start")[0]!.threadId;
    const { res } = await chat({ threadId, message: "hi" }, { user: "u2" });
    expect(res.status).toBe(404);
  });

  it("checks origin, method and content type", async () => {
    expect((await chat({ message: "hi" }, { origin: "https://evil.com" })).res.status).toBe(403);
    expect((await chat({ message: "hi" }, { origin: null })).res.status).toBe(403);
    expect((await chat({ message: "hi" }, { method: "PUT" })).res.status).toBe(405);
    const res = await agent.handler(
      new Request("http://x", { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: "x" }),
    );
    expect(res.status).toBe(415);
  });
});

describe("config safety", () => {
  it("requires getAuth or anonymous", async () => {
    await expect(createAgent({ llm: llm(), knowledge, allowedOrigins: [ORIGIN] })).rejects.toThrow(/getAuth/);
  });
  it("requires knowledge", async () => {
    await expect(createAgent({ llm: llm(), allowedOrigins: [ORIGIN], anonymous: true } as any)).rejects.toThrow(
      /knowledge/,
    );
  });
  it("doctor reports the knowledge sources", async () => {
    const report = await agent.doctor();
    expect(report.knowledge).toMatchObject([{ id: "refunds", chunks: 1 }]);
    expect(report).not.toHaveProperty("tools");
  });
});

describe("cors", () => {
  it("answers preflight only for allowed origins", async () => {
    const ok = await agent.handler(new Request("http://x", { method: "OPTIONS", headers: { origin: ORIGIN } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = await agent.handler(
      new Request("http://x", { method: "OPTIONS", headers: { origin: "https://evil.com" } }),
    );
    expect(bad.status).toBe(405);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("history", () => {
  const post = async (body: unknown, user = "u1") => {
    const res = await agent.handler(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, authorization: `Bearer ${user}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
  };

  it("lists threads with a title from the user's message and rebuilds messages with sources only", async () => {
    const { events } = await chat({ message: "what is the refund policy please" }, { user: "hist1" });
    const threadId = of(events, "turn.start")[0]!.threadId;
    const list = await post({ action: "threads.list" }, "hist1");
    expect(list.json.threads[0]).toMatchObject({ id: threadId, title: "what is the refund policy please" });

    const got = await post({ action: "threads.get", threadId }, "hist1");
    const msgs = got.json.messages;
    expect(msgs[0]).toMatchObject({ role: "user" });
    const tool = msgs[1].parts.find((p: any) => p.type === "tool");
    expect(tool.tool).toBe("search_knowledge");
    expect(JSON.stringify(tool.result)).not.toContain("thirty days");
  });

  it("does not let another user read or delete a thread", async () => {
    const { events } = await chat({ message: "hello" }, { user: "owner" });
    const threadId = of(events, "turn.start")[0]!.threadId;
    expect((await post({ action: "threads.get", threadId }, "intruder")).status).toBe(404);
    expect((await post({ action: "threads.delete", threadId }, "intruder")).status).toBe(404);
    expect((await post({ action: "threads.get", threadId }, "owner")).status).toBe(200);
  });

  it("rejects a client-invented thread id even with the right prefix", async () => {
    const forged = `${encodeURIComponent("u9")}:${crypto.randomUUID()}`;
    expect((await post({ action: "threads.get", threadId: forged }, "u9")).status).toBe(404);
    expect((await chat({ threadId: forged, message: "hi" }, { user: "u9" })).res.status).toBe(404);
  });

  it("deletes a thread", async () => {
    const { events } = await chat({ message: "hello" }, { user: "del" });
    const threadId = of(events, "turn.start")[0]!.threadId;
    expect((await post({ action: "threads.delete", threadId }, "del")).status).toBe(200);
    expect((await post({ action: "threads.list" }, "del")).json.threads).toHaveLength(0);
    expect((await post({ action: "threads.get", threadId }, "del")).status).toBe(404);
  });
});
