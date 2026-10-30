import { beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { mockEmbed } from "../testing/mock-llm.js";
import { workersAiChatModel, workersAiEmbeddings, type WorkersAiBinding } from "../workers-ai/index.js";
import { parseConfig } from "./config.js";
import { createAgent, type Agent } from "./index.js";

const ORIGIN = "https://app.example.com";
// Fake Workers AI binding: searches the knowledge for a question about refunds, answers after a tool result.
const aiCalls: any[] = [];
const ai: WorkersAiBinding = {
  async run(model, input: any) {
    aiCalls.push({ model, input });
    if (model === "embed") return { data: input.text.map(mockEmbed) };
    const last = input.messages.at(-1);
    if (last.role === "tool") return { response: `done: ${String(last.content).slice(0, 40)}` };
    const text = String(last.content);
    if (/refund/.test(text))
      return {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "search_knowledge", arguments: '{"query":"refund"}' } },
              ],
            },
          },
        ],
      };
    if (/policy/.test(text))
      return {
        output: [{ type: "function_call", call_id: "c2", name: "search_knowledge", arguments: '{"query":"policy"}' }],
      };
    return { response: "hi" };
  },
};

const knowledge = { sources: [{ id: "faq", title: "FAQ", content: "Refund policy: refunds within 30 days." }] };
let agent: Agent;

beforeAll(async () => {
  agent = await createAgent({
    model: workersAiChatModel(ai, "@cf/openai/gpt-oss-120b"),
    embeddings: workersAiEmbeddings(ai, "embed"),
    knowledge,
    allowedOrigins: [ORIGIN],
    anonymous: true,
  });
});

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
  it("searches the knowledge with the model's tool call and streams the final text", async () => {
    const events = await chat({ message: "what is the refund rule" });
    expect(of(events, "tool.complete")[0]).toMatchObject({ tool: "search_knowledge", status: 200 });
    expect(
      of(events, "text.delta")
        .map((e) => e.text)
        .join(""),
    ).toContain("done:");
    // the search tool reached the binding in OpenAI function format
    expect(aiCalls.some((c) => c.input.tools?.some((t: any) => t.function.name === "search_knowledge"))).toBe(true);
  });

  it("understands a tool call in the Responses output format", async () => {
    const events = await chat({ message: "what is the policy" });
    expect(of(events, "tool.complete")[0]).toMatchObject({ tool: "search_knowledge", status: 200 });
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
      model: m,
      embeddings: workersAiEmbeddings(ai, "embed"),
      knowledge,
      allowedOrigins: [ORIGIN],
      anonymous: true,
    });
    const report = await a.doctor();
    expect(report.checks.find((c) => c.name === "llm tool calling")).toMatchObject({ ok: true });
    expect(calls[0].tools[0].function.name).toBe("ping");

    const dumb = workersAiChatModel({ run: async () => ({ response: "no tools" }) }, "m");
    const b = await createAgent({
      model: dumb,
      embeddings: workersAiEmbeddings(ai, "embed"),
      knowledge,
      allowedOrigins: [ORIGIN],
      anonymous: true,
    });
    expect((await b.doctor()).ok).toBe(false);
  });
});

describe("model / llm / embeddings config", () => {
  const knowledge = { sources: [{ id: "a", title: "A", content: "x" }] };
  const base = { allowedOrigins: [ORIGIN], knowledge };
  const emb = { embeddings: true };
  const llm = { baseUrl: "https://l.com/v1", apiKey: "k", model: "m" };
  it("accepts llm or model, never both, and errors when neither", () => {
    expect(() => parseConfig({ ...base, llm }, true, emb)).not.toThrow();
    expect(() => parseConfig(base, true, { model: true, ...emb })).not.toThrow();
    expect(() => parseConfig({ ...base, llm }, true, { model: true, ...emb })).toThrow(/mutually exclusive/);
    expect(() => parseConfig(base, true, emb)).toThrow(/no model: pass llm/);
  });
  it("needs embeddings from exactly one place when knowledge is set", () => {
    expect(() => parseConfig({ ...base, llm }, true)).toThrow(/knowledge needs/);
    expect(() => parseConfig({ ...base, llm }, true, emb)).not.toThrow();
    expect(() =>
      parseConfig({ ...base, llm, knowledge: { ...knowledge, embeddings: { model: "e" } } }, true, emb),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      parseConfig({ ...base, knowledge: { ...knowledge, embeddings: { model: "e" } } }, true, { model: true }),
    ).toThrow(/baseUrl and apiKey/);
  });
});
