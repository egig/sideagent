import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { mockEmbed } from "../testing/mock-llm.js";
import { workersAiChatModel, workersAiEmbeddings, type WorkersAiBinding } from "../workers-ai/index.js";
import { parseConfig } from "./config.js";
import { createAgent, type Agent } from "./index.js";

const ORIGIN = "https://app.example.com";
const spec = {
  openapi: "3.0.3",
  info: { title: "t", version: "1" },
  paths: {
    "/invoices": {
      get: { operationId: "listInvoices", summary: "List", responses: { "200": { description: "ok" } } },
      post: {
        operationId: "createInvoice",
        summary: "Create",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

// Fake Workers AI binding: picks a tool from the last user message, answers after a tool result.
const aiCalls: any[] = [];
const ai: WorkersAiBinding = {
  async run(model, input: any) {
    aiCalls.push({ model, input });
    if (model === "embed") return { data: input.text.map(mockEmbed) };
    const last = input.messages.at(-1);
    if (last.role === "tool") return { response: `done: ${String(last.content).slice(0, 40)}` };
    const text = String(last.content);
    if (/create/.test(text))
      return {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "createInvoice", arguments: '{"body":{"customer":"Acme"}}' },
                },
              ],
            },
          },
        ],
      };
    if (/list/.test(text))
      return { output: [{ type: "function_call", call_id: "c2", name: "listInvoices", arguments: "{}" }] };
    return { response: "hi" };
  },
};

let api: Server, agent: Agent;
const hits: string[] = [];

beforeAll(async () => {
  api = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ id: "1" }]));
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  agent = await createAgent({
    spec,
    baseUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
    allowPrivateNetworks: true,
    model: workersAiChatModel(ai, "@cf/openai/gpt-oss-120b"),
    embeddings: workersAiEmbeddings(ai, "embed"),
    knowledge: { sources: [{ id: "faq", title: "FAQ", content: "Refund policy: refunds within 30 days." }] },
    allow: ["listInvoices", "createInvoice"],
    allowedOrigins: [ORIGIN],
    approvalSecret: "test-secret-test-secret",
    anonymous: true,
  });
});
afterAll(() => api.close());

async function chat(body: unknown) {
  const res = await agent.handler(
    new Request("http://x/agent", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );
  const events: AgentEvent[] = [];
  for (const block of (await res.text()).split("\n\n"))
    if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
  return events;
}
const of = <T extends AgentEvent["type"]>(events: AgentEvent[], t: T) =>
  events.filter((e) => e.type === t) as Extract<AgentEvent, { type: T }>[];

describe("createAgent with an injected model", () => {
  it("runs an allowed GET operation without approval and streams the final text", async () => {
    hits.length = 0;
    const events = await chat({ message: "list invoices" });
    expect(of(events, "tool.complete")[0]).toMatchObject({ operationId: "listInvoices", status: 200 });
    expect(hits).toEqual(["GET /invoices"]);
    expect(
      of(events, "text.delta")
        .map((e) => e.text)
        .join(""),
    ).toContain("done:");
    // tools reached the binding in OpenAI function format
    expect(aiCalls.some((c) => c.input.tools?.some((t: any) => t.function.name === "listInvoices"))).toBe(true);
  });

  it("holds a POST for approval, then runs it once approved", async () => {
    hits.length = 0;
    const first = await chat({ message: "create invoice" });
    const req = of(first, "approval.request")[0]!;
    expect(req).toMatchObject({ operationId: "createInvoice", method: "POST" });
    expect(hits).toEqual([]);
    const threadId = of(first, "turn.start")[0]!.threadId;

    const second = await chat({ threadId, approval: { token: req.token, decision: "approve" } });
    expect(of(second, "tool.complete")[0]).toMatchObject({ operationId: "createInvoice", status: 200 });
    expect(hits).toEqual(["POST /invoices"]);
  });

  it("uses the injected embeddings for knowledge search", async () => {
    expect(agent.knowledge?.status()[0]?.chunks).toBeGreaterThan(0);
    expect(aiCalls.some((c) => c.model === "embed")).toBe(true);
  });

  it("doctor checks tool calling through invoke, not an HTTP call", async () => {
    const calls: any[] = [];
    const m = workersAiChatModel(
      { run: async (_m, i) => (calls.push(i), { response: null, tool_calls: [{ name: "ping", arguments: {} }] }) },
      "m",
    );
    const a = await createAgent({
      spec,
      baseUrl: "https://a.com",
      model: m,
      allow: ["listInvoices"],
      allowedOrigins: [ORIGIN],
      anonymous: true,
    });
    const report = await a.doctor();
    expect(report.checks.find((c) => c.name === "llm tool calling")).toMatchObject({ ok: true });
    expect(calls[0].tools[0].function.name).toBe("ping");

    const dumb = workersAiChatModel({ run: async () => ({ response: "no tools" }) }, "m");
    const b = await createAgent({
      spec,
      baseUrl: "https://a.com",
      model: dumb,
      allow: ["listInvoices"],
      allowedOrigins: [ORIGIN],
      anonymous: true,
    });
    expect((await b.doctor()).ok).toBe(false);
  });
});

describe("model / llm / embeddings config", () => {
  const base = { spec: {}, baseUrl: "https://a.com", allow: ["x"], allowedOrigins: [ORIGIN] };
  const llm = { baseUrl: "https://l.com/v1", apiKey: "k", model: "m" };
  it("accepts llm or model, never both, and errors when neither", () => {
    expect(() => parseConfig({ ...base, llm }, true)).not.toThrow();
    expect(() => parseConfig(base, true, { model: true })).not.toThrow();
    expect(() => parseConfig({ ...base, llm }, true, { model: true })).toThrow(/mutually exclusive/);
    expect(() => parseConfig(base, true)).toThrow(/no model: pass llm/);
  });
  it("needs embeddings from exactly one place when knowledge is set", () => {
    const knowledge = { sources: [{ id: "a", title: "A", content: "x" }] };
    expect(() => parseConfig({ ...base, llm, knowledge }, true)).toThrow(/knowledge needs/);
    expect(() => parseConfig({ ...base, llm, knowledge }, true, { embeddings: true })).not.toThrow();
    expect(() =>
      parseConfig({ ...base, llm, knowledge: { ...knowledge, embeddings: { model: "e" } } }, true, {
        embeddings: true,
      }),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      parseConfig({ ...base, knowledge: { ...knowledge, embeddings: { model: "e" } } }, true, { model: true }),
    ).toThrow(/baseUrl and apiKey/);
  });
});
